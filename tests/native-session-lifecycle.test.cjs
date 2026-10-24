const test=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
test('native Keychain session isolation preserves unfinished captures while clearing active state',{skip:process.platform!=='darwin',timeout:60000},()=>{
 const result=spawnSync('python3',['ios/Tests/check-session-lifecycle.py'],{encoding:'utf8',timeout:55000});
 assert.equal(result.status,0,result.stderr||result.stdout||String(result.error));
});
