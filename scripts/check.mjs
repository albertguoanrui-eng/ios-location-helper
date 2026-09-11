import { readFile, readdir } from 'node:fs/promises';
import { Script } from 'node:vm';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const root = path.resolve(import.meta.dirname,'..');
const out = path.join(root,'dist');
for (const file of ['panel.js','observe.js','rewrite.js']) new Script(await readFile(path.join(out,file),'utf8'),{filename:file});
const html = await readFile(path.join(out,'index.html'),'utf8');
for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Script(match[1]);
if (/__(MODULE|SOURCE)_URL__/.test(html)) throw new Error('Unresolved build placeholders');
const hashes = (await readFile(path.join(out,'SHA256SUMS'),'utf8')).trim().split('\n');
for (const line of hashes) {
  const [hash,file] = line.split('  ');
  if (createHash('sha256').update(await readFile(path.join(out,file))).digest('hex') !== hash) throw new Error('Artifact changed: '+file);
}
if ((await readdir(out)).length !== hashes.length+1) throw new Error('Untracked build artifact');
execFileSync('python3',['-c',`import pathlib,zipfile,sys
r=pathlib.Path(sys.argv[1])
with zipfile.ZipFile(r/'dist/source.zip') as z:
 assert z.testzip() is None
 names=z.namelist()
 for name in ['src/core.cjs','vendor/location-spoofer.cjs','LICENSE','scripts/build.mjs','web/panel.html','tests/helper.test.cjs','README.md']:
  assert name in names and z.read(name)==(r/name).read_bytes(), name
 assert not any('/.git/' in n or '.env' in n for n in names)
`,root]);
console.log('PASS: adapter/panel syntax, all artifact hashes, corresponding source archive');
