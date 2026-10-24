const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
function load(file,stubs={}){const filename=path.resolve(file),mod=new Module(filename,module);mod.filename=filename;mod.paths=module.paths;const original=mod.require.bind(mod);mod.require=id=>Object.hasOwn(stubs,id)?stubs[id]:id.startsWith('.')?load(path.resolve(path.dirname(filename),id+'.ts'),stubs):id.startsWith('@/')?load(id.slice(2)+'.ts',stubs):original(id);mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,filename);return mod.exports;}
const {savedScanRecovery,isRecoveryQuestion}=load('lib/scan-recovery.ts');
test('shared viewers and active workers never receive mutation actions',()=>{
 assert.equal(savedScanRecovery('i',{status:'partial',sourceUrl:'media'},false).actions.length,0);
 for(const scan of [{status:'processing'},{status:'completed',scanReportStatus:'processing'},{status:'completed',reportComparisonStatus:'processing'},{status:'completed',searchIndexStatus:'processing'}])assert.equal(savedScanRecovery('i',scan).actions.length,0);
});
test('recovery distinguishes saved video attempts, derived processing and unavailable sources',()=>{
 assert.deepEqual(savedScanRecovery('i',{status:'partial',sourceUrl:'media',scanReportStatus:'failed'}).actions.map(a=>a.id),['video','processing']);
 assert.deepEqual(savedScanRecovery('i',{status:'completed',reportComparisonStatus:'partial'}).actions.map(a=>a.id),['processing']);
 assert.deepEqual(savedScanRecovery('i',{status:'completed',searchIndexStatus:'failed'}).actions.map(a=>a.id),['processing']);
 assert.equal(savedScanRecovery('i',{status:'failed'}).actions.length,0);
 assert.match(savedScanRecovery('i',{status:'failed'}).message,/no retryable/);
 assert.equal(savedScanRecovery('i',{status:'completed',scanReportStatus:'ready'}).actions.length,0);
});
test('recovery questions bypass evidence generation; normal evidence questions do not',()=>{
 for(const q of ['retry this scan','can you reprocess it','why did the scan fail?','processing stuck'])assert(isRecoveryQuestion(q),q);
 assert(!isRecoveryQuestion('What changed on this wall?'));
});
function routeHarness({owned=true,claimed=true,scan={status:'completed',scanReportStatus:'failed'}}={}){
 const calls=[],jobs=[],record={_id:'id',ownerId:'owner',roomId:'room',...scan};
 const route=load('app/api/inspections/[inspectionId]/retry-processing/route.ts',{
  'next/server':{after:fn=>jobs.push(fn)},
  '@/lib/server/scan-recovery':{recoverExpiredScanRetry:async(_db,scan)=>scan},
  '@/lib/server/access':{requireUser:async()=>({id:'owner'}),requireOwnedInspection:async()=>{if(!owned)throw Object.assign(Error('Inspection not found'),{status:404});return record},requireOwnedRoom:async()=>{}},
  '@/lib/server/db':{getDb:async()=>({collection:()=>({findOneAndUpdate:async(filter,update)=>{calls.push({filter,update});return claimed?record:null},updateOne:async(...args)=>calls.push({cleanup:args})})})},
  '@/lib/server/scan-report':{finishScanReport:async()=>calls.push('report')},
  '@/lib/server/search':{indexFindings:async()=>calls.push('index')},
  '@/lib/server/api-error':{errorResponse:e=>Response.json({error:e.message},{status:e.status||500})},
 });
 return {POST:()=>route.POST(new Request('https://example.com/api/inspections/id/retry-processing',{method:'POST'}),{params:Promise.resolve({inspectionId:'id'})}),calls,jobs};
}
test('processing retry refuses other owners and duplicate claims without scheduling work',async()=>{
 for(const options of [{owned:false},{claimed:false}]){const h=routeHarness(options),r=await h.POST();assert.equal(r.status,options.owned===false?404:409);assert.equal(h.jobs.length,0)}
});
test('processing retry atomically claims a lease, publishes progress then schedules saved-evidence work',async()=>{
 const h=routeHarness(),r=await h.POST();assert.equal(r.status,202);assert.equal(h.jobs.length,1);assert.equal(h.calls[0].update.$set.scanReportStatus,'processing');assert.equal(h.calls[0].filter.ownerId,'owner');assert(h.calls[0].filter.$or);await h.jobs[0]();assert.deepEqual(h.calls.slice(1,3),['report','index']);assert(h.calls[3].cleanup[0].recoveryLease);
});
test('search-only recovery does not regenerate reports or change core evidence status',async()=>{
 const h=routeHarness({scan:{status:'completed',scanReportStatus:'ready',searchIndexStatus:'failed'}});assert.equal((await h.POST()).status,202);await h.jobs[0]();assert(!h.calls.includes('report'));assert(h.calls.includes('index'));assert.equal(h.calls[0].update.$set.searchIndexStatus,'processing');assert.equal(h.calls[0].update.$set.status,undefined);
});
test('a retry prompt returns verified actions without depending on an available AI provider',async()=>{
 let generations=0,lookups=0;
 class LiveError extends Error{}
 const {POST}=load('app/api/scan-chat/route.ts',{
  '@/lib/server/scan-recovery':{scanRecovery:async()=>{lookups++;return {message:'Failed report',actions:[{id:'processing',url:'/api/inspections/id/retry-processing'}]}}},
  '@/lib/server/analysis-failure':{logAIFailure:()=>{}},'@/lib/server/api-error':{errorResponse:e=>{throw e}},
  '@/lib/server/access':{requireUser:()=>{throw Error('Should use verified recovery context')}},'@/lib/server/space-access':{},
  '@/lib/server/live-sessions':{LiveError,validEventId:()=>true,liveFailure:e=>{throw e}},
  '@/lib/server/db':{},'@/lib/server/request-body':{readJsonBody:async()=>({inspectionId:'id',requestId:'request-id',question:'retry this scan'})},
  '@/lib/server/scan-chat':{answerScanQuestion:()=>{generations++;throw Error('Provider unavailable')}},
 });
 const response=await POST(new Request('https://example.com/api/scan-chat',{method:'POST'}));assert.equal(response.status,200);assert.equal((await response.json()).recovery.actions[0].id,'processing');assert.equal(lookups,1);assert.equal(generations,0);
});
test('an expired recovery lease reopens interrupted steps while a live lease leaves them running',async()=>{
 const updates=[];
 const {recoverExpiredScanRetry}=load('lib/server/scan-recovery.ts',{
  './access':{},'./space-access':{},'./live-sessions':{},'./db':{},'./processing-recovery':{recoverStalledInspection:async(_db,s)=>s},
 });
 const db={collection:()=>({updateOne:async(filter,update)=>{updates.push({filter,update});return {modifiedCount:1}}})};
 const live={_id:'id',recoveryLease:'active',recoveryUntil:new Date(Date.now()+60000),scanReportStatus:'processing'};await recoverExpiredScanRetry(db,live);assert.equal(updates.length,0);
 const expired={_id:'id',status:'completed',recoveryLease:'old',recoveryUntil:new Date(Date.now()-60000),scanReportStatus:'processing',reportComparisonStatus:'processing',searchIndexStatus:'ready'};await recoverExpiredScanRetry(db,expired);assert.equal(expired.scanReportStatus,'failed');assert.equal(expired.reportComparisonStatus,'failed');assert.equal(expired.searchIndexStatus,'ready');assert.equal(expired.status,'completed');assert.equal(updates[0].filter.recoveryLease,'old');assert.equal(expired.recoveryLease,undefined);
});
