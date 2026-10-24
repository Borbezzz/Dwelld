const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const filename=path.resolve('lib/comparison.ts');const mod=new Module(filename,module);mod.filename=filename;mod.paths=module.paths;mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,filename);
const {parseComparison}=mod.exports;
const base={baselineFindingId:'a',currentFindingId:'b',category:'pre_existing',explanation:'Same visible scratch',comparableView:true};
const parse=changes=>parseComparison(JSON.stringify({changes}),new Set(['a']),new Set(['b']));
test('comparison preserves evidence IDs and requires human review',()=>{const [r]=parse([base]);assert.equal(r.baselineFindingId,'a');assert.equal(r.reviewStatus,'pending');});
test('comparison drops invented evidence references',()=>{assert.equal(parse([{...base,currentFindingId:'invented'}]).length,0);assert.equal(parse([{...base,currentFindingId:'invented'},base]).length,1);});
test('non-comparable views cannot establish new damage',()=>{assert.equal(parse([{...base,category:'potentially_new',comparableView:false}])[0].category,'uncertain');});
test('missing detection cannot establish missing object',()=>{assert.equal(parse([{...base,category:'missing_or_changed',currentFindingId:null}])[0].category,'uncertain');});
test('existing damage requires evidence on both sides',()=>{assert.equal(parse([{...base,currentFindingId:null}])[0].category,'uncertain');});
test('comparison drops duplicate pairs and bounds model output',()=>{assert.equal(parse([base,base]).length,1);assert.throws(()=>parseComparison('{}',new Set(),new Set()));});
test('one damage mark gets one correspondence and visible pre-existing evidence wins over a duplicate new-damage claim',()=>{
 const changes=[{...base,baselineFindingId:'room',category:'potentially_new'},base,{...base,baselineFindingId:'other',category:'uncertain'}];
 const out=parseComparison(JSON.stringify({changes}),new Set(['a','room','other']),new Set(['b']),{baseline:new Map([['a','damage'],['room','frame'],['other','damage']]),current:new Map([['b','damage']])});
 assert.equal(out.length,1);assert.equal(out[0].category,'pre_existing');
});
test('different damage marks can share the same room-view evidence without being suppressed',()=>{
 const changes=[{...base,baselineFindingId:'room',currentFindingId:'damage-a',category:'potentially_new'},{...base,baselineFindingId:'room',currentFindingId:'damage-b',category:'potentially_new'}];
 const out=parseComparison(JSON.stringify({changes}),new Set(['room']),new Set(['damage-a','damage-b']),{baseline:new Map([['room','frame']]),current:new Map([['damage-a','damage'],['damage-b','damage']])});assert.equal(out.length,2);
});
test('conflicting duplicate rows for the exact same evidence pair keep the positive pre-existing match',()=>{
 const out=parse([{...base,category:'potentially_new'},base]);assert.equal(out.length,1);assert.equal(out[0].category,'pre_existing');
});
