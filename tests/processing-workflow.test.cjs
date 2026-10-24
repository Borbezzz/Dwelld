const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
function load(file){const filename=path.resolve(file),mod=new Module(filename,module);mod.filename=filename;mod.paths=module.paths;mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename);return mod.exports;}
const {inspectionWorkflow,isInspectionProcessing}=load('lib/processing-workflow.ts'),{stalledProcessingUpdate}=load('lib/server/processing-recovery.ts');
const base={id:'scan',roomId:'room',status:'completed',createdAt:'2026-10-24T00:00:00Z',scanReportStatus:'ready'};
test('scan progress stays active through report, comparison and search, with distinct failed states',()=>{
 for(const field of ['scanReportStatus','reportComparisonStatus','searchIndexStatus']){
  const scan={...base,[field]:'processing'};assert.equal(isInspectionProcessing(scan),true);assert.equal(inspectionWorkflow(scan).filter(row=>row.status==='running').length,1);
 }
 assert.equal(isInspectionProcessing(base),false);assert.equal(inspectionWorkflow({...base,reportComparisonStatus:'failed',reportComparisonError:'Evidence unavailable'}).find(row=>row.key==='compare').status,'failed');
 assert.equal(inspectionWorkflow({...base,scanReportStatus:undefined}).find(row=>row.key==='report').amount,'Unavailable');
});
test('stalled scans become incomplete without discarding ready reports or claiming unassessed views are clear',()=>{
 const now=Date.now(),old={...base,status:'processing',createdAt:new Date(now-8*60_000),reportComparisonStatus:'processing',searchIndexStatus:'processing'};
 const updates=stalledProcessingUpdate(old,now);assert.equal(updates.status,'partial');assert.equal(updates.scanReportStatus,undefined);assert.equal(updates.reportComparisonStatus,'failed');assert.equal(updates.searchIndexStatus,'failed');assert.match(updates.analysisWarnings[0],/source files remain available/);
 assert.equal(stalledProcessingUpdate({...old,analysisStartedAt:new Date(now-60_000)},now),null);
 assert.equal(stalledProcessingUpdate({...old,status:'completed'},now),null);
});
