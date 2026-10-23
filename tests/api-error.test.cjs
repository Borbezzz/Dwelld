const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const filename = path.resolve('lib/server/api-error.ts');
const mod = new Module(filename, module); mod.filename = filename; mod.paths = module.paths;
mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, filename);
const { reportError, errorResponse } = mod.exports;
test('service errors carry request IDs and never log raw secret-bearing provider messages', async () => {
 const logs=[]; const original=console.error; console.error=(line)=>logs.push(line);
 try {
  const secret='mongodb+srv://username:secret-password@private.example/db';
  const error=Object.assign(new Error('bad auth '+secret),{code:18});
  const response=errorResponse(error,'test.operation'); const body=await response.json();
  assert.equal(response.status,503); assert.equal(body.code,'DATABASE_AUTH_FAILED');
  assert.match(body.requestId,/^[a-f0-9-]{36}$/); assert.equal(response.headers.get('x-request-id'),body.requestId);
  assert.ok(!JSON.stringify(body).includes(secret)); assert.ok(!logs.join('').includes(secret));
  assert.equal(reportError(new SyntaxError('bad payload'),'test').status,400);
  assert.equal(reportError(new Error('MongoDB is unavailable: MONGODB_URI is not configured'),'test').code,'DATABASE_NOT_CONFIGURED');
 } finally {console.error=original;}
});
