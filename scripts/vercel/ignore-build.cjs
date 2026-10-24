// Vercel: exit 0 skips the build; exit 1 builds. Fail open when history is unavailable.
const { execFileSync } = require('node:child_process');
// Hobby builds one deployment at a time: branch previews queue in front of production and fill Function Storage.
const branch = process.env.VERCEL_GIT_COMMIT_REF || '';
if (process.env.VERCEL_ENV === 'preview' && !branch.startsWith('preview/')) { console.log(`Skipping preview for ${branch}. Name a branch preview/* to get a preview deployment.`); process.exit(0); }
const previous = process.env.VERCEL_GIT_PREVIOUS_SHA;
if (!previous || !/^[a-f0-9]{40}$/i.test(previous)) process.exit(1);
try {
  const files = execFileSync('git', ['diff', '--name-only', '--no-renames', '-z', previous, 'HEAD'], {encoding:'utf8'}).split('\0').filter(Boolean);
  const nativeOrDocsOnly = files.length > 0 && files.every(file => file.startsWith('ios/') || file.startsWith('docs/') || file === 'README.md');
  console.log(nativeOrDocsOnly ? 'Skipping web build: only iPhone source or documentation changed.' : 'Web changes detected; continuing deployment.');
  process.exit(nativeOrDocsOnly ? 0 : 1);
} catch {
  console.log('Previous deployment history unavailable; continuing deployment.');
  process.exit(1);
}
