const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const filename = path.resolve('lib/client/detector.ts');
const mod = new Module(filename, module); mod.filename = filename; mod.paths = module.paths;
mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText, filename);
const {decodeDetections,ROOM_CLASSES}=mod.exports;
// Synthetic tensor fixtures verify geometry only, not real model accuracy.
function tensor(rows) { const data=new Float32Array(84*rows.length); rows.forEach((r,i)=>{r.box.forEach((v,j)=>data[j*rows.length+i]=v);data[(r.classId+4)*rows.length+i]=r.score;}); return data; }
test('YOLO reverses landscape letterbox and keeps distinct objects while suppressing duplicates',()=>{
 const rows=[{box:[320,320,320,180],classId:56,score:.9},{box:[322,321,320,180],classId:56,score:.8},{box:[100,300,80,100],classId:56,score:.7}];
 const out=decodeDetections(tensor(rows),[1,84,3],1280,720);
 assert.equal(out.length,2);assert.equal(out[0].label,'chair');assert.deepEqual(out[0].boundingBox,{x:.25,y:.25,width:.5,height:.5});assert.notEqual(out[0].objectId,out[1].objectId);assert(Math.abs(out[0].confidence-.9)<1e-6);
});
test('YOLO ignores unsupported classes and low confidence; rejects wrong shape',()=>{
 const rows=[{box:[320,320,100,100],classId:0,score:.99},{box:[320,320,100,100],classId:56,score:.2}];
 assert.equal(decodeDetections(tensor(rows),[1,84,2],640,640).length,0);
 assert.throws(()=>decodeDetections(new Float32Array(10),[1,10,1],640,640));
 assert(!Object.values(ROOM_CLASSES).includes('wardrobe'));assert(!Object.values(ROOM_CLASSES).includes('desk'));
});
test('YOLO reverses portrait padding and clips source bounds',()=>{
 const rows=[{box:[320,320,400,640],classId:59,score:.9}];
 const out=decodeDetections(tensor(rows),[1,84,1],360,640);
 assert.deepEqual(out[0].boundingBox,{x:0,y:0,width:1,height:1});
});
