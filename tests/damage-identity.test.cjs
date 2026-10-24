const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
function load(file,stubs={}){const filename=path.resolve(file),mod=new Module(filename,module);mod.filename=filename;mod.paths=module.paths;const original=mod.require.bind(mod);mod.require=id=>Object.hasOwn(stubs,id)?stubs[id]:id.startsWith('.')?load(path.resolve(path.dirname(filename),id+'.ts'),stubs):original(id);mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,filename);return mod.exports;}
const {sameDamage,canonicalDamageFindings}=load('lib/damage-identity.ts');
const mark=(id,extra={})=>({id,kind:'damage',label:'scuff',source:'ai',reviewStatus:'pending',spatialElementId:'table',worldPosition:[0,0,0],boundingBox:{x:.2,y:.3,width:.1,height:.1},evidenceFrameUrl:`photo-${id}`,timestampSeconds:1,...extra});
test('repeated calibrated views and scratch/scuff wording share one review identity with all evidence retained',()=>{
 const grouped=canonicalDamageFindings([mark('a'),mark('b',{label:'scratch',timestampSeconds:4,worldPosition:[.04,.01,0]})]);
 assert.equal(grouped.length,1);assert.equal(grouped[0].id,'a');assert.deepEqual(grouped[0].sourceObservationIds,['a','b']);assert.equal(grouped[0].evidenceObservations.length,2);
});
test('separate nearby marks in the same source view, different objects, and different scans remain distinct',()=>{
 const a=mark('a');
 for(const other of [mark('b',{boundingBox:{x:.6,y:.3,width:.1,height:.1},worldPosition:[.04,0,0]}),mark('b',{spatialElementId:'other',timestampSeconds:2}),mark('b',{worldPosition:[.3,0,0],timestampSeconds:2}),mark('b',{inspectionId:'second'})]){
  const first={...a,inspectionId:'first'};assert.equal(sameDamage(first,other),false);
 }
 assert.equal(canonicalDamageFindings([mark('a'),mark('b',{timestampSeconds:2,worldPosition:[.08,0,0]}),mark('c',{timestampSeconds:3,worldPosition:[.16,0,0]})]).length,2,'spatial proximity never chains into a large merged area');
});
test('generic labels and uncalibrated boxes cannot merge different camera views',()=>{
 const a=mark('a',{spatialElementId:null,worldPosition:null});assert.equal(sameDamage(a,{...a,id:'b',evidenceFrameUrl:'other',timestampSeconds:2}),false);
 assert.equal(sameDamage({...a,viewSignature:'00'.repeat(256)},{...a,id:'b',timestampSeconds:2,evidenceFrameUrl:'other',viewSignature:'ff'.repeat(256)}),false);
});
test('near-static source pixels group repeated unlocalized observations without a new AI call',()=>{
 const marks=Array.from({length:20},(_,i)=>mark(String(i),{timestampSeconds:i,spatialElementId:null,worldPosition:null,viewSignature:'80'.repeat(256)}));
 const grouped=canonicalDamageFindings(marks);assert.equal(grouped.length,1);assert.equal(grouped[0].evidenceObservations.length,20);
 assert.equal(grouped[0].evidenceObservations[0].viewSignature,undefined,'pixel signatures stay out of evidence payloads and model context');
});
test('dismissed damage stays dismissed; manual marks and conflicting human reviews are preserved',()=>{
 const rejected=mark('a',{reviewStatus:'rejected'}),pending=mark('b',{timestampSeconds:2});
 assert.equal(canonicalDamageFindings([pending,rejected])[0].reviewStatus,'rejected');
 assert.equal(canonicalDamageFindings([mark('a',{source:'manual'}),pending]).length,2);
 assert.equal(canonicalDamageFindings([rejected,mark('b',{timestampSeconds:2,reviewStatus:'confirmed'})]).length,2);
});
test('legacy native markers supply measured anchors and render one marker per grouped finding',async()=>{
 const {groupedDamage,canonicalMarkers}=load('lib/server/damage-groups.ts');
 const marks=[{_id:'a',kind:'damage',label:'scuff',spatialElementId:'table',timestampSeconds:1,evidenceFrameUrl:'one'},{_id:'b',kind:'damage',label:'scratch',spatialElementId:'table',timestampSeconds:2,evidenceFrameUrl:'two'}];
 const markers=[{findingId:'a',elementId:'table',position:[0,0,0]},{findingId:'b',elementId:'table',position:[.02,0,0]}];
 const grouped=await groupedDamage({collection:()=>({find:()=>({toArray:async()=>markers})})},'scan',marks);
 assert.equal(grouped.length,1);assert.equal(canonicalMarkers(markers,grouped).length,1);
});
test('saved comparisons reconcile legacy repeated source IDs without rewriting their originals or reviews',async()=>{
 const {ObjectId}=require('mongodb'),{groupedComparison}=load('lib/server/comparison-dedup.ts');
 const baselineId=new ObjectId(),currentId=new ObjectId(),ids=Array.from({length:4},()=>new ObjectId());
 const originals=ids.map((_id,i)=>({...mark(String(_id),{timestampSeconds:i%2+1}),_id,inspectionId:i<2?baselineId:currentId}));
 const snapshots=originals.map(f=>({id:String(f._id),kind:'damage',label:f.label,evidenceFrameUrl:f.evidenceFrameUrl,timestampSeconds:f.timestampSeconds}));
 const record={baselineInspectionId:baselineId,currentInspectionId:currentId,baseline:snapshots.slice(0,2),current:snapshots.slice(2),reviews:[{status:'pending',note:'Preserve this'}],changes:[{id:'old-one',baselineFindingId:String(ids[0]),currentFindingId:String(ids[2]),category:'pre_existing',comparableView:true,reviewStatus:'pending',explanation:'Same scuff'},{id:'old-two',baselineFindingId:String(ids[1]),currentFindingId:String(ids[3]),category:'potentially_new',comparableView:true,reviewStatus:'pending',explanation:'Repeated source view'}]};
 const db={collection:name=>({find:q=>({toArray:async()=>name==='findings'?originals.filter(f=>String(f.inspectionId)===String(q.inspectionId)):[]})})};
 const grouped=await groupedComparison(db,record);assert.equal(grouped.baseline.length,1);assert.equal(grouped.current.length,1);assert.equal(grouped.changes.length,1);assert.equal(grouped.changes[0].category,'pre_existing');assert.equal(grouped.changes[0].id,'old-one');assert.equal(record.changes.length,2);assert.strictEqual(grouped.reviews,record.reviews);
});
