const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const sharp = require('sharp');
function load(relative) {
  const filename = path.resolve(relative), mod = new Module(filename, module);
  mod.filename = filename; mod.paths = module.paths;
  const original = mod.require.bind(mod);
  mod.require = (id) => id.startsWith('./') ? load(path.join(path.dirname(relative), id + '.ts')) : original(id);
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, filename);
  return mod.exports;
}
const { cropObject, cropBoxToFrame, parseDamageResponse } = load('lib/server/damage.ts');
const { validateClientFrames } = load('lib/server/inspection.ts');
test('original pixel crops and rounded bounds translate to source coordinates', async () => {
  const image = await sharp({ create: { width: 101, height: 79, channels: 3, background: 'white' } }).png().toBuffer();
  const crop = await cropObject(image, { x: .1, y: .2, width: .3, height: .4 });
  const metadata = await sharp(crop.image).metadata();
  assert.equal(metadata.width, 31); assert.equal(metadata.height, 33);
  const translated = cropBoxToFrame({ x: 0, y: 0, width: 1, height: 1 }, crop.bounds);
  assert.deepEqual(translated, { x: 10/101, y: 15/79, width: 31/101, height: 33/79 });
  assert.deepEqual(cropBoxToFrame({ x: .5, y: .5, width: .5, height: .5 }, { x: .2, y: .2, width: .4, height: .4 }), { x: .4, y: .4, width: .2, height: .2 });
});
test('damage parser allows empty/uncertain results and rejects invalid model data', () => {
  assert.deepEqual(parseDamageResponse('{"damage":[]}'), []);
  assert.equal(parseDamageResponse(JSON.stringify({ damage: [{ type: 'crack', description: 'Visible line, uncertain crack', boundingBox: null }] }))[0].boundingBox, null);
  for (const item of [{ type: 'legal liability', description: 'bad', boundingBox: null }, { type: 'crack', description: '', boundingBox: null }, { type: 'scratch', description: 'scratch', boundingBox: { x: .9, y: 0, width: .2, height: .3 } }]) assert.throws(() => parseDamageResponse(JSON.stringify({ damage: [item] })));
});
test('client frames reject invalid timestamps, duplicate IDs, unsupported labels and bounds', () => {
  const d = { objectId: 'obj_1', label: 'chair', boundingBox: { x: .1, y: .2, width: .3, height: .4 }, confidence: .8 };
  assert.equal(validateClientFrames([{ timestampSeconds: 1, detections: [d] }], 2)[0].detections[0].confidence, .8);
  for (const detections of [[d, d], [{ ...d, label: 'person' }], [{ ...d, confidence: Infinity }], [{ ...d, boundingBox: { x: .9, y: 0, width: .2, height: .3 } }]]) assert.throws(() => validateClientFrames([{ timestampSeconds: 1, detections }], 2));
  assert.throws(() => validateClientFrames([{ timestampSeconds: 2, detections: [] }], 2));
  assert.throws(() => validateClientFrames([{ timestampSeconds: NaN, detections: [] }]));
});
