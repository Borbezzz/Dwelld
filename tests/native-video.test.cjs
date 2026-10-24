const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript'),{ObjectId}=require('mongodb');
test('native signalling reads only this session and recipient without downloading camera previews',async()=>{
 const id=new ObjectId(),filename=path.resolve('app/api/live/[sessionId]/signal/route.ts');let query,authorized=false;
 const mod=new Module(filename,module);mod.filename=filename;mod.paths=module.paths;
 mod.require=name=>name.endsWith('/live-signaling')?{}:{authenticateLive:async(request,sessionId)=>{authorized=true;assert.equal(sessionId,String(id));return {session:{_id:id,status:'recording',nativePreview:'private-preview'},role:'phone'}},liveCollections:async()=>({db:{collection:()=>({find:q=>{query=q;return {sort:()=>({limit:()=>({toArray:async()=>[{_id:new ObjectId(),sequence:12,type:'answer',data:{negotiationId:'current'}}]})})}}})}}),liveFailure:e=>{throw e}};
 mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,filename);
 const response=await mod.exports.GET(new Request(`https://dwelld.example/api/live/${id}/signal?after=7`),{params:Promise.resolve({sessionId:String(id)})}),body=await response.json();
 assert(authorized);assert.equal(query.sessionId,id);assert.equal(query.to,'phone');assert.deepEqual(query.sequence,{$gt:7});assert.equal(body.cursor,12);assert.equal(body.signals.length,1);assert.equal(body.session.status,'recording');assert(!JSON.stringify(body).includes('private-preview'));assert.equal(response.headers.get('cache-control'),'no-store');
});
