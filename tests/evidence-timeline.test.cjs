const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
function load(file){const filename=path.resolve(file),mod=new Module(filename,module);mod.filename=filename;mod.paths=module.paths;const original=mod.require.bind(mod);mod.require=id=>id.startsWith('@/')?load(id.slice(2)+'.ts'):original(id);mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,filename);return mod.exports;}
const Timeline=load('components/evidence-timeline.tsx').default;
test('photo playback uses the evidence aspect ratio, keeping overlay coordinates aligned',()=>{
 for(const [width,height] of [[1600,1200],[1200,1600],[1920,1080]]){
  const html=renderToStaticMarkup(React.createElement(Timeline,{frames:[{image:'source.jpg',timestamp:1,width,height}],findings:[],assetUrl:name=>'/private/'+name,onSelect:()=>{}}));
  assert(html.includes(`aspect-ratio:${width/height}`));
  assert(html.includes('src="/private/source.jpg"'));
 }
});
test('a frame without loaded pixels does not show boxes from the new camera pose',()=>{
 const html=renderToStaticMarkup(React.createElement(Timeline,{frames:[{image:'source.jpg',timestamp:1,width:1600,height:1200}],findings:[{id:'damage',kind:'damage',label:'Scratch',timestampSeconds:1,boundingBox:{x:.2,y:.2,width:.1,height:.1}}],assetUrl:name=>'/private/'+name,onSelect:()=>{}}));
 assert(!html.includes('walkthrough-mark is-damage'));
});
