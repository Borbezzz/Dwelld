const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
// Exercise the room component's effects without mounting WebGL or a media decoder.
function roomHarness(){
 const values=[],deps=[],cleanups=[];let cursor=0,effects=[],tree;
 const equal=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
 const hooks={
  useState(initial){const i=cursor++;if(!(i in values))values[i]=typeof initial==='function'?initial():initial;return [values[i],v=>{values[i]=typeof v==='function'?v(values[i]):v;}];},
  useRef(initial){const i=cursor++;return values[i]??(values[i]={current:initial});},
  useMemo(fn,next){const i=cursor++;if(!equal(deps[i],next)){values[i]=fn();deps[i]=next;}return values[i];},
  useCallback(fn,next){return hooks.useMemo(()=>fn,next);},
  useEffect(fn,next){const i=cursor++;if(!equal(deps[i],next)){deps[i]=next;effects.push(()=>{cleanups[i]?.();cleanups[i]=fn();});}},
 };
 const scan={id:'scan-a',roomId:'room-a',status:'completed',createdAt:'2026-10-24T00:00:00Z',type:'move-in',isOwner:true};
 const manifest={sessionId:'sample',version:1,elements:[],frames:[],assets:[{kind:'video',name:'sample.mp4',mediaRef:'sample',startTimeSeconds:0,durationSeconds:20}]};
 const capture={capture:{manifest},markers:[]};let spatialRequests=0,release;
 const originalFetch=global.fetch;
 global.fetch=async(url)=>{
  if(String(url).endsWith('/markers'))return Response.json({id:'marker',elementId:null});
  if(String(url).includes('/spatial')){spatialRequests++;if(spatialRequests>1)await new Promise(resolve=>release=resolve);return Response.json(capture);}
  return Response.json({inspections:[scan]});
 };
 const filename=path.resolve('components/room-detail.tsx'),mod=new Module(filename,module);mod.filename=filename;mod.paths=module.paths;const original=mod.require.bind(mod);
 const furniture=require('typescript').transpileModule(fs.readFileSync('lib/spatial/furniture.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
 const furnitureMod=new Module(path.resolve('lib/spatial/furniture.ts'),module);furnitureMod._compile(furniture,'furniture.ts');
 mod.require=id=>id==='react'?hooks:id==='next/dynamic'?()=> 'SpatialViewer':id==='next/navigation'?{useRouter:()=>({push(){}})}:id==='next/link'?'Link':id==='@/lib/api'?{api:{room:async()=>({room:{id:'room-a',name:'Sample'}}),inspection:async()=>({inspection:scan,findings:[]})}}:id==='@/lib/processing-workflow'?{isInspectionProcessing:i=>i&&(['queued','processing'].includes(i.status)||i.scanReportStatus==='processing')}:id==='@/lib/spatial/furniture'?furnitureMod.exports:id==='./use-object-reconstruction'?{useObjectReconstruction:()=>({cloud:null,reconstructing:false})}:id.startsWith('./')?'Child':original(id);
 mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,filename);
 const render=()=>{cursor=0;effects=[];tree=mod.exports.default({roomId:'room-a'});effects.forEach(fn=>fn());return tree;};
 const find=(node,predicate)=>{if(!node||typeof node!=='object')return null;if(predicate(node))return node;for(const child of [node.props?.children].flat(Infinity)){const found=find(child,predicate);if(found)return found;}return null;};
 return {render,find,get tree(){return tree;},get requests(){return spatialRequests;},release:()=>release?.(),close(){cleanups.forEach(fn=>fn?.());global.fetch=originalFetch;}};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('saving a video marker refreshes findings without replacing the mounted video viewer with a loading screen',async()=>{
 const h=roomHarness();try{
  h.render();await settle();h.render();await settle();h.render();
  const before=h.find(h.tree,n=>n.type==='SpatialViewer');assert(before,'room viewer loaded');
  const oldManifest=before.props.manifest;
  await before.props.video.props.onMark({time:4,point:{x:.5,y:.5},snapshot:null,video:{width:100,height:100},note:'Source mark'});
  h.render();h.render();
  assert.equal(h.requests,2);assert(h.find(h.tree,n=>n.type==='SpatialViewer'),'viewer stays mounted while refreshed data is pending');
  h.release();await settle();h.render();
  const after=h.find(h.tree,n=>n.type==='SpatialViewer');assert(after);assert.strictEqual(after.props.manifest,oldManifest,'unchanged scene geometry keeps its identity');
 }finally{h.close();}
});
