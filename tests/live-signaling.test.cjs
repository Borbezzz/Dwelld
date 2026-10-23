const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const Module=require('node:module');const ts=require('typescript');
const filename=path.resolve('lib/client/live-signaling.ts');const mod=new Module(filename,module);mod.filename=filename;mod.paths=module.paths;mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,filename);
const {SignalQueue,validSignalPayload}=mod.exports;
test('signalling writes SDP before ICE even when offer persistence is delayed',async()=>{
 const queue=new SignalQueue();const writes=[];let release;const pending=new Promise(resolve=>release=resolve);
 const offer=queue.send(async()=>{await pending;writes.push('offer')});const ice=queue.send(async()=>{writes.push('ice')});
 await Promise.resolve();assert.deepEqual(writes,[]);release();await Promise.all([offer,ice]);assert.deepEqual(writes,['offer','ice']);
});
test('signalling retries one payload and proceeds after a rejected write',async()=>{
 const queue=new SignalQueue();let attempts=0;await assert.rejects(queue.send(async()=>{attempts++;throw Error('offline')}));assert.equal(attempts,2);assert.equal(await queue.send(async()=>42),42);
});
test('signalling requires scoped negotiations and correct descriptions',()=>{
 const negotiationId='generation-123';assert.equal(validSignalPayload('offer',{negotiationId,description:{type:'offer',sdp:'v=0'}}),true);
 assert.equal(validSignalPayload('answer',{negotiationId,description:{type:'offer',sdp:'v=0'}}),false);
 assert.equal(validSignalPayload('ice',{candidate:{candidate:'candidate:1'}}),false);
 assert.equal(validSignalPayload('ice',{negotiationId,candidate:{candidate:'candidate:1'}}),true);
 assert.equal(validSignalPayload('ice',{negotiationId,candidate:{candidate:'x'.repeat(4097)}}),false);
});
test('ICE arriving before its offer is retained across activation and later drained',()=>{
 const pending=new mod.exports.NegotiationCandidates();const candidate={candidate:'early'};
 pending.add('new-generation',candidate);pending.activate('new-generation');assert.deepEqual(pending.drain('new-generation'),[candidate]);assert.deepEqual(pending.drain('new-generation'),[]);
});
test('only known retired generations lose ICE; unknown future generation survives',()=>{
 const pending=new mod.exports.NegotiationCandidates();pending.activate('old');pending.add('future',{candidate:'future'});pending.activate('current');pending.add('old',{candidate:'stale'});assert.deepEqual(pending.drain('old'),[]);pending.activate('future');assert.deepEqual(pending.drain('future'),[{candidate:'future'}]);
});
