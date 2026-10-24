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
test('one damage identity shows only its own supporting source box at each timestamp, with one timeline entry',()=>{
 const f={...finding('scuff',1),boundingBox:{x:.1,y:.1,width:.1,height:.1},evidenceObservations:[{timestampSeconds:1,evidenceFrameUrl:'photo-a',boundingBox:{x:.1,y:.1,width:.1,height:.1}},{timestampSeconds:2,evidenceFrameUrl:'photo-b',boundingBox:{x:.6,y:.6,width:.1,height:.1}}]};
 assert.equal(timelineGroups([f]).length,1);assert.equal(findingsAtTime([f],2)[0].id,'scuff');assert.equal(findingsAtTime([f],2)[0].boundingBox.x,.6);assert.equal(findingsAtTime([f],2)[0].evidenceFrameUrl,'photo-b');assert.equal(findingsAtTime([f],3).length,0);
});
test('video checkpoint repeats update supporting evidence rather than creating new damage or resetting review',async()=>{
 const {ObjectId}=require('mongodb'),docs=[];
 const damage=(id,t)=>({kind:'damage',label:'scuff',detectionId:id,parentDetectionId:null,timestampSeconds:t,viewSignature:'80'.repeat(256),boundingBox:{x:.2,y:.3,width:.1,height:.1},evidenceFrameUrl:'photo-'+t});
 const db={collection:name=>name==='findings'?{insertMany:async rows=>docs.push(...rows),updateOne:async(q,u)=>Object.assign(docs.find(f=>String(f._id)===String(q._id)),u.$set)}:{updateOne:async()=>{}}};
 const {runVideoInspection}=load('lib/server/run-video-inspection.ts',{'./inspection':{analyzeVideo:async(url,mime,frames,publish)=>{const point={phase:'checking',durationSeconds:3,totalFrames:2,processedFrames:1,findings:[damage('first',1)],evidenceFrames:[],analysisRunId:'test',warnings:[]};await publish(point);docs[0].reviewStatus='confirmed';await publish({...point,processedFrames:2,findings:[...point.findings,damage('second',2)]});return {...point,findings:[]};}},'./verify':{autoReviewInspection:async()=>null},'./scan-report':{finishScanReport:async()=>{}},'./search':{indexFindings:async()=>{}},'./api-error':{reportError:e=>{throw e;}}});
 await runVideoInspection(db,new ObjectId(),'owner',new ObjectId(),'video','video/mp4',[]);
 assert.equal(docs.length,1);assert.equal(docs[0].reviewStatus,'confirmed');assert.equal(docs[0].evidenceObservations.length,2);assert.deepEqual(docs[0].sourceObservationIds,['first','second']);
});
