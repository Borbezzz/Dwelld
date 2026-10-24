const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript'),{ObjectId}=require('mongodb');
test('native signalling reads only this session and recipient without downloading camera previews',async()=>{
 const id=new ObjectId(),filename=path.resolve('app/api/live/[sessionId]/signal/route.ts');let query,authorized=false;
 const mod=new Module(filename,module);mod.filename=filename;mod.paths=module.paths;
 mod.require=name=>name.endsWith('/live-signaling')?{}:{authenticateLive:async(request,sessionId)=>{authorized=true;assert.equal(sessionId,String(id));return {session:{_id:id,status:'recording',nativePreview:'private-preview'},role:'phone'}},liveCollections:async()=>({db:{collection:()=>({find:q=>{query=q;return {sort:()=>({limit:()=>({toArray:async()=>[{_id:new ObjectId(),sequence:12,type:'answer',data:{negotiationId:'current'}}]})})}}})}}),liveFailure:e=>{throw e}};
 mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,filename);
 const response=await mod.exports.GET(new Request(`https://dwelld.example/api/live/${id}/signal?after=7`),{params:Promise.resolve({sessionId:String(id)})}),body=await response.json();
 assert(authorized);assert.equal(query.sessionId,id);assert.equal(query.to,'phone');assert.deepEqual(query.sequence,{$gt:7});assert.equal(body.cursor,12);assert.equal(body.signals.length,1);assert.equal(body.session.status,'recording');assert(!JSON.stringify(body).includes('private-preview'));assert.equal(response.headers.get('cache-control'),'no-store');
});
test('video health records bounded desktop counters without reopening a saved session',async()=>{
 const id=new ObjectId(),filename=path.resolve('app/api/live/[sessionId]/video-health/route.ts');let writes=[];
 const mod=new Module(filename,module);mod.filename=filename;mod.paths=module.paths;mod.require=()=>({authenticateLive:async(req,sessionId,role)=>{assert.equal(role,'desktop');assert.equal(sessionId,String(id));return {session:{_id:id}}},liveCollections:async()=>({sessions:{updateOne:async(q,u)=>writes.push({q,u})}}),LiveError:class extends Error{constructor(message,status=400){super(message);this.status=status}},liveFailure:e=>Response.json({error:e.message},{status:e.status||500})});
 mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,filename);
 const post=body=>mod.exports.POST(new Request(`https://dwelld.example/api/live/${id}/video-health`,{method:'POST',body:JSON.stringify(body)}),{params:Promise.resolve({sessionId:String(id)})});
 assert.equal((await post({fps:24,decoded:100,dropped:1})).status,200);assert.equal(writes[0].u.$set.videoHealth.fps,24);assert.deepEqual(writes[0].q.status,{$ne:'saved'});
 for(const body of [{fps:300,decoded:100,dropped:0},{fps:24,decoded:-1,dropped:0},{fps:'24',decoded:1,dropped:0}])assert.equal((await post(body)).status,400);
 assert.equal(writes.length,1);
});
