import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { HOSTS } = require('../src/core.cjs');
const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'dist');
const { version } = JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid package version');
let base = process.env.PUBLIC_BASE_URL || 'http://127.0.0.1:4187';
const url = new URL(base);
const privateHost = /^(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(url.hostname);
if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && privateHost)) || url.username || url.password || url.search || url.hash || !/^[A-Za-z0-9./:_-]+$/.test(base)) throw new Error('PUBLIC_BASE_URL 必须为 HTTPS 或局域网 HTTP 地址，不含密码、查询或特殊字符');
base = base.replace(/\/$/, '');
const source = await readFile(path.join(root, 'src/core.cjs'), 'utf8');
const vendor = await readFile(path.join(root, 'vendor/location-spoofer.cjs'), 'utf8');
const metadata = JSON.parse(await readFile(path.join(root, 'vendor/upstream.json'), 'utf8'));
for (const [file, expected] of Object.entries(metadata.files)) {
  if (createHash('sha256').update(await readFile(path.join(root, file))).digest('hex') !== expected) throw new Error('上游完整性校验失败: ' + file);
}
const wrap = text => `(function(){var module={exports:{}};\n${text}\nreturn module.exports;})()`;
const intro = '// Shadowrocket Location Helper ' + version + ' — AGPL-3.0\n// Source: ' + base + '/source.zip\n';
const start = intro + '(function(){\nconst lib=' + wrap(source) + ';\nconst helper=lib.createHelper($persistentStore);\n';
const end = '\n})();\n';
let html = (await readFile(path.join(root, 'web/panel.html'), 'utf8')).replaceAll('__MODULE_URL__', base + '/location-helper.sgmodule').replaceAll('__SOURCE_URL__', base + '/source.zip');
await mkdir(out, { recursive:true });
await writeFile(path.join(out, 'index.html'), html);
await writeFile(path.join(out, 'panel.js'), start + `try{$done(helper.handle($request,${JSON.stringify(html)}) || {});}catch(e){$done({response:{status:500,headers:{'X-Location-Helper':'1','Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify({error:'模块存储或控制接口错误'})}});}` + end);
await writeFile(path.join(out, 'observe.js'), start + 'try{$done(helper.observe($request));}catch(e){$done({});}' + end);
await writeFile(path.join(out, 'rewrite.js'), start + 'const engine=' + wrap(vendor) + ';\ntry{$done(helper.rewrite($request,$response,engine));}catch(e){$done({});}' + end);
for (const name of ['panel','observe','rewrite']) await writeFile(path.join(out,`${name}-${version}.js`),await readFile(path.join(out,name+'.js')));
const wloc = '^https?:\\/\\/(?:gs-loc(?:-cn)?\\.apple\\.com|gsp-ssl\\.ls\\.apple\\.com|bluedot\\.is\\.autonavi\\.com(?:\\.gds\\.alibabadns\\.com)?)\\/clls\\/wloc(?:\\?.*)?$';
const panel = '^https:\\/\\/gs-loc\\.apple\\.com\\/wloc-helper\\/';
const moduleText = `#!name=定位助手 · 本地控制与诊断
#!desc=默认关闭改写。面板 https://gs-loc.apple.com/wloc-helper/ 。iOS 27 RC 未验证，响应已改写不代表系统位置生效。
#!category=Tools

[Script]
Location Helper Panel = type=http-request,pattern=${panel},requires-body=1,max-size=16384,timeout=10,script-path=${base}/panel-${version}.js
Location Helper Observe = type=http-request,pattern=${wloc},requires-body=0,timeout=10,script-path=${base}/observe-${version}.js
Location Helper Rewrite = type=http-response,pattern=${wloc},requires-body=1,binary-body-mode=1,max-size=1048576,timeout=30,script-path=${base}/rewrite-${version}.js

[MITM]
hostname = %APPEND% ${HOSTS.join(', ')}
`;
await writeFile(path.join(out, 'location-helper.sgmodule'), moduleText);
// Include corresponding source and licenses without local Git metadata, credentials or artifacts.
const entries = ['README.md','LICENSE','THIRD_PARTY_NOTICES.md','package.json','package-lock.json','src','web','scripts','tests','vendor','docs'];
execFileSync('python3', ['-c', `import sys,zipfile,pathlib\nr=pathlib.Path(sys.argv[1])\nwith zipfile.ZipFile(r/'dist/source.zip','w',zipfile.ZIP_DEFLATED) as z:\n for name in sys.argv[2:]:\n  p=r/name\n  if not p.exists(): continue\n  for f in ([p] if p.is_file() else sorted(p.rglob('*'))):\n   if f.is_file(): z.write(f,str(f.relative_to(r)))\n`, root, ...entries]);
const hashes = [];
for (const file of (await readdir(out)).sort()) {
  if (file !== 'SHA256SUMS') hashes.push(createHash('sha256').update(await readFile(path.join(out,file))).digest('hex') + '  ' + file);
}
await writeFile(path.join(out, 'SHA256SUMS'), hashes.join('\n') + '\n');
console.log('Built dist/ — module: ' + base + '/location-helper.sgmodule');
if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') console.log('Local preview only. Set PUBLIC_BASE_URL to a phone-reachable LAN address before importing.');
