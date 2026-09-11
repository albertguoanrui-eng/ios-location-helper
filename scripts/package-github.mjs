import { execFileSync } from 'node:child_process';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const base = 'https://raw.githubusercontent.com/albertguoanrui-eng/ios-location-helper/main/module';
execFileSync(process.execPath, ['scripts/build.mjs'], { cwd:root, stdio:'inherit', env:{...process.env,PUBLIC_BASE_URL:base} });
execFileSync(process.execPath, ['scripts/check.mjs'], { cwd:root, stdio:'inherit' });
await mkdir(path.join(root,'module'), { recursive:true });
const files = ['index.html','panel.js','observe.js','rewrite.js','location-helper.sgmodule','source.zip'];
for (const file of files) {
  await copyFile(path.join(root,'dist',file),path.join(root,'module',file));
}
const fallback = 'https://cdn.jsdelivr.net/gh/albertguoanrui-eng/ios-location-helper@main/module';
const original = await readFile(path.join(root,'module/location-helper.sgmodule'),'utf8');
const cdnModule = original.replace('定位助手 · 本地控制与诊断','定位助手 · CDN 下载入口').replaceAll(base,fallback);
if (cdnModule.includes(base) || (cdnModule.match(/script-path=https:\/\/cdn\.jsdelivr\.net\//g) || []).length !== 3) throw new Error('CDN module must use CDN URLs for all scripts');
await writeFile(path.join(root,'module/location-helper-cdn.sgmodule'),cdnModule);
files.push('location-helper-cdn.sgmodule');
const hashes = [];
for (const file of files.sort()) hashes.push(createHash('sha256').update(await readFile(path.join(root,'module',file))).digest('hex')+'  '+file);
await writeFile(path.join(root,'module/SHA256SUMS'),hashes.join('\n')+'\n');
console.log('GitHub distribution prepared in module/');
