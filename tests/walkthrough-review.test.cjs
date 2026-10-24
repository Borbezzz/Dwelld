const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
function load(file,stubs={}){const filename=path.resolve(file),mod=new Module(filename,module);mod.filename=filename;mod.paths=module.paths;const original=mod.require.bind(mod);mod.require=id=>Object.hasOwn(stubs,id)?stubs[id]:id.startsWith('.')?load(path.resolve(path.dirname(filename),id+'.ts'),stubs):original(id);mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,filename);return mod.exports;}
const finding=(id,time,kind='damage')=>({id,kind,label:id,timestampSeconds:time,reviewStatus:'pending'});
const {timelineGroups,findingsAtTime}=load('lib/inspection-timeline.ts');
test('timeline groups damage with objects by source timestamp, excludes dismissed and unknown timestamps',()=>{
 const list=[finding('late',10),finding('chair',2,'object'),finding('scratch',2),{...finding('dismissed',4),reviewStatus:'rejected'},finding('unknown',undefined),finding('negative',-1),finding('invalid',NaN)];
 const groups=timelineGroups(list);assert.deepEqual(groups.map(g=>g.time),[2,10]);assert.equal(groups[0].items.length,2);assert(groups[0].damage);
});
test('boxes never drift onto unrelated times between sampled video frames',()=>{
 const list=[finding('a',2),finding('b',5)];assert.deepEqual(findingsAtTime(list,2).map(f=>f.id),['a']);assert.equal(findingsAtTime(list,3).length,0);assert.deepEqual(findingsAtTime(list,5.1).map(f=>f.id),['b']);
});
test('live request network errors describe connection recovery instead of scan failure',async()=>{
 const {liveRequest}=load('lib/client/live-api.ts'),original=global.fetch;
 try{global.fetch=async()=>{throw new TypeError('Failed to fetch')};await assert.rejects(liveRequest('session','token'),/Reconnecting automatically/);}finally{global.fetch=original;}
});
test('video checkpoints publish evidence before AI and retain reviewed findings without duplicates',async()=>{
 const {ObjectId}=require('mongodb');const object={kind:'object',label:'chair',detectionId:'object1',parentDetectionId:null,timestampSeconds:1},damage={kind:'damage',label:'scratch',detectionId:'damage1',parentDetectionId:'object1',timestampSeconds:1};
 const docs=[],updates=[];let checkpointsVisible=false;
 const db={collection:name=>name==='findings'?{insertMany:async items=>docs.push(...items)}:{updateOne:async(q,u)=>updates.push(u.$set)}};
 const {runVideoInspection}=load('lib/server/run-video-inspection.ts',{
  './inspection':{analyzeVideo:async(url,mime,frames,publish)=>{
   const point={phase:'checking',durationSeconds:2,totalFrames:2,processedFrames:0,findings:[object],evidenceFrames:[{timestampSeconds:1,url:'gridfs:photo'}],analysisRunId:'run1',warnings:[]};
   await publish(point);assert.equal(docs.length,1);assert.equal(updates.at(-1).analysisProgress.processedFrames,0);checkpointsVisible=true;
   docs[0].reviewStatus='confirmed';await Promise.all([publish({...point,processedFrames:1,findings:[object,damage]}),publish({...point,processedFrames:2,findings:[object,damage]})]);
   return {...point,findings:[object,damage]};
  }},
  './verify':{autoReviewInspection:async()=>({checked:0,approved:0})},'./search':{indexFindings:async()=>{}},'./api-error':{reportError:()=>{throw new Error('unexpected failure')}},
 });
 await runVideoInspection(db,new ObjectId(),'owner',new ObjectId(),'gridfs:video','video/mp4',[]);
 assert(checkpointsVisible);assert.equal(docs.length,2);assert.equal(docs[0].reviewStatus,'confirmed');assert.equal(String(docs[1].objectId),String(docs[0]._id));assert.equal(updates.at(-1).status,'completed');assert.equal(updates.at(-1)['analysisProgress.phase'],'complete');
});
test('live camera metadata accepts measured boxes and damage pins but rejects invalid peer payloads',()=>{
 const {parseVideoMarkers}=load('lib/client/live-markers.ts');
 const box={id:'chair',kind:'object',label:'Chair',boundingBox:{x:.1,y:.2,width:.3,height:.4}},pin={id:'scratch',kind:'damage',label:'Scratch',point:{x:.5,y:.6}};
 assert.deepEqual(parseVideoMarkers([box,pin]),[box,pin]);
 assert.deepEqual(parseVideoMarkers([{...box,boundingBox:{x:.9,y:0,width:.5,height:.2}},{...pin,point:{x:Infinity,y:0}},{...box,kind:'arbitrary'},null]),[]);
 assert.equal(parseVideoMarkers(Array(150).fill(box)).length,100);
});

test('still-photo boxes appear only on their exact source second, never an adjacent pose',()=>{
 const {findingsForSourceFrame}=load('lib/inspection-timeline.ts');
 const list=[finding('source',1),finding('nearby',1.5),finding('later',2)];
 assert.deepEqual(findingsForSourceFrame(list,1).map(f=>f.id),['source']);
 assert.deepEqual(findingsForSourceFrame(list,1.5).map(f=>f.id),['nearby']);
 assert.equal(findingsForSourceFrame(list,1.2).length,0);
});
