const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript'),{ObjectId}=require('mongodb');
function load(file,stubs){const filename=path.resolve(file),mod=new Module(filename,module);mod.filename=filename;mod.paths=module.paths;const original=mod.require.bind(mod);mod.require=id=>Object.hasOwn(stubs,id)?stubs[id]:original(id);mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,filename);return mod.exports;}
function fixture(){
 const inspection={_id:new ObjectId(),roomId:new ObjectId(),ownerId:'owner'},findingId=new ObjectId(),markerId=new ObjectId(),writes=[],inserted=[];
 let changed=false,denied=false;
 const capture={manifest:{sessionId:'scan',elements:[],frames:[{image:'photo.jpg',timestamp:0}],assets:[{name:'photo.jpg',kind:'image',mediaRef:'private-photo'}]}};
 const db={collection:name=>({findOne:async()=>name==='spatialCaptures'?capture:name==='spatialMarkers'?{_id:markerId,findingId:String(findingId),version:1}:{_id:findingId,reviewStatus:'rejected'},insertOne:async doc=>inserted.push({name,doc}),updateOne:async(q,u)=>{writes.push({name,q,u});return {modifiedCount:changed?0:1};}})};
 const route=load('app/api/inspections/[inspectionId]/spatial/markers/route.ts',{
  '@/lib/server/request-body':{readJsonBody:r=>r.json()},
  '@/lib/server/access':{requireUser:async()=>({id:'owner'}),requireOwnedInspection:async()=>{if(denied)throw Object.assign(new Error('Forbidden'),{status:403});return inspection;}},
  '@/lib/server/db':{getDb:async()=>db,parseObjectId:s=>ObjectId.isValid(s)?new ObjectId(s):null},
  '@/lib/server/api-error':{errorResponse:e=>Response.json({error:e.message},{status:e.status||500})},
  '@/lib/server/spatial':{vector:p=>Array.isArray(p)&&p.length===3},
  '@/lib/server/media':{readMedia:async()=>Buffer.from('photo'),writeMedia:async()=>'gridfs:'+'0'.repeat(24)},
  '@/lib/server/video-mark':{placeVideoPoint:()=>({error:'not used in these tests'})},
  '@/lib/server/ledger':{sealLater:async()=>{}},
  '@/lib/server/analysis-failure':{logAIFailure:()=>{}},
  '@/lib/spatial/furniture':{isFurniture:()=>false},
  '@/lib/server/damage':{describeAtPoint:async()=>({label:'Scratch',type:'scratch',description:'Marked scratch',boundingBox:null})},
  '@/lib/server/projection':{projectPoint:()=>({x:.5,y:.5})},
 });
 const post=body=>route.POST(new Request('https://dwelld.dev/markers',{method:'POST',body:JSON.stringify(body)}),{params:Promise.resolve({inspectionId:String(inspection._id)})});
 return {post,writes,inserted,findingId,markerId,inspection,setChanged:v=>changed=v,setDenied:v=>denied=v};
}
test('marker confirmation, rejection and movement synchronize the linked finding',async()=>{
 for(const [action,expected] of [['confirm','confirmed'],['reject','rejected'],['move','pending']]){
  const f=fixture();const response=await f.post({action,id:String(f.markerId),version:1,position:[0,0,0]});assert.equal(response.status,200);
  const marker=f.writes.find(w=>w.name==='spatialMarkers'),finding=f.writes.find(w=>w.name==='findings');
  assert.equal(marker.u.$set.reviewStatus,expected);assert.equal(finding.u.$set.reviewStatus,expected);assert.equal(finding.u.$set.autoApproved,false);assert.equal(String(finding.q.inspectionId),String(f.inspection._id));
 }
});
test('a concurrent marker update cannot change the finding after losing its version check',async()=>{
 const f=fixture();f.setChanged(true);assert.equal((await f.post({action:'confirm',id:String(f.markerId),version:1})).status,409);assert(!f.writes.some(w=>w.name==='findings'));
});
test('new markers inherit their existing finding review status',async()=>{
 const f=fixture();assert.equal((await f.post({action:'add',position:[0,0,0],findingId:String(f.findingId)})).status,201);
 assert.equal(f.inserted.find(i=>i.name==='spatialMarkers').doc.reviewStatus,'rejected');
});
test('a manually confirmed observation starts with a matching confirmed marker',async()=>{
 const f=fixture();assert.equal((await f.post({action:'add',position:[0,0,0]})).status,201);
 assert.equal(f.inserted.find(i=>i.name==='findings').doc.reviewStatus,'confirmed');assert.equal(f.inserted.find(i=>i.name==='spatialMarkers').doc.reviewStatus,'confirmed');
});
test('read-only users cannot mutate markers or linked findings',async()=>{
 const f=fixture();f.setDenied(true);assert.equal((await f.post({action:'confirm',id:String(f.markerId),version:1})).status,403);assert.deepEqual(f.writes,[]);
});
