const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const ts=require('typescript');
const filename=path.resolve('lib/server/api-error.ts');
const mod=new Module(filename,module);mod.filename=filename;mod.paths=module.paths;
mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,filename);
const {databaseDiagnostics}=mod.exports;
test('Mongo topology diagnostics preserve TLS category without leaking provider text',()=>{
 const error={name:'MongoServerSelectionError',reason:{servers:new Map([['secret-host',{error:{name:'MongoNetworkError',message:'secret-uri TLS connection closed',cause:{code:'ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR',message:'secret-password'}}}]])}};
 assert.deepEqual(databaseDiagnostics(error),['connection_closed','tls_handshake','tls_remote_internal_alert']);
 assert.ok(!JSON.stringify(databaseDiagnostics(error)).includes('secret'));
});
test('Mongo diagnostics distinguish DNS, credentials, authorization and timeout',()=>{
 assert.deepEqual(databaseDiagnostics({code:'ENOTFOUND'}),['dns_resolution']);
 assert.deepEqual(databaseDiagnostics({code:18}),['authentication']);
 assert.deepEqual(databaseDiagnostics({code:13}),['authorization']);
 assert.deepEqual(databaseDiagnostics({code:'ETIMEDOUT'}),['connection_timeout']);
});
test('Mongo diagnostics bound cyclic causes and reject arbitrary provider codes',()=>{
 const error={code:'secret-value'};error.cause=error;
 assert.deepEqual(databaseDiagnostics(error),[]);
});
