const test=require('node:test'),assert=require('node:assert/strict'),ts=require('typescript'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
function load(relative){const filename=path.resolve(relative),mod=new Module(filename,module);mod.filename=filename;mod.paths=module.paths;const original=mod.require.bind(mod);mod.require=id=>id.startsWith('./')?load(path.join(path.dirname(relative),id+'.ts')):original(id);mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,filename);return mod.exports;}
const P=load('lib/server/search-pipelines.ts'),{projectMap}=load('lib/server/semantic-map.ts');
test('hybrid search is one native $rankFusion stage over keyword, autoEmbed and photo pipelines',()=>{
 const s={ownerId:'u1',roomId:'r1'};
 const pipes={keyword:P.keywordPipeline('scratch desk',s,24),meaning:P.autoEmbedPipeline('scratch desk',s,24),photo:P.photoPipeline(Array(1024).fill(.01),s,24)};
 const f=P.rankFusionPipeline(pipes,16);
 assert.deepEqual(Object.keys(f[0].$rankFusion.input.pipelines),['keyword','meaning','photo']);
 assert.equal(f[0].$rankFusion.scoreDetails,true);
 assert.deepEqual(f[0].$rankFusion.combination.weights,{keyword:1,meaning:1,photo:.8});
 // Selection pipelines may not reshape documents.
 for(const p of Object.values(pipes))for(const stage of p)assert.ok(['$search','$vectorSearch','$limit','$match'].includes(Object.keys(stage)[0]));
 assert.deepEqual(pipes.meaning[0].$vectorSearch.query,{text:'scratch desk'});
 assert.equal(pipes.meaning[0].$vectorSearch.path,'searchText');
 assert.deepEqual(pipes.meaning[0].$vectorSearch.filter,{ownerId:'u1',roomId:'r1'});
});
test('autoEmbed index definition matches the Atlas Automated Embedding schema',()=>{
 const auto=P.indexDefinitions().find(i=>i.name==='findings_auto');
 assert.equal(auto.type,'vectorSearch');
 assert.deepEqual(auto.definition.fields[0],{type:'autoEmbed',modality:'text',path:'searchText',model:'voyage-4'});
 assert.equal(P.indexDefinitions().find(i=>i.name==='findings_image').definition.fields[0].numDimensions,1024);
});
test('app-side fusion matches $rankFusion RRF and records per-pipeline ranks',()=>{
 const a={_id:'a'},b={_id:'b'},c={_id:'c'};
 const out=P.appRankFusion({keyword:[a,b],meaning:[b,c]},10,{keyword:1,meaning:1});
 assert.equal(out[0]._id,'b');
 assert.ok(Math.abs(out[0].score-(1/62+1/61))<1e-12);
 assert.deepEqual(P.ranksOf(out[0]),{keyword:2,meaning:1});
});
test('displayed pipelines hide the owner and shorten vectors',()=>{
 const shown=JSON.stringify(P.displayPipeline(P.photoPipeline(Array(1024).fill(0),{ownerId:'secret-user'},5)));
 assert.ok(shown.includes('<1024-dimension query vector>'));assert.ok(!shown.includes('secret-user'));
});
test('search text carries label, damage type and description',()=>{
 assert.equal(P.searchText({label:'Desk',damageType:'scratch',description:'Long scratch on top',kind:'damage'}),'Desk. scratch. Long scratch on top. damage');
 assert.equal(P.searchText({label:'Desk',kind:'object',dimensions:[1.2,.75,.6]}),'Desk. measured 1.20 × 0.75 × 0.60 m. furniture or fixture');
});
test('vector map keeps neighbours together and places the query beside its match',()=>{
 const v=(...x)=>{const n=Math.hypot(...x);return x.map(y=>y/n);};
 const docs=[v(1,0,0,.1),v(.95,.05,0,.1),v(0,1,0,.1),v(0,.97,.05,.1),v(0,0,1,.1)];
 const {points,query}=projectMap(docs,v(.98,.02,0,.1));
 const d=(p,q)=>Math.hypot(p.x-q.x,p.y-q.y);
 assert.ok(d(points[0],points[1])<d(points[0],points[2]));
 assert.ok(d(query,points[0])<d(query,points[4]));
 assert.ok(points[0].similarity>points[4].similarity);
 for(const p of points){assert.ok(Math.abs(p.x)<=1.0000001&&Math.abs(p.y)<=1.0000001);}
});
