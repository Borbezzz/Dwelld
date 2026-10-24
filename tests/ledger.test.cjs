const test=require('node:test'),assert=require('node:assert/strict'),ts=require('typescript'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
function load(relative){const filename=path.resolve(relative),mod=new Module(filename,module);mod.filename=filename;mod.paths=module.paths;const original=mod.require.bind(mod);mod.require=id=>id.startsWith('./')?load(path.join(path.dirname(relative),id+'.ts')):original(id);mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,filename);return mod.exports;}
const L=load('lib/server/ledger-core.ts');
const keys=L.ledgerKeys('x'.repeat(40));
const file=(n,content)=>({ref:`gridfs:${String(n).padStart(24,'0')}`,name:`frame-${n}.jpg`,kind:'image',sha256:L.sha256(content),bytes:content.length});
function chain(){const out=[];let prev=L.GENESIS;for(let i=1;i<=3;i++){const e=L.buildEntry({seq:i,inspectionId:'insp'+i,roomId:'room',sealedAt:`2026-10-24T1${i}:00:00.000Z`,files:[file(i,'photo '+i),file(i+10,'depth '+i)],prevSeal:prev},keys);out.push(e);prev=e.seal;}return out;}

test('an untouched chain verifies: every seal, signature and link',()=>{
 const c=chain();
 for(const e of c)assert.deepEqual(L.entryProblems(e,keys.publicKeyBase64),[]);
 assert.deepEqual(L.chainProblems(c),[]);
 assert.equal(c[1].prevSeal,c[0].seal);
});
test('editing one photo is caught, because its fingerprint no longer matches the seal',()=>{
 const c=chain();const edited={...c[1],files:[{...c[1].files[0],sha256:L.sha256('photo 2, retouched')},c[1].files[1]]};
 assert.ok(L.entryProblems(edited,keys.publicKeyBase64).some(p=>p.includes('fingerprints')));
});
test('backdating an inspection breaks its seal and the link from the next entry',()=>{
 const c=chain();const backdated={...c[1],sealedAt:'2026-09-01T09:00:00.000Z'};
 assert.ok(L.chainProblems([c[0],backdated,c[2]]).some(p=>p.seq===2));
 // Re-sealing the backdated entry to hide it still breaks the next link.
 const resealed=L.buildEntry({...backdated},keys);
 assert.ok(L.chainProblems([c[0],resealed,c[2]]).some(p=>p.seq===3&&p.problem.includes('previous')));
});
test('deleting an entry leaves a visible gap',()=>{
 const c=chain();assert.ok(L.chainProblems([c[0],c[2]]).some(p=>p.problem.includes('missing')));
});
test('a seal signed with another key fails against the published key',()=>{
 const other=L.ledgerKeys('y'.repeat(40)),c=chain();
 const forged={...c[0],signature:L.signSeal(c[0].seal,other.privateKey)};
 assert.ok(L.entryProblems(forged,keys.publicKeyBase64).some(p=>p.includes('signature')));
});
test('the signing key is stable for a given secret, so old seals keep verifying',()=>{
 assert.equal(L.ledgerKeys('x'.repeat(40)).publicKeyBase64,keys.publicKeyBase64);
 assert.equal(Buffer.from(keys.publicKeyBase64,'base64').length,32);
 assert.throws(()=>L.ledgerKeys('short'));
});
test('file order does not change the fingerprint',()=>{
 const a=[file(1,'a'),file(2,'b')];assert.equal(L.filesRoot(a),L.filesRoot([a[1],a[0]]));
});
