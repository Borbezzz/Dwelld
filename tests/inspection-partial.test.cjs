const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
function load(damage) {
  const filename = path.resolve('lib/server/inspection.ts');
  const mod = new Module(filename, module);
  mod.filename = filename; mod.paths = module.paths;
  const original = mod.require.bind(mod);
  mod.require = (id) => id === '../video-sampling' ? {videoSampleTimes:()=>[]} : id === './crack-detector' ? {inspectCracks:async()=>[],CRACK_MODEL:'unit-test-stub'} : id === './damage' ? { validBox: (box) => box, ...damage } : id === './media' || id === './video-frames' ? {} : original(id);
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, filename);
  return mod.exports;
}
const detection = { objectId: 'chair_1', label: 'chair', boundingBox: { x: .1, y: .1, width: .5, height: .5 } };
const empty = async () => [];
test('failed crop retains actual object and warns without fabricating damage', async () => {
  const { analyzeDetectedImage } = load({ inspectObjectDamage: async () => { throw new Error('malformed secret provider payload'); }, inspectUnsupportedFurniture: empty, inspectSurfaceDamage: empty });
  const warnings = [];
  const findings = await analyzeDetectedImage(Buffer.from('fixture'), [detection], 1, 'frame', warnings);
  assert.equal(findings.length, 1); assert.equal(findings[0].kind, 'object');
  assert.equal(warnings.length, 1); assert.match(warnings[0], /incomplete/); assert.doesNotMatch(warnings[0], /secret|provider payload/);
});
test('transient crop error retries once and completes without warning on success', async () => {
  let attempts = 0;
  const { analyzeDetectedImage } = load({ inspectObjectDamage: async () => { if (++attempts === 1) throw Object.assign(new Error('DEADLINE_EXCEEDED'), { status: 504 }); return []; }, inspectUnsupportedFurniture: empty, inspectSurfaceDamage: empty });
  const warnings = [];
  const findings = await analyzeDetectedImage(Buffer.from('fixture'), [detection], 1, 'frame', warnings);
  assert.equal(attempts, 2); assert.equal(findings.length, 1); assert.deepEqual(warnings, []);
});
test('expired deadline skips AI calls while retaining detected object', async () => {
  let calls = 0;
  const work = async () => { calls++; return []; };
  const { analyzeDetectedImage } = load({ inspectObjectDamage: work, inspectUnsupportedFurniture: work, inspectSurfaceDamage: work });
  const warnings = [];
  const findings = await analyzeDetectedImage(Buffer.from('fixture'), [detection], 1, 'frame', warnings, Date.now());
  assert.equal(calls, 0); assert.equal(findings.length, 1); assert.equal(warnings.length, 4);
});
test('surface failure and optional furniture failure are reported', async () => {
  const fail = async () => { throw new Error('invalid response'); };
  const { analyzeDetectedImage } = load({ inspectObjectDamage: empty, inspectUnsupportedFurniture: fail, inspectSurfaceDamage: fail });
  const warnings = [];
  const findings = await analyzeDetectedImage(Buffer.from('fixture'), [detection], 1, 'frame', warnings);
  assert.equal(findings.length, 1); assert.equal(warnings.length, 2);
});
test('persistent transient errors retry at most once and respect remaining budget', async () => {
  let attempts = 0;
  const fail = async () => { attempts++; throw Object.assign(new Error('unavailable'), { status: 503 }); };
  const { analyzeDetectedImage } = load({ inspectObjectDamage: fail, inspectUnsupportedFurniture: empty, inspectSurfaceDamage: empty });
  const warnings = [];
  await analyzeDetectedImage(Buffer.from('fixture'), [detection], 1, 'frame', warnings);
  assert.equal(attempts, 2); assert.equal(warnings.length, 1);
  attempts = 0;
  await analyzeDetectedImage(Buffer.from('fixture'), [detection], 1, 'frame', [], Date.now() + 60_000);
  assert.equal(attempts, 1);
});
