const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const Module=require('node:module');const ts=require('typescript');
const filename=path.resolve('lib/client/live-tracker.ts');const mod=new Module(filename,module);mod.filename=filename;mod.paths=module.paths;mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,filename);
const {LiveTracker,overlap}=mod.exports;
const chair=x=>({objectId:crypto.randomUUID(),label:'chair',classId:56,confidence:.8,boundingBox:{x,y:.2,width:.2,height:.3}});
test('live tracking keeps two chairs distinct and stable when output order changes',()=>{
 const tracker=new LiveTracker();const first=tracker.update([chair(.1),chair(.6)],[[1,0],[0,1]],0);const next=tracker.update([chair(.61),chair(.11)],[[0,1],[1,0]],.3);
 assert.equal(first[0].objectId,next[1].objectId);assert.equal(first[1].objectId,next[0].objectId);assert.notEqual(next[0].objectId,next[1].objectId);assert.equal(next[0].observations,2);
});
test('lost tracks expire without pretending to recover room-wide identity',()=>{
 const tracker=new LiveTracker();const first=tracker.update([chair(.1)],[[1]],0);tracker.update([],[],1);const recent=tracker.update([chair(.11)],[[1]],2);assert.equal(first[0].objectId,recent[0].objectId);
 const returned=tracker.update([chair(.11)],[[1]],5);assert.notEqual(first[0].objectId,returned[0].objectId);
});
test('matching is one-to-one and never combines classes or disjoint boxes',()=>{
 const tracker=new LiveTracker();const first=tracker.update([chair(.1)],[[1]],0);const next=tracker.update([chair(.1),chair(.11),{...chair(.6),classId:59,label:'bed'}],[[1],[1],[1]],.2);
 assert.equal(new Set(next.map(x=>x.objectId)).size,3);assert.equal(next.filter(x=>x.objectId===first[0].objectId).length,1);assert.equal(overlap(chair(.1).boundingBox,chair(.6).boundingBox),0);
});
