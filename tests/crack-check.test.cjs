const test=require('node:test'),assert=require('node:assert/strict'),ts=require('typescript'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),sharp=require('sharp');
function load(relative){const filename=path.resolve(relative),mod=new Module(filename,module);mod.filename=filename;mod.paths=module.paths;const original=mod.require.bind(mod);mod.require=id=>id.startsWith('./')?load(path.join(path.dirname(relative),id+'.ts')):original(id);mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,filename);return mod.exports;}
const {checkCrack}=load('lib/server/crack-check.ts');
const svg=body=>sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360">${body}</svg>`)).png().toBuffer();
const plaster='<rect width="480" height="360" fill="#c4c0b8"/>';
// A wandering hairline: the kind of crack that runs across plaster.
const crackPath='<path d="M236 40 L246 80 L232 120 L250 160 L238 200 L255 240 L240 280 L248 320" stroke="#5a554e" stroke-width="2.5" fill="none"/>';
const box={x:.3,y:.1,width:.4,height:.8};
const depth=(fn)=>{const width=64,height=48,data=new Float32Array(width*height),confidence=new Uint8Array(width*height).fill(2);for(let y=0;y<height;y++)for(let x=0;x<width;x++)data[y*width+x]=fn((x+.5)/width,(y+.5)/height);return {data,width,height,confidence};};

test('a thin wandering dark line on plaster is accepted as a crack',async()=>{
 const r=await checkCrack(await svg(plaster+crackPath),box);
 assert.equal(r.verdict,'crack',r.reason);assert.ok(r.valley>r.step);
});
test('the border of a whiteboard on a wall is rejected as an edge',async()=>{
 const img=await svg(plaster+'<rect x="240" y="20" width="230" height="320" fill="#f7f7f5"/>');
 const r=await checkCrack(img,{x:.4,y:.2,width:.2,height:.6});
 assert.equal(r.verdict,'edge',r.reason);assert.ok(r.step>r.valley);
});
test('a dark straight frame strip spanning the box is rejected as a manufactured edge',async()=>{
 const img=await svg(plaster+'<rect x="240" y="0" width="240" height="360" fill="#f4f4f2"/><rect x="236" y="0" width="5" height="360" fill="#8d9096"/>');
 const r=await checkCrack(img,{x:.4,y:.1,width:.2,height:.8});
 assert.equal(r.verdict,'edge',r.reason);
});
test('a door gap with a LiDAR depth step is rejected even when it looks like a dark line',async()=>{
 const img=await svg(plaster+crackPath);
 const r=await checkCrack(img,box,depth((u,v)=>1.6+.1*v+(u>.5?.04:0)));
 assert.equal(r.verdict,'edge',r.reason);assert.ok(r.depthStep>=.012);
});
test('the same line on one continuous, tilted surface stays a crack',async()=>{
 const r=await checkCrack(await svg(plaster+crackPath),box,depth((u,v)=>1.4+.3*u+.1*v));
 assert.equal(r.verdict,'crack',r.reason);assert.ok(r.depthStep<.012);
});
