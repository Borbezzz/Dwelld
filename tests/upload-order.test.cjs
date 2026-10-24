const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const {ObjectId,Binary}=require('mongodb');
function load(file,stubs){const filename=path.resolve(file),mod=new Module(filename,module);mod.filename=filename;mod.paths=module.paths;const original=mod.require.bind(mod);mod.require=id=>Object.hasOwn(stubs,id)?stubs[id]:original(id);mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,filename);return mod.exports;}
function fixture(live){
 const id=new ObjectId(),sessionId=new ObjectId(),size=2*1024*1024,stored=new Map(),metrics={partReads:0,closed:0,writes:0,indexCalls:0},upload={_id:id,sessionId,ownerId:'owner',filename:'room.mp4',contentType:'video/mp4',size:size+3,status:'uploading',expiresAt:new Date(Date.now()+60000)};
 const parts={createIndex:async()=>{metrics.indexCalls++;},findOne:async q=>{metrics.partReads++;return stored.get(q.part)||null;},updateOne:async(q,u)=>{if(!stored.has(q.part))stored.set(q.part,u.$setOnInsert);},deleteMany:async()=>stored.clear(),find:()=>{const rows=[...stored.values()].sort((a,b)=>a.part-b.part);return {sort(){return this},batchSize(){return this},toArray:async()=>rows,async *[Symbol.asyncIterator](){yield* rows;},close:async()=>metrics.closed++};}};
 const uploads={createIndex:async()=>{metrics.indexCalls++;},findOne:async()=>upload,findOneAndUpdate:async(q,u)=>{Object.assign(upload,u.$set);return upload;},updateOne:async(q,u)=>{Object.assign(upload,u.$set);return {modifiedCount:1}}};
 const db={collection:name=>name.endsWith('Parts')?parts:uploads};
 const stubs={
  '@/lib/server/request-body':{readJsonBody:r=>r.json()},
  '@/lib/server/access':{requireUser:async()=>({id:'owner'})},
  '@/lib/server/db':{getDb:async()=>db,parseObjectId:s=>ObjectId.isValid(s)?new ObjectId(s):null},
  '@/lib/server/api-error':{errorResponse:e=>Response.json({error:e.message},{status:500})},
  '@/lib/server/live-sessions':{authenticateLive:async()=>({session:{_id:sessionId,ownerId:'owner',status:'capturing'}}),liveCollections:async()=>({sessions:{updateOne:async()=>{}}}),liveFailure:e=>Response.json({error:e.message},{status:500}),LiveError:Error},
  '@/lib/server/media':{deleteMedia:async()=>{},writeMedia:async stream=>{metrics.writes++;const chunks=[];for await(const chunk of stream)chunks.push(chunk);metrics.bytes=Buffer.concat(chunks);return 'gridfs:'+new ObjectId();}},
 };
 const route=load(live?'app/api/live/[sessionId]/upload/route.ts':'app/api/uploads/route.ts',stubs),context={params:Promise.resolve({sessionId:String(sessionId)})};
 const patch=(part,data)=>route.PATCH(new Request(`https://dwelld.test/upload?uploadId=${id}&part=${part}`,{method:'PATCH',headers:{'Content-Type':'application/octet-stream'},body:data}),context);
 const complete=()=>route.POST(new Request('https://dwelld.test/upload',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'complete',uploadId:String(id)})}),context);
 const state=()=>route.GET(new Request(`https://dwelld.test/upload?uploadId=${id}`),context);
 return {patch,complete,state,stored,metrics,size,upload};
}
for(const live of [false,true]){
 const label=live?'paired phone':'signed-in browser';
 test(`${label}: accepts a later upload part first and retries identical bytes without replacement`,async()=>{
  const f=fixture(live);assert.equal((await f.patch(1,Buffer.from('end'))).status,200);assert(!f.stored.has(0));
  assert.equal((await f.patch(1,Buffer.from('end'))).status,200);assert.equal(f.stored.size,1);assert.equal(f.metrics.indexCalls,3);
  assert.equal((await f.patch(1,Buffer.from('bad'))).status,409);assert.equal(Buffer.from(f.stored.get(1).data.buffer).toString(),'end');
 });
 test(`${label}: missing parts cannot finalize; out-of-order arrivals finalize in exact byte order`,async()=>{
  const f=fixture(live);await f.patch(1,Buffer.from('end'));assert.equal((await f.complete()).status,409);assert.equal(f.metrics.writes,0);
  const first=Buffer.alloc(f.size,7);await f.patch(0,first);const previousReads=f.metrics.partReads;
  assert.equal((await f.complete()).status,201);assert.equal(f.metrics.partReads,previousReads);assert.equal(f.metrics.closed,1);
  assert.deepEqual(f.metrics.bytes,Buffer.concat([first,Buffer.from('end')]));assert.equal(f.upload.status,'complete');
 });
 test(`${label}: finalization still checks hashes and closes its cursor on corrupted bytes`,async()=>{
  const f=fixture(live);await f.patch(0,Buffer.alloc(f.size,7));await f.patch(1,Buffer.from('end'));
  f.stored.get(1).data=new Binary(Buffer.from('bad'));
  assert.equal((await f.complete()).status,500);assert.equal(f.metrics.closed,1);assert.equal(f.upload.status,'uploading');
 });
}

for(const live of [false,true])test(`${live?'paired phone':'browser'}: status reads recover abandoned finalization but retain active leases and successful parts`,async()=>{
 const f=fixture(live);await f.patch(1,Buffer.from('end'));f.upload.status='finalizing';f.upload.lockId='old-worker';f.upload.lockedAt=new Date();
 assert.equal((await (await f.state()).json()).status,'finalizing');
 f.upload.lockedAt=new Date(Date.now()-70_000);const state=await (await f.state()).json();assert.equal(state.status,'uploading');assert.deepEqual(state.parts,[1]);assert.equal(f.metrics.writes,0);assert.equal(f.stored.size,1);
});
