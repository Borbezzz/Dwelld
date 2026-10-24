const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
function load(file,loadedImage){const filename=path.resolve(file),mod=new Module(filename,module);mod.filename=filename;mod.paths=module.paths;const original=mod.require.bind(mod);mod.require=id=>id==='react'&&loadedImage?{...React,useState:initial=>React.useState(initial===null?loadedImage:initial)}:id.startsWith('@/')?load(id.slice(2)+'.ts'):original(id);mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,filename);return mod.exports;}
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

test('native sensor playback rotates the image and its boxes clockwise while labels stay upright',()=>{
 const Loaded=load('components/evidence-timeline.tsx',{source:'/private/source.jpg',width:1600,height:1200}).default;
 const html=renderToStaticMarkup(React.createElement(Loaded,{portraitSensorFrames:true,frames:[{image:'source.jpg',timestamp:1,width:1600,height:1200}],findings:[{id:'table',kind:'damage',label:'Table',timestampSeconds:1,boundingBox:{x:.2,y:.1,width:.3,height:.4}}],assetUrl:name=>'/private/'+name,onSelect:()=>{}}));
 assert(html.includes('aspect-ratio:0.75'));
 assert(html.includes('rotate(90deg)'));
 assert(html.includes('left:50%;top:20%;width:40%;height:30%'));
 assert(html.includes('<span>Table</span>'));
});
test('already upright native photos are not rotated twice',()=>{
 const Loaded=load('components/evidence-timeline.tsx',{source:'/private/source.jpg',width:1200,height:1600}).default;
 const html=renderToStaticMarkup(React.createElement(Loaded,{portraitSensorFrames:true,frames:[{image:'source.jpg',timestamp:1,width:1600,height:1200}],findings:[],assetUrl:name=>'/private/'+name,onSelect:()=>{}}));
 assert(html.includes('aspect-ratio:0.75'));assert(!html.includes('rotate(90deg)'));
});
test('portrait boxes and pins follow the same clockwise transform, including image edges',()=>{
 const {portraitEvidenceBox:box,portraitEvidencePoint:point}=load('lib/client/evidence-orientation.ts');
 assert.deepEqual(point({x:0,y:0}),{x:1,y:0});
 assert.deepEqual(point({x:1,y:1}),{x:0,y:1});
 assert.deepEqual(box({x:0,y:0,width:1,height:1}),{x:0,y:0,width:1,height:1});
 const source={x:.2,y:.1,width:.3,height:.4},out=box(source),center=point({x:source.x+source.width/2,y:source.y+source.height/2});
 assert(Math.abs(out.x+out.width/2-center.x)<1e-10);assert(Math.abs(out.y+out.height/2-center.y)<1e-10);
});
