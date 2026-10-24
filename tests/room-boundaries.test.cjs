const test=require("node:test"),assert=require("node:assert/strict"),ts=require("typescript"),fs=require("fs"),path=require("path"),Module=require("module");
const filename=path.resolve("lib/spatial/room-boundaries.ts"),mod=new Module(filename,module);mod.filename=filename;mod.paths=module.paths;mod._compile(ts.transpileModule(fs.readFileSync(filename,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,filename);
const {suggestRoomBoundaries}=mod.exports;
const frame=(z,t)=>({timestamp:t,transform:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,z,1]});
const door={id:"door1",category:"door",dimensions:[1,2,0.1],transform:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]};
test("doorway traversal proposes a boundary once",()=>{const found=suggestRoomBoundaries({elements:[door],frames:[frame(-1,0),frame(-.6,1),frame(.5,2),frame(1,3)]});assert.equal(found.length,1);assert.equal(found[0].label,"Room 2");});
test("seeing a door from one side does not split rooms",()=>assert.equal(suggestRoomBoundaries({elements:[door],frames:[frame(-1,0),frame(-.8,1),frame(-.5,2),frame(-.7,3)]}).length,0));
test("non-door elements do not create boundaries",()=>assert.equal(suggestRoomBoundaries({elements:[{...door,category:"cabinet"}],frames:[frame(-1,0),frame(-.6,1),frame(.5,2),frame(1,3)]}).length,0));
