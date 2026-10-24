const test = require('node:test'), assert = require('node:assert/strict');
const ts = require('typescript'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const sharp = require('sharp'), { ObjectId } = require('mongodb');
function load(relative, stubs = {}) {
 const filename = path.resolve(relative), mod = new Module(filename, module); mod.filename = filename; mod.paths = module.paths;
 const original = mod.require.bind(mod);
 mod.require = id => Object.hasOwn(stubs, id) ? stubs[id] : id.startsWith('.') ? load(path.join(path.dirname(relative), id + '.ts'), stubs) : id.startsWith('@/') ? load(id.slice(2) + '.ts', stubs) : original(id);
 mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, filename);
 return mod.exports;
}
const pose = {width:100,height:100,intrinsics:[100,0,0,0,100,0,50,50,1],transform:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]};
const observation = {type:'tear',description:'Clearly torn upholstery',boundingBox:{x:.45,y:.45,width:.1,height:.1}};
const image = () => sharp({create:{width:100,height:100,channels:3,background:'white'}}).jpeg().toBuffer();
test('sampling is chronological and selects at most one real source frame per second',()=>{
 const {oneFramePerSecond}=load('lib/server/furniture-video.ts');
 const samples=[{timestampSeconds:2.1,id:'c'},{timestampSeconds:.1,id:'a'},{timestampSeconds:.6,id:'duplicate'},{timestampSeconds:1.2,id:'b'}];
 assert.deepEqual(oneFramePerSecond(samples).map(f=>f.id),['a','b','c']);
 assert.equal(samples[0].id,'c');
 for(const t of [-1,NaN,Infinity])assert.throws(()=>oneFramePerSecond([{timestampSeconds:t}]));
});
test('Argon gets only chronological JPEG pixels and timestamps, with furniture and obvious-damage policy',async()=>{
 let request;
 const {inspectVideoDamageBatch}=load('lib/server/damage.ts',{'@google/genai':{GoogleGenAI:class{models={generateContent:async input=>{request=input;return {text:JSON.stringify({frames:[{timestampSeconds:0,damage:[observation]},{timestampSeconds:1,damage:[]}]})}}}}}});
 const previous=process.env.GEMINI_API_KEY;process.env.GEMINI_API_KEY='test-only';
 try{
  const photo=await image();
  const result=await inspectVideoDamageBatch([{image:photo,timestampSeconds:0,pose:{privateGeometry:'never transmit'}},{image:photo,timestampSeconds:1,elements:['private-room-mesh']}]);
  assert.deepEqual(result.get(0),[observation]);
  const texts=request.contents.filter(p=>p.text).map(p=>p.text).join(' ');
  assert.match(texts,/only basic furniture/);assert.match(texts,/only obvious/);assert.match(texts,/Ignore tiny specks/);assert.match(texts,/adjacent views/);
  assert(!JSON.stringify(request).includes('privateGeometry'));assert(!JSON.stringify(request).includes('private-room-mesh'));
  assert.equal(request.contents.filter(p=>p.inlineData).length,2);
  for(const part of request.contents.filter(p=>p.inlineData))assert.equal(part.inlineData.mimeType,'image/jpeg');
 }finally{if(previous===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=previous;}
});
test('returned boxes use their own camera pose, without crack or verification calls',async()=>{
 let calls=0;
 const {analyzeFurnitureVideoFrames}=load('lib/server/furniture-video.ts',{
  './damage':{scopeForName:()=>null,inspectVideoDamageBatch:async frames=>{calls++;return new Map(frames.map(f=>[f.timestampSeconds,[observation]]));}},
  './crack-detector':{inspectCracks:()=>{throw new Error('Unrequested crack inference');}},
  './verify':{autoApproveThreshold:()=>.85,reviewDecision:()=>{throw new Error('Unrequested verification');},verifyFinding:()=>{throw new Error('Unrequested provider call');}},
 });
 const chair={id:'chair',category:'chair',dimensions:[1,1,.2],transform:[...pose.transform.slice(0,14),-2,1]};
 const away={...pose,transform:[...pose.transform.slice(0,12),10,0,0,1]};
 const results=await analyzeFurnitureVideoFrames([{image:await image(),timestampSeconds:0,pose},{image:await image(),timestampSeconds:1,pose:away}],[chair]);
 assert.equal(calls,1);assert.equal(results[0].result.findings[0].elementId,'chair');assert(results[0].result.findings[0].worldPosition);
 assert.equal(results[1].result.findings[0].elementId,null);assert.equal(results[1].result.findings[0].worldPosition,null);
 assert.equal(results[0].result.findings[0].reviewStatus,'pending');assert.equal(results[0].result.findings[0].autoApproved,false);
});
test('furniture projection does not attach a mark to a wall behind it',async()=>{
 const {analyzeFurnitureVideoFrames}=load('lib/server/furniture-video.ts',{'./damage':{scopeForName:()=>null,inspectVideoDamageBatch:async()=>new Map([[0,[observation]]])}});
 const wall={id:'wall',category:'wall',dimensions:[4,4,.1],transform:[...pose.transform.slice(0,14),-2,1]};
 const [{result}]=await analyzeFurnitureVideoFrames([{image:await image(),timestampSeconds:0,pose}],[wall]);
 assert.equal(result.findings[0].worldPosition,null);assert.equal(result.findings[0].elementId,null);assert.deepEqual(result.findings[0].boundingBox,observation.boundingBox);
});
function endpoint(){
 const id=new ObjectId(),docs=[],jobs=[],saved=[];let deleted=[];
 const frames={createIndex:async()=>{},findOne:async q=>docs.find(f=>f.sampleSecond===q.sampleSecond),updateOne:async(q,u)=>{const exists=docs.find(f=>f.sampleSecond===q.sampleSecond);if(exists)return {upsertedCount:0};docs.push({...u.$setOnInsert});return {upsertedCount:1};}};
 const route=load('app/api/live/[sessionId]/frame/route.ts',{
  'next/server':{after:job=>jobs.push(job)},
  '@/lib/server/live-sessions':{authenticateLive:async()=>({session:{_id:id,ownerId:'owner'}}),liveCollections:async()=>({db:{collection:()=>frames}}),LiveError:class extends Error{constructor(message,status=400){super(message);this.status=status;}},liveFailure:e=>Response.json({error:e.message},{status:e.status||400})},
  '@/lib/server/native-analysis':{analyzeLiveEvidenceFrame:async()=>{}},
  '@/lib/server/media':{writeMedia:async(bytes,name,type,metadata)=>{saved.push({bytes,name,type,metadata});return 'gridfs:'+new ObjectId();},deleteMedia:async ref=>deleted.push(ref),getMediaFile:async()=>({metadata:{liveSessionId:'other-session'}})},
 });
 const post=async(timestampSeconds,photo,override={})=>route.POST(new Request('https://dwelld.example/frame',{method:'POST',headers:{'content-type':'image/jpeg','x-dwelld-frame':JSON.stringify({name:`frame-${timestampSeconds}.jpg`,timestampSeconds,pose,...override})},body:photo}),{params:Promise.resolve({sessionId:String(id)})});
 return {post,docs,jobs,saved,deleted,id,route};
}
test('inline frame endpoint saves and queues once per second with session ownership and calibrated pose',async()=>{
 const f=endpoint(),photo=await image();const first=await f.post(1.1,photo);assert.equal(first.status,202);const body=await first.json();assert.match(body.ref,/^gridfs:/);
 assert.deepEqual(f.docs[0].pose,pose);assert.equal(f.saved[0].metadata.liveSessionId,String(f.id));assert.equal(f.jobs.length,1);
 const retry=await (await f.post(1.1,photo)).json();assert.equal(retry.ref,body.ref);
 const sameSecond=await (await f.post(1.8,photo)).json();assert.equal(sameSecond.queued,false);assert.equal(sameSecond.ref,undefined);
 assert.equal(f.saved.length,1);assert.equal(f.docs.length,1);
 const mismatch=endpoint();assert.equal((await mismatch.post(1,photo,{pose:{...pose,width:101}})).status,400);assert.equal(mismatch.saved.length,0);
 assert.equal((await f.post(-1,photo)).status,400);
});
test('legacy referenced frames cannot cross scan boundaries',async()=>{
 const f=endpoint();const response=await f.route.POST(new Request('https://dwelld.example/frame',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'foreign.jpg',ref:'gridfs:'+new ObjectId(),timestampSeconds:0,pose})}),{params:Promise.resolve({sessionId:String(f.id)})});
 assert.equal(response.status,403);assert.equal(f.docs.length,0);
});
test('binary evidence body enforces its streaming size bound even without Content-Length',async()=>{
 const {readBinaryBody}=load('lib/server/request-body.ts');
 await assert.rejects(readBinaryBody(new Request('https://dwelld.example',{method:'POST',body:Buffer.alloc(50)}),10),/too large/);
 assert.deepEqual(await readBinaryBody(new Request('https://dwelld.example',{method:'POST',body:Buffer.from('photo')}),10),Buffer.from('photo'));
});
function nativeWorkerFixture(fail=false,options={}){
 const id=new ObjectId(),records=Array.from({length:options.count||8},(_,i)=>({_id:new ObjectId(),sessionId:id,name:`frame-${i}`,ref:`photo-${i}`,pose,timestampSeconds:i,status:'queued'})).reverse();
 const session={_id:id,status:'recording',nativeLive:{elements:[]}},calls=[],findings=[];
 const sessions={
  findOneAndUpdate:async()=>{if(session.furnitureWorker)return null;session.furnitureWorker={};return session;},findOne:async()=>session,
  updateOne:async(q,u)=>{if(u.$set)Object.assign(session,u.$set);if(u.$unset)delete session.furnitureWorker;},
 };
 const frames={findOneAndUpdate:async(q,u)=>{const fr=records.filter(f=>f.status===q.status).sort((a,b)=>a.timestampSeconds-b.timestampSeconds)[0];if(fr)Object.assign(fr,u.$set);return fr;},updateOne:async(q,u)=>Object.assign(records.find(f=>f._id===q._id),u.$set),updateMany:async(q,u)=>records.filter(f=>q._id.$in.includes(f._id)&&f.status===q.status).forEach(f=>Object.assign(f,u.$set))};
 const {analyzeLiveEvidenceFrame}=load('lib/server/native-analysis.ts',{
  './db':{getDb:async()=>({collection:name=>name==='liveSessions'?sessions:name==='liveFrames'?frames:{find:()=>({toArray:async()=>options.localized?findings:[]}),updateOne:async(q,u)=>{if(name==='liveFindings')findings.push(u.$setOnInsert);}}})},
  './media':{readMedia:async()=>Buffer.from('photo')},'./search':{indexFindings:async()=>{}},
  './furniture-video':{analyzeFurnitureVideoFrames:async samples=>{calls.push(samples.map(f=>f.timestampSeconds));if(options.run)await options.run(samples);if(fail)throw Object.assign(new Error('Monthly spending cap exceeded'),{status:429});return samples.map(frame=>({frame,result:{findings:[{...observation,damageType:'tear',label:'Tear',reviewStatus:'pending',autoApproved:false,worldPosition:options.localized?[0,0,-2]:null,elementId:options.localized?'chair-1':null}],views:[],warnings:[]}}));}},
 });
 return {run:()=>analyzeLiveEvidenceFrame(id,''),calls,records,findings,session};
}
test('live worker consumes every queued second chronologically in bounded batches and keeps findings pending',async()=>{
 const f=nativeWorkerFixture();await f.run();assert.deepEqual(f.calls,[[0,1,2,3,4,5],[6,7]]);assert.equal(f.findings.length,8);assert(f.records.every(fr=>fr.status==='done'));assert(f.findings.every(fr=>fr.reviewStatus==='pending'&&!fr.autoApproved));assert.equal(f.session.furnitureWorker,undefined);
});
test('provider spending block stops subsequent live batches and later triggers while preserving queued source frames',async()=>{
 const f=nativeWorkerFixture(true,{count:20});await f.run();await f.run();assert.equal(f.calls.length,2);assert.equal(f.records.filter(fr=>fr.status==='failed').length,12);assert.equal(f.records.filter(fr=>fr.status==='queued').length,8);assert.equal(f.session.analysisIssue.code,'AI_BILLING_BLOCKED');assert.equal(f.session.furnitureWorker,undefined);assert(f.records.every(fr=>fr.ref));
});

