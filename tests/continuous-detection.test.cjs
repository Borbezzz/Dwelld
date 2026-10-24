const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const sharp = require('sharp');
function load(relative, stubs = {}) {
  const filename = path.resolve(relative), mod = new Module(filename, module);
  mod.filename = filename; mod.paths = module.paths;
  const original = mod.require.bind(mod);
  mod.require = id => Object.hasOwn(stubs, id) ? stubs[id] : id.startsWith('.') ? load(path.join(path.dirname(relative), id + '.ts'), stubs) : original(id);
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, filename);
  return mod.exports;
}
const { videoSampleTimes } = load('lib/video-sampling.ts');
const { parseVideoDamageResponse } = load('lib/server/damage.ts');
const observation = { type: 'scratch', description: 'Visible scratch', boundingBox: { x: .4, y: .4, width: .2, height: .2 } };
const pose = { width: 100, height: 100, intrinsics: [100,0,0,0,100,0,50,50,1], transform: [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1] };
const image = () => sharp({ create: { width: 100, height: 100, channels: 3, background: 'white' } }).png().toBuffer();
test('one-second video coverage includes the beginning and end without timestamps outside short clips', () => {
  for (const duration of [.01, .5, 1, 1.1, 2, 60, 120]) {
    const samples = videoSampleTimes(duration);
    assert.equal(samples[0], 0);
    assert(samples.every(t => t >= 0 && t < duration));
    assert.equal(new Set(samples).size, samples.length);
    for (let i = 1; i < samples.length; i++) assert(samples[i] - samples[i - 1] <= 1);
    assert(duration - samples.at(-1) < .2);
    assert(samples.length <= 121);
  }
  assert(videoSampleTimes(60).length >= 60);
  for (const d of [0, -1, Infinity, NaN, 121]) assert.throws(() => videoSampleTimes(d));
});
test('batch parser rejects missing, duplicated, hallucinated timestamps and invalid boxes', () => {
  const good = {frames:[{timestampSeconds:0,damage:[observation]},{timestampSeconds:1,damage:[]}]};
  assert.deepEqual(parseVideoDamageResponse(JSON.stringify(good), [0,1]).get(0), [observation]);
  for (const frames of [good.frames.slice(0,1), [good.frames[0],good.frames[0]], [good.frames[0],{timestampSeconds:10,damage:[]}], [{timestampSeconds:0,damage:[{...observation,boundingBox:{x:2,y:0,width:.1,height:.1}}]},good.frames[1]]]) {
    assert.throws(() => parseVideoDamageResponse(JSON.stringify({frames}), [0,1]));
  }
});
test('native detection works without RoomPlan categories and publishes before verification completes', async () => {
  let published = false, verified = false;
  const { analyzeEvidenceFrame } = load('lib/server/frame-analysis.ts', {
    './damage': {inspectVisibleDamage:async()=>[observation]},
    './crack-detector': {inspectCracks:async()=>[]},
    './verify': {autoApproveThreshold:()=>.85,verifyFinding:async()=>{assert(published);verified=true;return {verdict:'damage',confidence:.9,reason:'Visible mark'};}},
  });
  const result = await analyzeEvidenceFrame(await image(), pose, [], {walls:true,onCandidates:async candidates=>{
    assert(!verified); assert.equal(candidates.length,1); assert.equal(candidates[0].reviewStatus,'pending');
    assert.equal(candidates[0].worldPosition,null); published=true;
  }});
  assert(verified); assert.equal(result.findings[0].reviewStatus,'confirmed'); assert.equal(result.findings[0].autoApproved,true);
});
test('native marks are projected onto the nearest real surface and false positives are removed after publishing', async () => {
  let candidate;
  const { analyzeEvidenceFrame } = load('lib/server/frame-analysis.ts', {
    './damage': {inspectVisibleDamage:async()=>[observation]},
    './crack-detector': {inspectCracks:async()=>[]},
    './verify': {autoApproveThreshold:()=>.85,verifyFinding:async()=>({verdict:'not_damage',confidence:.9,reason:'Seam'})},
  });
  const wall = {id:'wall1',category:'wall',dimensions:[4,4,.05],transform:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,-2,1]};
  const result = await analyzeEvidenceFrame(await image(), pose, [wall], {walls:true,onCandidates:async findings=>{candidate=findings[0];}});
  assert.equal(candidate.elementId,'wall1'); assert(Math.abs(candidate.worldPosition[2]+1.975)<.001);
  assert.equal(result.findings.length,0); assert.equal(result.dropped,1);
});
test('damage service failures propagate instead of reporting an empty clean photo', async () => {
  const { analyzeEvidenceFrame } = load('lib/server/frame-analysis.ts', {
    './damage': {inspectVisibleDamage:async()=>{throw new Error('unavailable')}},
    './crack-detector': {inspectCracks:async()=>[]}, './verify': {},
  });
  await assert.rejects(analyzeEvidenceFrame(await image(), pose, [], {walls:true}), /unavailable/);
});
test('video batches cover legacy sparse uploads and retain source timestamps with two concurrent requests maximum', async () => {
  let active = 0, peak = 0; const checked = [];
  const { analyzeVideo } = load('lib/server/inspection.ts', {
    './damage': {validBox:b=>b,inspectUnsupportedFurniture:async()=>[],inspectVideoDamageBatch:async frames=>{
      active++;peak=Math.max(peak,active);checked.push(...frames.map(f=>f.timestampSeconds));
      await new Promise(resolve=>setTimeout(resolve,5));active--;
      return new Map(frames.map(f=>[f.timestampSeconds,[observation]]));
    }},
    './crack-detector': {inspectCracks:async()=>[],CRACK_MODEL:'test'},
    './media': {parseMediaId:()=>true,readMedia:async()=>Buffer.from('video'),writeMedia:async()=> 'gridfs:test',deleteMedia:async()=>{}},
    './video-frames': {openVideoFrames:async()=>({durationSeconds:15,extract:async t=>Buffer.from(`photo-${t}`),close:async()=>{}})},
  });
  const previous = process.env.GEMINI_API_KEY;process.env.GEMINI_API_KEY='test-only';
  try {
    const result = await analyzeVideo('gridfs:test','video/mp4',[{timestampSeconds:2,detections:[]}]);
    assert.deepEqual(checked.sort((a,b)=>a-b),videoSampleTimes(15));
    assert.equal(result.findings.length,checked.length);assert.equal(result.incomplete,false);assert.equal(peak,2);
    assert.deepEqual(result.findings.map(f=>f.timestampSeconds),videoSampleTimes(15));
  } finally {if(previous===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=previous;}
});

const {analysisFailure}=load('lib/server/analysis-failure.ts');
test('billing caps and invalid keys are permanent blocks, distinct from transient rate limits',()=>{
  for(const message of ['Your billing account has exceeded its monthly spending cap','API key not valid. API_KEY_INVALID']){
    const failure=analysisFailure(Object.assign(new Error(message+' secret-provider-url'),{status:message.includes('billing')?429:400}));
    assert.equal(failure.blocksService,true);assert.equal(failure.retryable,false);assert(!JSON.stringify(failure).includes('secret-provider-url'));
  }
  assert.equal(analysisFailure({status:429}).retryable,true);
  assert.equal(analysisFailure({status:503}).retryable,true);
});
function videoWithServices(damage, furniture=async()=>[], cracks=async()=>[]) {
  const saved=[];
  const mod=load('lib/server/inspection.ts',{
    './damage':{validBox:b=>b,inspectVideoDamageBatch:damage,inspectUnsupportedFurniture:furniture},
    './crack-detector':{inspectCracks:cracks,CRACK_MODEL:'test'},
    './media':{parseMediaId:()=>true,readMedia:async()=>Buffer.from('video'),writeMedia:async()=>{const ref=`gridfs:evidence-${saved.length}`;saved.push(ref);return ref;},deleteMedia:async()=>{}},
    './video-frames':{openVideoFrames:async()=>({durationSeconds:15,extract:async t=>Buffer.from(`frame-${t}`),close:async()=>{}})},
  });
  return {...mod,saved};
}
test('failed damage batches retain every evidence image, real objects, independent furniture and crack candidates',async()=>{
  const furniture={label:'desk',description:'Visible desk',boundingBox:observation.boundingBox};
  const service=videoWithServices(async()=>{throw new Error('malformed secret response')},async()=>[furniture],async()=>[{boundingBox:observation.boundingBox,confidence:.8}]);
  const result=await service.analyzeVideo('gridfs:video','video/mp4',[{timestampSeconds:0,detections:[{objectId:'chair1',label:'chair',boundingBox:observation.boundingBox}]}]);
  assert.equal(result.findings.filter(f=>f.detectionSource==='yolo').length,1);
  assert.equal(result.findings.filter(f=>f.kind==='object'&&f.label==='desk').length,3);
  assert.equal(result.findings.filter(f=>f.detectionSource==='crack-model').length,videoSampleTimes(15).length);
  assert.equal(result.evidenceFrames.length,videoSampleTimes(15).length);assert(result.incomplete);
  assert(!result.warnings.join('').includes('secret'));
});
test('billing block stops later Gemini calls while still preserving the entire source evidence and objects',async()=>{
  let calls=0;
  const fail=async()=>{calls++;throw Object.assign(new Error('Monthly spending cap exceeded; secret'),{status:429});};
  const service=videoWithServices(fail,fail);
  const result=await service.analyzeVideo('gridfs:video','video/mp4',[{timestampSeconds:0,detections:[{objectId:'chair1',label:'chair',boundingBox:observation.boundingBox}]}]);
  assert(calls<=4);assert.equal(result.findings.length,1);assert.equal(result.evidenceFrames.length,videoSampleTimes(15).length);
  assert.equal(result.warnings.filter(w=>w.includes('billing')).length,1);assert(result.incomplete);
});
test('temporary batch outage retries once and successful recovery is fully assessed',async()=>{
  let attempts=0;
  const service=videoWithServices(async frames=>{
    if(++attempts===1)throw Object.assign(new Error('temporary'),{status:503});
    return new Map(frames.map(f=>[f.timestampSeconds,[]]));
  });
  const result=await service.analyzeVideo('gridfs:video','video/mp4',[{timestampSeconds:0,detections:[]}]);
  assert.equal(attempts,4);assert.equal(result.incomplete,false);assert.equal(result.evidenceFrames.length,videoSampleTimes(15).length);
});
