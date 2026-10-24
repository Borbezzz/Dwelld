const test=require('node:test'),assert=require('node:assert/strict'),ts=require('typescript'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
function load(relative){const filename=path.resolve(relative),mod=new Module(filename,module);mod.filename=filename;mod.paths=module.paths;const original=mod.require.bind(mod);mod.require=id=>id.startsWith('./')?load(path.join(path.dirname(relative),id+'.ts')):original(id);mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,filename);return mod.exports;}
const {placeVideoPoint,videoToSensor,nearestFrame}=load('lib/server/video-mark.ts');
const I=[1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
// Camera at the origin looking down -Z, 1920x1440 sensor; a wall 2 m ahead.
const frame=(timestamp,tx=0)=>({timestamp,image:`f${timestamp}.jpg`,width:1920,height:1440,intrinsics:[1500,0,0, 0,1500,0, 960,720,1],transform:[1,0,0,0, 0,1,0,0, 0,0,1,0, tx,0,0,1]});
const wall={id:'wall-1',category:'wall',dimensions:[6,3,.1],transform:[...I.slice(0,14),-2,1]};
const portrait={width:540,height:960};

test('a portrait video point maps back onto the landscape camera image (quarter turn)',()=>{
 assert.deepEqual(videoToSensor({x:.5,y:.5},portrait,{width:1920,height:1440}),{x:.5,y:.5});
 assert.deepEqual(videoToSensor({x:1,y:0},portrait,{width:1920,height:1440}),{x:0,y:0});
 assert.deepEqual(videoToSensor({x:.2,y:.7},{width:1920,height:1440},{width:1920,height:1440}),{x:.2,y:.7});
});
test('the centre of the video lands on the wall straight ahead',()=>{
 const r=placeVideoPoint([frame(3)],[wall],3.1,{x:.5,y:.5},portrait);
 assert.ok(!r.error,r.error);assert.ok(Math.abs(r.position[2]+1.95)<1e-6);assert.ok(Math.abs(r.position[0])<1e-6);assert.equal(r.element.id,'wall-1');
});
test('the top of the portrait video is the left of the camera, so the point lands left of centre',()=>{
 const r=placeVideoPoint([frame(3)],[wall],3,{x:.5,y:.05},portrait);
 assert.ok(r.position[0]<-.5,`x=${r.position[0]}`);
});
test('the pose comes from the saved frame nearest in time',()=>{
 const r=placeVideoPoint([frame(1,-1),frame(4,1)],[wall],3.8,{x:.5,y:.5},portrait);
 assert.equal(r.frame.timestamp,4);assert.ok(Math.abs(r.position[0]-1)<1e-6);
 assert.equal(nearestFrame([frame(1)],5),null);
});
test('clicks with no saved pose nearby or off every surface are refused with a reason',()=>{
 assert.match(placeVideoPoint([frame(1)],[wall],9,{x:.5,y:.5},portrait).error,/camera position/);
 assert.match(placeVideoPoint([frame(1)],[],1,{x:.5,y:.5},portrait).error,/surface/);
});
