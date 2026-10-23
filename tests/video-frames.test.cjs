const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
function load(relative, suffix = '') {
  const filename = path.resolve(relative);
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = module.paths;
  const originalRequire = mod.require.bind(mod);
  mod.require = (id) => id === './video-frames' ? load('lib/server/video-frames.ts') : originalRequire(id);
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8') + suffix, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText, filename);
  return mod.exports;
}
const { openVideoFrames } = load('lib/server/video-frames.ts');
test('source frames preserve resolution and reject invalid timestamps/media', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dwelld-fixture-'));
  try {
    const source = path.join(dir, 'fixture.mp4');
    execFileSync(require('ffmpeg-static'), ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=640x360:r=25', '-t', '2', '-pix_fmt', 'yuv420p', source]);
    const frames = await openVideoFrames(fs.readFileSync(source));
    try {
      assert(frames.durationSeconds > 1.8 && frames.durationSeconds <= 2.1);
      const image = await frames.extract(1);
      assert.equal(image.readUInt32BE(16), 640);
      assert.equal(image.readUInt32BE(20), 360);
      await assert.rejects(frames.extract(-1));
      await assert.rejects(frames.extract(frames.durationSeconds));
    } finally { await frames.close(); }
    await assert.rejects(openVideoFrames(Buffer.from('invalid')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