test('two native batches run concurrently but reversed completions commit in timestamp order',{timeout:3000},async()=>{
 let active=0,max=0,releaseFirst,secondFinished;const firstGate=new Promise(r=>releaseFirst=r),secondDone=new Promise(r=>secondFinished=r);
 const f=nativeWorkerFixture(false,{count:20,run:async frames=>{active++;max=Math.max(max,active);try{if(frames[0].timestampSeconds===0)await firstGate;if(frames[0].timestampSeconds===6)secondFinished();}finally{active--}}});
 const run=f.run();await secondDone;assert.equal(max,2);assert.equal(f.findings.length,0);releaseFirst();await run;
 assert.deepEqual(f.findings.map(f=>f.timestampSeconds),Array.from({length:20},(_,i)=>i));assert.equal(f.records.filter(f=>f.status==='done').length,20);assert.equal(max,2);
});
test('parallel native results still deduplicate before inserting repeated marks',async()=>{const f=nativeWorkerFixture(false,{count:12,localized:true,run:async frames=>{if(frames[0].timestampSeconds===0)await new Promise(r=>setTimeout(r,5));}});await f.run();assert.equal(f.calls.length,2);assert.equal(f.findings.length,1);assert.equal(f.findings[0].timestampSeconds,0);assert(f.records.every(fr=>fr.status==='done'));});
test('a billing failure stops new waves without discarding the other in-flight batch',async()=>{const f=nativeWorkerFixture(false,{count:20,run:async frames=>{if(frames[0].timestampSeconds===0)throw Object.assign(new Error('Monthly spending cap exceeded'),{status:429});}});await f.run();assert.equal(f.calls.length,2);assert.equal(f.findings.length,6);assert.equal(f.records.filter(fr=>fr.status==='queued').length,8);assert.equal(f.session.analysisIssue.code,'AI_BILLING_BLOCKED');});
test('ordinary rate limits pause new waves and impose a cooldown on later triggers',async()=>{const f=nativeWorkerFixture(false,{count:20,run:async()=>{throw Object.assign(new Error('RESOURCE_EXHAUSTED'),{status:429});}});await f.run();await f.run();assert.equal(f.calls.length,2);assert.equal(f.records.filter(fr=>fr.status==='queued').length,8);assert(new Date(f.session.analysisIssue.retryAfter)>new Date());});
test('saved native scans use two workers, preserve all samples, and save deterministic chronological results',{timeout:3000},async()=>{
 const stored=[],updates=[],calls=[];let active=0,max=0,release,secondFinished;
 const firstGate=new Promise(r=>release=r),secondDone=new Promise(r=>secondFinished=r);
 const {analyzeNativeInspection}=load('lib/server/native-analysis.ts',{
  './db':{getDb:async()=>({collection:name=>({updateOne:async(q,u)=>updates.push(u.$set),insertOne:async f=>{if(name==='findings')stored.push(f)}})})},
  './media':{readMedia:async()=>Buffer.from('photo')},'./search':{indexFindings:async()=>{}},'./object-reconstruction':{prepareObjectReconstructions:async()=>{}},
  './furniture-video':{oneFramePerSecond:frames=>frames,analyzeFurnitureVideoFrames:async samples=>{calls.push(samples.map(s=>s.timestampSeconds));active++;max=Math.max(max,active);try{if(samples[0].timestampSeconds===0)await firstGate;else secondFinished();return samples.map(frame=>({frame,result:{findings:[{label:'Tear',description:'Visible tear',damageType:'tear',boundingBox:observation.boundingBox,elementId:null,worldPosition:null,reviewStatus:'pending',autoApproved:false,detectionSource:'gemini'}],warnings:[],views:[]}}));}finally{active--}}},
 });
 const frames=Array.from({length:18},(_,i)=>({...pose,timestamp:i,image:`frame-${i}.jpg`})),manifest={sessionId:'scan',elements:[],frames,assets:frames.map(f=>({name:f.image,kind:'image',mediaRef:`photo-${f.timestamp}`}))};
 const run=analyzeNativeInspection({_id:new ObjectId(),ownerId:'owner',roomId:new ObjectId()},manifest,null);
 await secondDone;assert.equal(max,2);assert.equal(stored.length,0);release();await run;
 assert.deepEqual(stored.map(f=>f.timestampSeconds),Array.from({length:18},(_,i)=>i));assert.equal(calls.length,3);assert.equal(updates.at(-1).framesAnalysed,18);assert.equal(updates.at(-1).status,'completed');assert.equal(max,2);
});
