import { execFileSync } from 'node:child_process';
import { mkdir, copyFile, readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const { version } = JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
const stable = new Map();
for (const entry of await readdir(path.join(root,'module'), {withFileTypes:true})) if (entry.isFile()) stable.set(entry.name,await readFile(path.join(root,'module',entry.name)));
const directory = 'module/lab';
const base = 'https://raw.githubusercontent.com/albertguoanrui-eng/ios-location-helper/main/module/lab';
execFileSync(process.execPath, ['scripts/build.mjs'], { cwd:root, stdio:'inherit', env:{...process.env,PUBLIC_BASE_URL:base} });
execFileSync(process.execPath, ['scripts/check.mjs'], { cwd:root, stdio:'inherit' });
await mkdir(path.join(root,directory), { recursive:true });
const files = ['index.html','panel.js','observe.js','rewrite.js','location-helper.sgmodule','source.zip',...['panel','observe','rewrite'].map(name=>`${name}-${version}.js`)];
for (const file of files) {
  await copyFile(path.join(root,'dist',file),path.join(root,directory,file));
}
const fallback = 'https://cdn.jsdelivr.net/gh/albertguoanrui-eng/ios-location-helper@main/module/lab';
const original = await readFile(path.join(root,directory,'location-helper.sgmodule'),'utf8');
const cdnModule = original.replace('定位助手 · 0.1.3 实验版','定位助手 · 0.1.3 实验版 CDN').replaceAll(base,fallback);
if (cdnModule.includes(base) || (cdnModule.match(/script-path=https:\/\/cdn\.jsdelivr\.net\//g) || []).length !== 3) throw new Error('CDN module must use CDN URLs for all scripts');
await writeFile(path.join(root,directory,'location-helper-cdn.sgmodule'),cdnModule);
files.push('location-helper-cdn.sgmodule');
for (const [name,content] of [[`location-helper-${version}.sgmodule`,original],[`location-helper-cdn-${version}.sgmodule`,cdnModule]]) {
  await writeFile(path.join(root,directory,name),content); files.push(name);
}
const hashes = [];
for (const file of files.sort()) hashes.push(createHash('sha256').update(await readFile(path.join(root,directory,file))).digest('hex')+'  '+file);
await writeFile(path.join(root,directory,'SHA256SUMS'),hashes.join('\n')+'\n');
for (const [name,bytes] of stable) if (!bytes.equals(await readFile(path.join(root,'module',name)))) throw Error('Stable artifact changed: '+name);
console.log('GitHub distribution prepared in module/lab/');
