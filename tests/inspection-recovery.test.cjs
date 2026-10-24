const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const {ObjectId}=require('mongodb');
function load(file,stubs){const filename=path.resolve(file),mod=new Module(filename,module);mod.filename=filename;mod.paths=module.paths;const original=mod.require.bind(mod);mod.require=id=>Object.hasOwn(stubs,id)?stubs[id]:original(id);mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,filename);return mod.exports;}
function fixture(){
 const source={_id:new ObjectId(),ownerId:'owner',roomId:new ObjectId(),status:'partial',sourceUrl:'gridfs:'+new ObjectId(),videoMimeType:'video/mp4',detectionFrames:[{timestampSeconds:0,detections:[]}]};
 const records=new Map([[String(source._id),source]]),jobs=[],runs=[];
 const collection={
  findOne:async q=>{const doc=records.get(String(q._id));return doc&&doc.ownerId===q.ownerId?doc:null;},
  findOneAndUpdate:async(q,u)=>{const doc=records.get(String(q._id));if(!doc||doc.retryInspectionId)return null;Object.assign(doc,u.$set);return doc;},
  updateOne:async(q,u)=>{const doc=records.get(String(q._id));if(doc&&String(doc.retryInspectionId)===String(q.retryInspectionId))delete doc.retryInspectionId;},
  insertOne:async doc=>records.set(String(doc._id),doc),
 };
 const {POST}=load('app/api/inspections/[inspectionId]/retry/route.ts',{
  'next/server':{NextResponse:require('next/server').NextResponse,after:fn=>jobs.push(fn)},
  '@/lib/server/access':{requireUser:async req=>{if(req.headers.get('x-test-owner')!=='owner')throw new Error('denied');return {id:'owner'};},requireOwnedInspection:async(id,owner)=>{const doc=records.get(id);assert.equal(doc.ownerId,owner);return doc;},requireOwnedRoom:async(id,owner)=>assert.equal(owner,source.ownerId)},
  '@/lib/server/api-error':{errorResponse:()=>Response.json({error:'denied'},{status:401})},
  '@/lib/server/db':{getDb:async()=>({collection:()=>collection})},
  '@/lib/server/media':{parseMediaId:()=>true,getMediaFile:async()=>({metadata:{ownerId:'owner'}})},
  '@/lib/server/inspection':{validateDetectionFrames:frames=>frames},
  '@/lib/server/run-video-inspection':{runVideoInspection:async(...args)=>runs.push(args)},
 });
 const request=(owner='owner')=>new Request('http://localhost/api/retry',{method:'POST',headers:{'x-test-owner':owner}});
 const params={params:Promise.resolve({inspectionId:String(source._id)})};
 return {source,records,jobs,runs,POST,request,params};
}
test('saved-video retry requires authentication before reading or creating records',async()=>{
 const f=fixture();const response=await f.POST(f.request('stranger'),f.params);assert.equal(response.status,401);assert.equal(f.records.size,1);assert.equal(f.jobs.length,0);
});
test('retry creates a new attempt without changing old results, and duplicate requests reuse it',async()=>{
 const f=fixture();const response=await f.POST(f.request(),f.params);assert.equal(response.status,201);const {inspection}=await response.json();assert.notEqual(inspection.id,String(f.source._id));const created=f.records.get(inspection.id);assert.equal(created.sourceUrl,f.source.sourceUrl);assert.equal(created.ownerId,f.source.ownerId);assert.equal(f.source.status,'partial');assert.equal(created.status,'processing');
 const duplicate=await f.POST(f.request(),f.params);assert.equal((await duplicate.json()).inspection.id,inspection.id);assert.equal(f.records.size,2);assert.equal(f.jobs.length,1);await f.jobs[0]();assert.equal(f.runs.length,1);
});
test('a retry being prepared cannot have its atomic link cleared by another request',async()=>{
 const f=fixture();f.source.retryInspectionId=new ObjectId();f.source.retryRequestedAt=new Date();const response=await f.POST(f.request(),f.params);assert.equal(response.status,409);assert.equal(f.records.size,1);assert.equal(f.jobs.length,0);assert(f.source.retryInspectionId);
});
test('completed inspections do not create redundant retry jobs',async()=>{
 const f=fixture();f.source.status='completed';assert.equal((await f.POST(f.request(),f.params)).status,409);assert.equal(f.records.size,1);
});
test('deleting one retry preserves its shared source video until the last attempt is removed',async()=>{
 const video='gridfs:'+new ObjectId(),photo='gridfs:'+new ObjectId();
 const original={_id:new ObjectId(),ownerId:'owner',sourceUrl:video,evidenceFrames:[{url:photo}]};
 const retry={_id:new ObjectId(),ownerId:'owner',sourceUrl:video};
 const records=new Map([[String(original._id),original],[String(retry._id),retry]]),deleted=[];
 const db={collection:name=>({find:()=>({toArray:async()=>[]}),deleteMany:async()=>{},deleteOne:async q=>records.delete(String(q._id)),findOne:async q=>[...records.values()].find(d=>d.sourceUrl===q.sourceUrl)})};
 const {deleteInspection}=load('lib/server/delete.ts',{'./db':{getDb:async()=>db},'./media':{deleteMedia:async ref=>deleted.push(ref)}});
 await deleteInspection(original);assert.deepEqual(deleted,[photo]);assert(records.has(String(retry._id)));
 await deleteInspection(retry);assert.deepEqual(deleted,[photo,video]);
});
