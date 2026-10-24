const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),Module=require('module'),ts=require('typescript'),sharp=require('sharp');
function load(reply,calls){const filename=path.resolve('lib/server/damage.ts'),mod=new Module(filename,module);mod.filename=filename;mod.paths=module.paths;mod.require=id=>id==='@google/genai'?{GoogleGenAI:class{models={generateContent:async args=>{calls.push(args);return {text:JSON.stringify(reply)}}}}}:require(id);mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,filename);return mod.exports;}
const photo=()=>sharp({create:{width:1000,height:800,channels:3,background:'#987654'}}).jpeg().toBuffer();
test('manual target sends the exact snapshot context and crop, then maps crop coordinates to the full image',async()=>{
 const previous=process.env.GEMINI_API_KEY;process.env.GEMINI_API_KEY='test-only';
 try{const calls=[],{describeAtPoint}=load({found:true,type:'scratch',label:'Scratch',description:'Visible scratch at the marked point',boundingBox:{x:.25,y:.25,width:.5,height:.5}},calls);
 const seen=await describeAtPoint(await photo(),{x:.5,y:.5});
 assert.deepEqual(seen.boundingBox,{x:.42000000000000004,y:.4,width:.16,height:.2});
 assert.equal(calls.length,1);assert.equal(calls[0].contents.filter(p=>p.inlineData).length,2);
 const full=await sharp(Buffer.from(calls[0].contents[0].inlineData.data,'base64')).metadata(),crop=await sharp(Buffer.from(calls[0].contents[1].inlineData.data,'base64')).metadata();
 assert.equal(full.width,1000);assert.equal(full.height,800);assert.equal(crop.width,768);assert.equal(crop.height,768);
 assert.match(calls[0].contents[2].text,/relative to IMAGE 2/);
 }finally{if(previous===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=previous}
});
test('manual localization rejects undamaged and off-target boxes rather than inventing a region',async()=>{
 const previous=process.env.GEMINI_API_KEY;process.env.GEMINI_API_KEY='test-only';
 try{for(const reply of [{found:false,boundingBox:{x:.25,y:.25,width:.5,height:.5}},{found:true,boundingBox:{x:0,y:0,width:.1,height:.1}},{found:true,boundingBox:{x:.9,y:.9,width:.3,height:.3}}]){
 const {describeAtPoint}=load({...reply,type:'other',label:'Spot',description:'Description'},[]);assert.equal((await describeAtPoint(await photo(),{x:.5,y:.5})).boundingBox,null);
 }}finally{if(previous===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=previous}
});
test('edge targets and odd image sizes use integer crop bounds',async()=>{
 const previous=process.env.GEMINI_API_KEY;process.env.GEMINI_API_KEY='test-only';
 try{const {describeAtPoint}=load({found:true,type:'chip',label:'Chip',description:'Visible at edge',boundingBox:{x:.9,y:.9,width:.1,height:.1}},[]);const image=await sharp({create:{width:101,height:79,channels:3,background:'white'}}).jpeg().toBuffer();const seen=await describeAtPoint(image,{x:1,y:1});assert(seen.boundingBox);await assert.rejects(()=>describeAtPoint(image,{x:NaN,y:.5}),/Invalid aim point/)}finally{if(previous===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=previous}
});
