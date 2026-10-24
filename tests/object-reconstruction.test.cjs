const test = require('node:test'), assert = require('node:assert/strict'), ts = require('typescript'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
function load(relative, stubs = {}) {
  const filename = path.resolve(relative), mod = new Module(filename, module);
  mod.filename = filename; mod.paths = module.paths;
  const original = mod.require.bind(mod);
  mod.require = id => Object.hasOwn(stubs, id) ? stubs[id] : id.startsWith('./') || id.startsWith('../') ? load(path.join(path.dirname(relative), id + '.ts'), stubs) : original(id);
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, filename);
  return mod.exports;
}
const { reconstructObject, measurementCaption } = load('lib/spatial/object-reconstruction.ts');
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -1, 1];
const frame = { timestamp: 0, image: 'a.jpg', depth: 'a.depth', width: 40, height: 40, depthWidth: 40, depthHeight: 40, intrinsics: [40, 0, 0, 0, 40, 0, 20, 20, 1], transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] };
const chair = { id: 'chair-1', category: 'chair', dimensions: [.4, .5, .3], transform: identity };

function view(fillDepth, color) {
  const depth = new Float32Array(40 * 40).fill(3), confidence = new Uint8Array(40 * 40).fill(2);
  for (let y = 9; y <= 30; y++) for (let x = 11; x <= 28; x++) depth[y * 40 + x] = fillDepth;
  return { frame, depth, confidence, color };
}

test('photos of the front face rebuild that face and keep the unseen depth from the scan', () => {
  const color = new Uint8Array(40 * 40 * 3);
  for (let i = 0; i < color.length; i += 3) color[i] = 240;
  const cloud = reconstructObject(chair, [view(1, color)]);
  assert.ok(cloud.points >= 40);
  assert.equal(cloud.views, 1);
  assert.ok(cloud.measuredAxes[0] && cloud.measuredAxes[1]);
  assert.equal(cloud.measuredAxes[2], false);
  assert.ok(Math.abs(cloud.measurements.width - .4) < .08);
  assert.ok(Math.abs(cloud.measurements.height - .5) < .08);
  assert.equal(cloud.measurements.depth, .3);
  assert.ok(cloud.colors.some(channel => channel > 200));
  assert.match(measurementCaption(cloud.measuredAxes, cloud.views), /Width and height reconstructed from 1 calibrated photo view\. Depth kept from the scan\./);
});

test('a depth cluster outside the piece is ignored', () => {
  const outside = view(1, null);
  outside.depth.fill(3);
  assert.equal(reconstructObject(chair, [outside]), null);
});

test('low-confidence samples never become a reconstruction', () => {
  const noisy = view(1, null);
  noisy.confidence.fill(0);
  assert.equal(reconstructObject(chair, [noisy]), null);
});


test('a partial-width surface does not shrink the furniture measurement', () => {
  const partial = view(1, null);
  for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) if (x < 15 || x > 24) partial.depth[y * 40 + x] = 3;
  const cloud = reconstructObject(chair, [partial]);
  assert.ok(cloud && cloud.points >= 40);
  assert.equal(cloud.measuredAxes[0], false);
  assert.equal(cloud.measurements.width, chair.dimensions[0]);
});

function cachedService() {
  let cached, builds = 0, failRead = false, available = false;
  const manifest = { version:1, sessionId:'scan', coordinateSystem:'arkit-right-handed-y-up-metres', elements:[chair], frames:[frame], assets:[{name:'a.depth',kind:'depth',mediaRef:'depth-a'}] };
  const cloud={positions:[0,0,-1],colors:[200,100,50],measurements:{width:.4,height:.5,depth:.3},measuredAxes:[true,true,false],views:1,points:1};
  const db={collection:name=>name==='spatialCaptures'?{findOne:async()=>({manifest})}:name==='objectReconstructions'?{
    findOne:async query=>cached?.captureSignature===query.captureSignature?cached:null,
    updateOne:async(query,update)=>{cached={...cached,...update.$set};},
  }:{updateOne:async()=>{}}};
  const service=load('lib/server/object-reconstruction.ts',{
    './db':{getDb:async()=>db},
    './media':{readMedia:async()=>{if(failRead)throw new Error('Temporary depth read failure');const raw=Buffer.alloc(40*40*4);for(let i=0;i<40*40;i++)raw.writeFloatLE(1,i*4);return raw;}},
    './frame-analysis':{elementInView:()=>({area:1})},
    '../spatial/object-reconstruction':{reconstructObject:()=>{builds++;return available?cloud:null;},measurementCaption:()=> 'Test caption'},
  });
  return {manifest,service,inspection:{_id:'inspection',ownerId:'owner'},setAvailable:v=>{available=v;},setFailRead:v=>{failRead=v;},getCached:()=>cached,getBuilds:()=>builds};
}
test('continued capture invalidates negative and positive reconstruction caches', async()=>{
  const f=cachedService();
  assert.equal(await f.service.reconstructionFor(f.inspection,chair.id),null);assert.equal(f.getBuilds(),1);assert.equal(f.getCached().unavailable,true);
  f.setAvailable(true);
  assert.equal(await f.service.reconstructionFor(f.inspection,chair.id),null);assert.equal(f.getBuilds(),1);
  f.manifest.frames.push({...frame,timestamp:1});
  assert.ok(await f.service.reconstructionFor(f.inspection,chair.id));assert.equal(f.getBuilds(),2);assert.equal(f.getCached().unavailable,false);
  assert.ok(await f.service.reconstructionFor(f.inspection,chair.id));assert.equal(f.getBuilds(),2);
  f.manifest.elements[0]={...chair,dimensions:[.45,.5,.3]};
  assert.ok(await f.service.reconstructionFor(f.inspection,chair.id));assert.equal(f.getBuilds(),3);
  f.manifest.assets[0].mediaRef='new-depth';
  assert.ok(await f.service.reconstructionFor(f.inspection,chair.id));assert.equal(f.getBuilds(),4);
});
test('a transient source read failure does not create a negative reconstruction cache',async()=>{
 const f=cachedService();f.setAvailable(true);f.setFailRead(true);
 await assert.rejects(f.service.reconstructionFor(f.inspection,chair.id),/Temporary depth read failure/);assert.equal(f.getCached(),undefined);
 f.setFailRead(false);assert.ok(await f.service.reconstructionFor(f.inspection,chair.id));
});
