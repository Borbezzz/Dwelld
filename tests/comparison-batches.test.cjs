const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
function load(file,stubs={}){const filename=path.resolve(file),mod=new Module(filename,module);mod.filename=filename;mod.paths=module.paths;const original=mod.require.bind(mod);mod.require=id=>Object.hasOwn(stubs,id)?stubs[id]:id.startsWith('.')?load(path.resolve(path.dirname(filename),id+'.ts'),stubs):id.startsWith('@/')?load(id.slice(2)+'.ts',stubs):original(id);mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,filename);return mod.exports;}
const {comparisonBatches,runComparisonBatches}=load('lib/server/comparison-batches.ts'),{comparisonProgressView}=load('lib/comparison-progress.ts');
const evidence=(prefix,count)=>Array.from({length:count},(_,i)=>({id:prefix+i,kind:'damage',label:'scuff'}));
const baseline=evidence('b',20),current=evidence('c',20),images={processed:16,total:16,usable:16};
const change=(b,c,category='pre_existing')=>({id:'candidate',baselineFindingId:b,currentFindingId:c,category,explanation:'Visible same mark',comparableView:true,reviewStatus:'pending'});
test('comparison targets are assigned once across at most four balanced parallel batches',()=>{
 const batches=comparisonBatches(baseline,current);assert.equal(batches.length,4);
 assert.deepEqual(batches.flatMap(b=>b.baselineIds).sort(),baseline.map(f=>f.id).sort());assert.deepEqual(batches.flatMap(b=>b.currentIds).sort(),current.map(f=>f.id).sort());
 assert(batches.every(b=>b.baselineIds.length+b.currentIds.length===10));assert.equal(comparisonBatches(evidence('a',1),evidence('b',1)).length,1);
});
test('four provider batches run together and independent completions advance durable progress before a slow batch finishes',async()=>{
 let active=0,peak=0,started=0,allStarted,release,releaseSlow;const ready=new Promise(r=>allStarted=r),gate=new Promise(r=>release=r),slow=new Promise(r=>releaseSlow=r),progress=[];
 const run=runComparisonBatches(baseline,current,async batch=>{active++;peak=Math.max(peak,active);if(++started===4)allStarted();await gate;if(batch.id==='batch-1')await slow;active--;return [change(batch.baselineIds[0],batch.currentIds[0])];},{deadlineMs:Date.now()+200000,images,onProgress:async p=>progress.push(p)});
 await ready;assert.equal(peak,4);release();await new Promise(setImmediate);assert(progress.some(p=>p.batches.filter(b=>b.status==='done').length===3));assert.equal(progress.at(-1).batches[0].status,'running');releaseSlow();const result=await run;
 assert.equal(result.changes.length,4);assert.equal(new Set(result.changes.map(c=>c.id)).size,4);assert.equal(result.partial,false);assert.equal(result.progress.stage,'save');
});
test('failed batches remain unassessed while successful results survive; a total failure never becomes an empty success',async()=>{
 const options={deadlineMs:Date.now()+200000,images};
 const result=await runComparisonBatches(baseline,current,async batch=>{if(batch.id==='batch-2')throw Object.assign(Error('forbidden'),{status:403});return [change(batch.baselineIds[0],batch.currentIds[0])];},options);
 assert.equal(result.partial,true);assert.equal(result.changes.length,3);assert.equal(result.progress.batches.filter(b=>b.status==='failed').length,1);assert.match(result.warnings[0],/unassessed/);
 await assert.rejects(runComparisonBatches(baseline,current,async()=>{throw Object.assign(Error('forbidden private provider details'),{status:403});},options),/No comparison batches finished/);
});
test('merging batch results drops context-only output and suppresses duplicate scuffs across workers',async()=>{
 const result=await runComparisonBatches(baseline,current,async batch=>[
  change('b1','c0',batch.id==='batch-1'?'potentially_new':'pre_existing'),change('foreign-b','foreign-c')
 ],{deadlineMs:Date.now()+200000,images});
 assert.equal(result.changes.length,1);assert.equal(result.changes[0].baselineFindingId,'b1');assert.equal(result.changes[0].category,'pre_existing');assert.equal(result.changes[0].currentFindingId,'c0');
});
test('comparison progress measures completed images and batches and never reports completion before saving',()=>{
 const preparing=comparisonProgressView({stage:'images',phase:'Preparing source images',processed:8,total:16});assert.equal(preparing.value,1.5);assert.match(preparing.detail,/8\/16/);
 const batches=Array.from({length:4},(_,i)=>({id:String(i),status:i<2?'done':'running',targets:5,attempt:1}));
 const checking=comparisonProgressView({stage:'compare',phase:'Argon is comparing',batches});assert.equal(checking.value,2.5);assert.match(checking.detail,/2\/4 batches/);assert.equal(checking.rows[2].status,'running');
 assert.equal(comparisonProgressView({stage:'save',phase:'Saving'}).value,3);
 const done=comparisonProgressView({stage:'complete',phase:'Saved'},'ready');assert.equal(done.value,4);assert(done.rows.every(r=>r.status==='done'));
 const partial=comparisonProgressView({stage:'complete',phase:'Saved',partial:true,batches:[...batches.slice(0,3),{id:'4',status:'failed',targets:5,attempt:1}]},'partial');assert.equal(partial.value,3);assert.equal(partial.rows[2].status,'partial');
});
test('every provider batch retains both scans image context and global reports while targets stay disjoint',async()=>{
 const {ObjectId}=require('mongodb'),earlier={_id:new ObjectId(),ownerId:'owner',roomId:new ObjectId(),scanReport:{summary:'Earlier global context'}},later={_id:new ObjectId(),ownerId:'owner',roomId:earlier.roomId,scanReport:{summary:'Later global context'}},requests=[];
 const rows=[0,1].map(side=>Array.from({length:20},(_,i)=>({_id:new ObjectId(),kind:'damage',label:'scuff',timestampSeconds:i,evidenceFrameUrl:`gridfs:${side}-${i%8}`})));
 const db={collection:()=>({find:q=>({sort:()=>({limit:()=>({toArray:async()=>String(q.inspectionId)===String(earlier._id)?rows[0]:rows[1]})})})})};
 const {compareInspections}=load('lib/server/comparison.ts',{'./db':{getDb:async()=>db},'./media':{readMedia:async ref=>Buffer.from(ref),deleteMedia:async()=>{}},sharp:()=>({resize(){return this},jpeg(){return this},toBuffer:async()=>Buffer.from('prepared-image')}),'@google/genai':{ThinkingLevel:{HIGH:'HIGH'},GoogleGenAI:class{models={generateContent:async input=>{requests.push(input);const assignment=input.contents.at(-1).text,b=JSON.parse(/BASELINE finding IDs: (\[[^\]]*\])/.exec(assignment)[1]),c=JSON.parse(/CURRENT finding IDs: (\[[^\]]*\])/.exec(assignment)[1]);return {text:JSON.stringify({changes:[change(b[0],c[0])]})};}}}}});
 const previous=process.env.GEMINI_API_KEY;process.env.GEMINI_API_KEY='test-only';
 try{const result=await compareInspections(earlier,later);assert.equal(requests.length,4);assert.equal(result.changes.length,4);for(const request of requests){assert.equal(request.contents.filter(p=>p.inlineData).length,16);assert.match(request.contents.at(-2).text,/Earlier global context/);assert.match(request.contents.at(-2).text,/Later global context/);assert.equal(request.config.thinkingConfig.thinkingLevel,'HIGH');}assert.equal(result.progress.stage,'complete');assert.equal(result.progress.batches.filter(b=>b.status==='done').length,4);}
 finally{if(previous===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=previous;}
});
test('comparison UI renders a determinate accessible bar with the actual batch count',()=>{
 const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
 function component(file){const filename=path.resolve(file),mod=new Module(filename,module);mod.filename=filename;mod.paths=module.paths;const original=mod.require.bind(mod);mod.require=id=>{if(id.startsWith('.')||id.startsWith('@/')){const base=id.startsWith('@/')?path.resolve(id.slice(2)):path.resolve(path.dirname(filename),id);return component(base+(fs.existsSync(base+'.ts')?'.ts':'.tsx'));}return original(id);};mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,filename);return mod.exports;}
 const Progress=component('components/comparison-progress.tsx').default;
 const batches=Array.from({length:4},(_,i)=>({id:String(i),status:i<2?'done':'running',targets:5,attempt:1,changes:1}));
 const html=renderToStaticMarkup(React.createElement(Progress,{progress:{stage:'compare',phase:'Argon is comparing',batches}}));
 assert.match(html,/role="progressbar"/);assert.match(html,/aria-valuenow="2.5"/);assert.match(html,/width:62.5%/);assert.match(html,/2\/4 batches completed/);assert(!html.includes('line-loader-track indeterminate'));assert.match(html,/Batch 4/);
});
test('transient batch retries do not rerun batches that already succeeded',async()=>{
 const actualRetry=load('lib/server/analysis-retry.ts').retryAnalysis;
 const client=load('lib/server/comparison-batches.ts',{'./analysis-retry':{retryAnalysis:(run,options)=>actualRetry(run,{...options,wait:async()=>{}})}}),calls=new Map(),progress=[];
 const result=await client.runComparisonBatches(baseline,current,async batch=>{calls.set(batch.id,(calls.get(batch.id)||0)+1);if(batch.id==='batch-1'&&calls.get(batch.id)===1)throw Object.assign(Error('temporarily unavailable'),{status:503});return [change(batch.baselineIds[0],batch.currentIds[0])];},{deadlineMs:Date.now()+200000,images,onProgress:async p=>progress.push(p)});
 assert.equal(calls.get('batch-1'),2);for(const id of ['batch-2','batch-3','batch-4'])assert.equal(calls.get(id),1);assert(progress.some(p=>p.batches[0].status==='retrying'&&p.batches[0].attempt===2));assert.equal(result.partial,false);
});
