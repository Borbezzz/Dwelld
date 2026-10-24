const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
function load(relative) {
  const filename = path.resolve(relative), mod = new Module(filename, module);
  mod.filename = filename; mod.paths = module.paths;
  const original = mod.require.bind(mod);
  mod.require = (id) => id.startsWith('./') || id.startsWith('../') ? load(path.join(path.dirname(relative), id + '.ts')) : original(id);
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, filename);
  return mod.exports;
}
const { elementInView, selectInspectionTargets } = load('lib/server/frame-analysis.ts');
const { reviewDecision } = load('lib/server/verify.ts');

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const pose = { transform: identity, intrinsics: [500, 0, 0, 0, 500, 0, 320, 240, 1], width: 640, height: 480 };
const view = (id, category, area) => ({ elementId: id, category, box: { x: 0, y: 0, width: .2, height: .2 }, area });

test('a measured piece in front of the camera is selectable and one behind it is not', () => {
  const ahead = { id: 'chair-1', category: 'chair', dimensions: [.5, .9, .5], transform: [...identity.slice(0, 14), -2, 1] };
  const behind = { ...ahead, id: 'chair-2', transform: [...identity.slice(0, 12), 0, 0, 2, 1] };
  const seen = elementInView(ahead, pose);
  assert.equal(seen.elementId, 'chair-1');
  assert.ok(seen.area > .03);
  assert.equal(elementInView(behind, pose), null);
});

test('a close view still counts when one edge crosses the camera plane', () => {
  const cos = Math.cos(25 * Math.PI / 180), sin = Math.sin(25 * Math.PI / 180);
  const oneEdge = { id: 'door-close', category: 'door', dimensions: [.3, .3, .18], transform: [cos, 0, -sin, 0, 0, 1, 0, 0, sin, 0, cos, 0, 0, 0, -.28, 1] };
  const twoEdges = { id: 'door-too-close', category: 'door', dimensions: [.8, 1.2, .3], transform: [...identity.slice(0, 14), -.2, 1] };
  const seen = elementInView(oneEdge, pose);
  assert.equal(seen.elementId, 'door-close');
  assert.ok(seen.area > .03);
  assert.equal(elementInView(twoEdges, pose), null);
});

test('target selection keeps one of each kind before a second large piece', () => {
  const views = [view('sofa-a', 'sofa', .5), view('sofa-b', 'sofa', .4), view('door-1', 'Door(isOpen: false)', .08), view('bed-1', 'bed', .2), view('chair-1', 'chair', .1), view('tv-1', 'television', .9), view('table-1', 'table', .06)];
  const picked = selectInspectionTargets(views);
  assert.deepEqual(picked.map(v => v.elementId), ['sofa-a', 'bed-1', 'chair-1', 'door-1']);
  assert.equal(selectInspectionTargets([view('chair-1', 'chair', .4), view('chair-2', 'chair', .3), view('chair-3', 'chair', .2)], 2).map(v => v.elementId).join(), 'chair-1,chair-2');
});

test('verifier decisions approve clear damage and dismiss clear false positives', () => {
  assert.equal(reviewDecision('damage', .9, .85), 'confirmed');
  assert.equal(reviewDecision('damage', .84, .85), 'pending');
  assert.equal(reviewDecision('not_damage', .6, .85), 'rejected');
  assert.equal(reviewDecision('not_damage', .59, .85), 'pending');
  assert.equal(reviewDecision('unsure', 1, .85), 'pending');
  assert.equal(reviewDecision('damage', Number.NaN, .85), 'pending');
});
