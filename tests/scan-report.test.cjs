const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const {ObjectId}=require('mongodb');
function load(stubs){const filename=path.resolve('lib/server/scan-report.ts'),mod=new Module(filename,module);mod.filename=filename;mod.paths=module.paths;const original=mod.require.bind(mod);mod.require=id=>Object.hasOwn(stubs,id)?stubs[id]:original(id);mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,filename);return mod.exports;}
function fixture(raw,readImage=async()=>Buffer.from("image")){
 const id=new ObjectId(),updates=[],requests=[],inspection={_id:id,ownerId:'owner',roomId:new ObjectId(),type:'move-in',evidenceFrames:[{url:'gridfs:a',timestampSeconds:1},{url:'gridfs:a',timestampSeconds:1},{url:'gridfs:b',timestampSeconds:2}]};
 const db={collection:name=>name==='inspections'?{findOne:async()=>inspection,updateOne:async(q,u)=>updates.push({name,q,u})}:name==='findings'?{find:()=>({limit:()=>({toArray:async()=>[{label:'Pillows',userNote:'There are ten pillows',timestampSeconds:1}]})}),updateOne:async(q,u)=>updates.push({name,q,u})}:{findOne:async()=>null}};
 const client=load({'@google/genai':{GoogleGenAI:class{models={generateContent:async args=>{requests.push(args);return {text:JSON.stringify(raw)}}}}},sharp:()=>({rotate(){return this},resize(){return this},jpeg(){return this},toBuffer:async()=>Buffer.from('pixels')}),'./media':{readMedia:readImage},'./comparison':{compareInspections:async()=>{throw Error('move-in must not compare')}}});
 return {id,db,updates,requests,client,inspection};
}
const report={summary:'A bed with two white pillows.',inventory:[{label:'pillows',count:2,description:'Two white pillows on the bed; no visible stains.',timestampSeconds:1}],limitations:['The wardrobe interior is not visible.']};
test('room report deduplicates views, verifies notes from pixels, retains count evidence and creates searchable text',async()=>{
 const saved=process.env.GEMINI_API_KEY;process.env.GEMINI_API_KEY='test';try{
  const f=fixture(report),result=await f.client.generateScanReport(f.db,f.id);
  assert.equal(f.requests[0].contents.filter(p=>p.inlineData).length,2);
  assert.match(f.requests[0].config.systemInstruction,/Deduplicate repeated views/);
  assert.match(f.requests[0].config.systemInstruction,/visually double-check/);
  assert.equal(result.inventory[0].count,2);assert.equal(result.inventory[0].evidenceFrameUrl,'gridfs:a');
  const entry=f.updates.find(u=>u.name==='findings');assert.equal(entry.u.$set.ownerId,'owner');assert.match(entry.u.$set.description,/2 pillows/);assert.equal(entry.u.$set.reportEntry,true);assert.equal(entry.u.$unset.embedding,'');
 }finally{if(saved===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=saved;}
});
test('invented evidence timestamps and invalid counts cannot become inventory records',async()=>{
 const saved=process.env.GEMINI_API_KEY;process.env.GEMINI_API_KEY='test';try{
  for(const item of [{...report.inventory[0],timestampSeconds:999},{...report.inventory[0],count:-1},{...report.inventory[0],count:1.5}]){
   const f=fixture({...report,inventory:[item]});await assert.rejects(f.client.generateScanReport(f.db,f.id),/Invalid inventory evidence/);assert.equal(f.updates.length,0);
  }
 }finally{if(saved===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=saved;}
});
test('report failures preserve scan evidence and expose an unavailable report rather than an empty success',async()=>{
 const f=fixture(report);f.inspection.evidenceFrames=[];await f.client.finishScanReport(f.db,f.id);
 assert.equal(f.updates.at(-1).u.$set.scanReportStatus,'failed');assert.match(f.updates.at(-1).u.$set.scanReportError,/No readable images/);assert.equal(f.updates.at(-1).u.$set.status,undefined);
});

test('parallel report image loading is bounded and preserves chronological model inputs when reads finish out of order',async()=>{
 const saved=process.env.GEMINI_API_KEY;process.env.GEMINI_API_KEY='test';let active=0,peak=0;
 try{
  const f=fixture(report,async ref=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,ref.endsWith('0')?15:1));active--;return Buffer.from('image');});
  f.inspection.evidenceFrames=Array.from({length:10},(_,i)=>({url:'gridfs:'+i,timestampSeconds:i+1}));
  await f.client.generateScanReport(f.db,f.id);
  const stamps=f.requests[0].contents.filter(p=>p.text?.startsWith('timestampSeconds=')).map(p=>Number(p.text.split('=')[1]));
  assert.deepEqual(stamps,[1,2,3,4,5,6,7,8,9,10]);assert(peak>1);assert(peak<=4);
 }finally{if(saved===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=saved;}
});
test('checkout uses the selected check-in and persists its identity before running the comparison',async()=>{
 const previous=process.env.GEMINI_API_KEY;process.env.GEMINI_API_KEY='test';
 const baselineId=new ObjectId(),current={_id:new ObjectId(),ownerId:'owner',roomId:new ObjectId(),type:'move-out',baselineInspectionId:baselineId,createdAt:new Date(),evidenceFrames:[{url:'gridfs:a',timestampSeconds:1}]},baseline={_id:baselineId};
 const writes=[];let query,compared;
 const inspections={findOne:async()=>current,updateOne:async(q,u)=>writes.push(u),find:q=>{query=q;return {sort:()=>({limit:()=>({next:async()=>baseline})})};}};
 const db={collection:name=>name==='inspections'?inspections:name==='findings'?{find:()=>({limit:()=>({toArray:async()=>[]})}),updateOne:async()=>{}}:name==='comparisons'?{insertOne:async()=>({insertedId:new ObjectId()})}:{findOne:async()=>null}};
 const client=load({'@google/genai':{GoogleGenAI:class{models={generateContent:async()=>({text:JSON.stringify(report)})}}},sharp:()=>({rotate(){return this},resize(){return this},jpeg(){return this},toBuffer:async()=>Buffer.from('pixels')}),'./media':{readMedia:async()=>Buffer.from('image')},'./comparison':{compareInspections:async(b,c,options)=>{compared=[b,c];assert(writes.some(w=>w.$set?.reportComparisonStatus==='processing'&&String(w.$set.baselineInspectionId)===String(baselineId)));await options.onProgress({phase:'Loading comparison images',processed:1,total:2});return {changes:[]};}}});
 try{await client.finishScanReport(db,current._id);assert.equal(String(query._id),String(baselineId));assert.equal(String(query.roomId),String(current.roomId));assert.equal(compared[0],baseline);assert.equal(compared[1],current);assert(writes.some(w=>w.$set?.comparisonProgress?.processed===1));assert.equal(writes.at(-1).$set.scanReportStatus,'ready');}
 finally{if(previous===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=previous;}
});
