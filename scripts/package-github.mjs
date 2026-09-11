import { execFileSync } from 'node:child_process';
import { mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const base = 'https://raw.githubusercontent.com/albertguoanrui-eng/ios-location-helper/main/module';
execFileSync(process.execPath, ['scripts/build.mjs'], { cwd:root, stdio:'inherit', env:{...process.env,PUBLIC_BASE_URL:base} });
execFileSync(process.execPath, ['scripts/check.mjs'], { cwd:root, stdio:'inherit' });
await mkdir(path.join(root,'module'), { recursive:true });
for (const file of ['index.html','panel.js','observe.js','rewrite.js','location-helper.sgmodule','source.zip','SHA256SUMS']) {
  await copyFile(path.join(root,'dist',file),path.join(root,'module',file));
}
console.log('GitHub distribution prepared in module/');
