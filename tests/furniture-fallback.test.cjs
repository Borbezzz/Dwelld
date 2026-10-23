const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const filename = path.resolve('lib/server/damage.ts');
const loaded = new Module(filename, module);
loaded.filename = filename;
loaded.paths = module.paths;
loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, filename);
const { parseFurnitureResponse } = loaded.exports;
const box = { x: .1, y: .2, width: .3, height: .4 };
const object = { label: 'wardrobe', description: 'Wood wardrobe', boundingBox: box };
const parse = (objects, existing = []) => parseFurnitureResponse(JSON.stringify({ objects }), existing);
test('supplemental furniture validates locations, categories and bounded count', () => {
  assert.equal(parse([object]).length, 1);
  assert.equal(parse([{ ...object, label: 'chair' }]).length, 0);
  assert.equal(parse([{ ...object, boundingBox: { ...box, x: .9 } }]).length, 0);
  assert.equal(parse([{ ...object, boundingBox: null }]).length, 0);
  assert.throws(() => parse(Array(5).fill(object)));
});
test('supplemental furniture suppresses overlapping existing and duplicate hypotheses', () => {
  assert.equal(parse([object], [box]).length, 0);
  assert.equal(parse([object, object]).length, 1);
  assert.equal(parse([object], [{ x: .8, y: .8, width: .1, height: .1 }]).length, 1);
});
