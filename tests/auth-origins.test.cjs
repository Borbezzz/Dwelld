const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const filename=path.resolve('lib/auth-origins.ts'),mod=new Module(filename,module);mod.filename=filename;mod.paths=module.paths;
mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,filename);
const {authBaseURL}=mod.exports;
test('auth explicitly supports custom domains, legacy domain and exact deployment host',()=>{
 const config=authBaseURL({NODE_ENV:'production',BETTER_AUTH_URL:'https://dwelld.vercel.app',VERCEL_URL:'dwelld-example-borbez2s-projects.vercel.app'});
 for(const host of ['dwelld.dev','www.dwelld.dev','dwelld.vercel.app','dwelld-example-borbez2s-projects.vercel.app'])assert(config.allowedHosts.includes(host));
 assert(!config.allowedHosts.includes('*.vercel.app'));assert(!config.allowedHosts.includes('localhost:*'));
 assert(authBaseURL({NODE_ENV:'development'}).allowedHosts.includes('localhost:*'));
});
test('real Better Auth accepts sign-in on both custom domains and rejects a foreign origin',async()=>{
 const {betterAuth}=await import('better-auth');const {memoryAdapter}=await import('better-auth/adapters/memory');
 const auth=betterAuth({baseURL:authBaseURL({NODE_ENV:'production',BETTER_AUTH_URL:'https://dwelld.vercel.app'}),secret:'test-secret-with-at-least-thirty-two-characters',database:memoryAdapter({user:[],session:[],account:[],verification:[]}),emailAndPassword:{enabled:true},rateLimit:{enabled:false}});
 const signup=await auth.handler(new Request('https://www.dwelld.dev/api/auth/sign-up/email',{method:'POST',headers:{origin:'https://www.dwelld.dev','content-type':'application/json'},body:JSON.stringify({name:'Origin test',email:'domain-test@example.invalid',password:'in-memory-test-password-only'})}));
 assert.equal(signup.status,200);
 for(const origin of ['https://dwelld.dev','https://www.dwelld.dev','https://dwelld.vercel.app']){
  const request=new Request(origin+'/api/auth/sign-in/email',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({email:'origin-check@example.invalid',password:'invalid-check-password'})});
  const response=await auth.handler(request);assert.equal(response.status,401);assert.equal((await response.json()).code,'INVALID_EMAIL_OR_PASSWORD');
  const signedIn=await auth.handler(new Request(origin+'/api/auth/sign-in/email',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({email:'domain-test@example.invalid',password:'in-memory-test-password-only'})}));
  assert.equal(signedIn.status,200);
  const cookie=signedIn.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
  const session=await auth.handler(new Request(origin+'/api/auth/get-session',{headers:{cookie}}));
  assert.equal((await session.json()).user.email,'domain-test@example.invalid');
 }
 const bad=await auth.handler(new Request('https://www.dwelld.dev/api/auth/sign-in/email',{method:'POST',headers:{origin:'https://untrusted.example','content-type':'application/json'},body:JSON.stringify({email:'origin-check@example.invalid',password:'invalid-check-password'})}));
 assert.equal(bad.status,403);assert.equal((await bad.json()).code,'INVALID_ORIGIN');
});
