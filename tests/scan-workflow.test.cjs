const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
function load(file,stubs={}){const filename=path.resolve(file),mod=new Module(filename,module);mod.filename=filename;mod.paths=module.paths;const original=mod.require.bind(mod);mod.require=id=>Object.hasOwn(stubs,id)?stubs[id]:id.startsWith('.')?load(path.resolve(path.dirname(filename),id+'.ts'),stubs):original(id);mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,filename);return mod.exports;}
const {batchSummaries}=load('lib/live/batches.ts'),{scanWorkflow}=load('lib/live/workflow.ts');
const frame=(status,extra={})=>({batchId:'batch',workerSlot:0,name:'frame.jpg',ref:'private-frame',timestampSeconds:1,status,...extra});
test('only fully assessed, warning-free batches receive a clear result',()=>{
 assert.equal(batchSummaries([frame('done',{findings:0})])[0].status,'clear');
 assert.equal(batchSummaries([frame('done',{findings:0,warnings:['One check could not finish']})])[0].status,'unassessed');
 assert.equal(batchSummaries([frame('done'),frame('queued',{timestampSeconds:2})])[0].status,'queued');
 assert.equal(batchSummaries([frame('failed',{error:'Timed out'})])[0].status,'failed');
 assert.equal(batchSummaries([frame('analyzing',{attempt:2})])[0].status,'retrying');
});
test('batch overlay evidence always comes from the selected source frame, with measured object IDs',()=>{
 const result=batchSummaries([frame('done',{timestampSeconds:1,findings:0,views:[{elementId:'chair',category:'chair',box:{x:.1,y:.1,width:.2,height:.2}}]}),frame('done',{timestampSeconds:2,ref:'damage-photo',findings:1,observations:[{label:'Tear',boundingBox:{x:.5,y:.5,width:.1,height:.1}}],views:[{elementId:'bed',category:'bed',box:{x:.2,y:.1,width:.6,height:.8}}]})])[0];
 assert.equal(result.status,'findings');assert.equal(result.evidenceRef,'damage-photo');assert.equal(result.timestampSeconds,2);assert.equal(result.objects[0].id,'bed');assert.equal(result.observations[0].label,'Tear');assert.equal(result.findingCount,1);
});
test('100% transferred does not become save confirmed, and failed checks do not become completed',()=>{
 const rows=scanWorkflow({status:'connected',nativeProgress:{stage:'uploading',upload:1},analysisProgress:{checked:5,checking:0,queued:0,failed:1}});
 assert.equal(rows.find(r=>r.key==='upload').status,'running');assert.equal(rows.find(r=>r.key==='analyse').status,'partial');assert.equal(rows.find(r=>r.key==='report').status,'waiting');
 const saved=scanWorkflow({status:'saved',analysisProgress:{checked:6,checking:0,queued:0,failed:0},workflow:{reportStatus:'failed',searchStatus:'partial',searchError:'3 observations pending'}});
 assert.equal(saved[0].status,'done');assert.equal(saved.find(r=>r.key==='report').status,'failed');assert.equal(saved.find(r=>r.key==='search').status,'partial');
});
test('temporary AI failures retry with bounded backoff and preserve the eventual result',async()=>{
 const {retryAnalysis}=load('lib/server/analysis-retry.ts');let calls=0;const attempts=[],waits=[];
 assert.equal(await retryAnalysis(async()=>{if(++calls<3)throw Object.assign(Error('unavailable'),{status:503});return 'real result';},{deadlineMs:Date.now()+200000,onRetry:async n=>attempts.push(n),wait:async ms=>waits.push(ms)}),'real result');
 assert.equal(calls,3);assert.deepEqual(attempts,[2,3]);assert.deepEqual(waits,[1000,2000]);
});
test('billing, authorization and rate limits do not trigger a retry storm; exhausted failures propagate',async()=>{
 const {retryAnalysis}=load('lib/server/analysis-retry.ts');for(const error of [Object.assign(Error('Monthly spending cap exceeded'),{status:429}),Object.assign(Error('forbidden'),{status:403}),Object.assign(Error('RESOURCE_EXHAUSTED'),{status:429})]){let calls=0;await assert.rejects(retryAnalysis(async()=>{calls++;throw error;},{deadlineMs:Date.now()+200000,wait:async()=>{}}));assert.equal(calls,1);}
 let calls=0;await assert.rejects(retryAnalysis(async()=>{calls++;throw Object.assign(Error('timeout'),{status:503});},{deadlineMs:Date.now()+200000,wait:async()=>{}}));assert.equal(calls,3);
});
test('lost upload final acknowledgement is recovered without resending completed bytes',async()=>{
 const {finalizeUpload}=load('lib/client/upload-finalize.ts');let completes=0,checks=0;
 const result=await finalizeUpload(async()=>{completes++;throw TypeError('network interrupted');},async()=>{checks++;return checks===1?{status:'finalizing'}:{status:'complete',url:'gridfs:saved'};},{wait:async()=>{}});
 assert.equal(result.url,'gridfs:saved');assert.equal(completes,1);assert.equal(checks,2);
});
test('upload retries retain successful parts and never retry forbidden uploads',async()=>{
 const {uploadChunks}=load('lib/client/upload-chunks.ts'),parts=new Set([0]),calls=[];
 await uploadChunks(new Blob(['abcdef']),2,async part=>calls.push(part),undefined,2,{completedParts:parts,wait:async()=>{}});assert.deepEqual(calls.sort(),[1,2]);assert.equal(parts.size,3);
 let denied=0;await assert.rejects(uploadChunks(new Blob(['ab']),2,async()=>{denied++;throw Object.assign(Error('Forbidden'),{status:403});},undefined,1,{wait:async()=>{}}));assert.equal(denied,1);
});
