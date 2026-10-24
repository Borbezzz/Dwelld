const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),Module=require('module'),ts=require('typescript');
function load(file){const filename=path.resolve(file),mod=new Module(filename,module);mod.filename=filename;mod.paths=module.paths;const original=mod.require.bind(mod);mod.require=id=>id.startsWith('.')?load(path.resolve(path.dirname(filename),id+'.ts')):original(id);mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename);return mod.exports;}
const mod={exports:load('lib/client/native-playback.ts')};
const {recordedSegments,findingsInRecording}=mod.exports;
test('continued scans keep separate video segments with finding timestamps local to the chosen recording',()=>{
 const old={name:'first.mp4',kind:'video',startTimeSeconds:0,durationSeconds:10},next={name:'second.mp4',kind:'video',startTimeSeconds:11,durationSeconds:8};
 assert.deepEqual(recordedSegments([next,{kind:'image',name:'photo.jpg'},old]),[old,next]);
 const findings=[{id:'old',timestampSeconds:2},{id:'mark',timestampSeconds:13},{id:'gap',timestampSeconds:10.5},{id:'end',timestampSeconds:19}];
 assert.deepEqual(findingsInRecording(findings,next),[{id:'mark',timestampSeconds:2}]);assert.equal(findings[1].timestampSeconds,13);
});
test('selecting a manual mark opens its exact saved snapshot even when a video is available',()=>{
 const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
 const file=path.resolve('components/evidence-viewer.tsx'),view=new Module(file,module);view.filename=file;view.paths=module.paths;
 view.require=id=>id==='./finding-callouts'?()=>null:id==='./walkthrough-player'?()=>React.createElement('video',{'data-wrong-source':'nearby video frame'}):require(id);
 view._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,file);
 const html=renderToStaticMarkup(React.createElement(view.exports.default,{title:'Marked scratch',videoUrl:'/recording.mp4',items:[{id:'mark',tone:'damage',label:'Scratch',image:'gridfs:exact-tapped-snapshot',timestampSeconds:3.14159,box:{x:.4,y:.4,width:.1,height:.1}}],onClose:()=>{}}));
 assert(html.includes(encodeURIComponent('gridfs:exact-tapped-snapshot')));assert(!html.includes('data-wrong-source'));assert(!html.includes('class="evidence-box'));
});
test('continuations preserve both videos, offset new timestamps after the earlier recording, and retain offset on retry',async()=>{
 const {ObjectId}=require('mongodb'),id=new ObjectId(),session={_id:new ObjectId(),continueFrom:id,ownerId:'owner'},capture={_id:new ObjectId(),manifest:{version:1,sessionId:'old',coordinateSystem:'arkit-right-handed-y-up-metres',elements:[],frames:[{image:'old.jpg',timestamp:5}],assets:[{name:'old.mp4',kind:'video',mediaRef:'old-ref',startTimeSeconds:0,durationSeconds:10,fps:30}]}};
 let saved;
 const file=path.resolve('lib/server/continuation.ts'),code=new Module(file,module);code.filename=file;code.paths=module.paths;
 code.require=name=>name==='./db'?{getDb:async()=>({collection:collection=>({findOne:async()=>collection==='spatialCaptures'?capture:{_id:id},updateOne:async(q,u)=>{saved=u;return {modifiedCount:1}}})})}:name==='./media'?{}:{isFurniture:()=>true,categoryKey:x=>x};
 code._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
 const part={sessionId:'new',elements:[],frames:[{image:'new.jpg',timestamp:1}],assets:[{name:'new.jpg',kind:'image',mediaRef:'photo-ref'},{name:'walkthrough.mp4',kind:'video',mediaRef:'new-ref',startTimeSeconds:0,durationSeconds:8,fps:30}]};
 const result=await code.exports.saveContinuation(session,part);assert.equal(result.timestampOffset,11);assert.equal(saved.$set.manifest.frames[1].timestamp,12);assert.equal(saved.$set.manifest.assets.filter(a=>a.kind==='video').length,2);assert.equal(saved.$set.manifest.assets.find(a=>a.mediaRef==='new-ref').startTimeSeconds,11);
 capture.parts=[saved.$push.parts];assert.equal((await code.exports.saveContinuation(session,part)).timestampOffset,11);
});
