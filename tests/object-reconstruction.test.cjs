const test = require('node:test'), assert = require('node:assert/strict'), ts = require('typescript'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
function load(relative) {
  const filename = path.resolve(relative), mod = new Module(filename, module);
  mod.filename = filename; mod.paths = module.paths;
  const original = mod.require.bind(mod);
  mod.require = id => id.startsWith('./') || id.startsWith('../') ? load(path.join(path.dirname(relative), id + '.ts')) : original(id);
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
