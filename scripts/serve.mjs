import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../dist');
const { version } = JSON.parse(await readFile(path.resolve(import.meta.dirname,'../package.json'),'utf8'));
const host = process.env.HOST || '127.0.0.1', port = Number(process.env.PORT || 4187);
const allowed = new Set(['index.html','panel.js','observe.js','rewrite.js','location-helper.sgmodule','source.zip','SHA256SUMS',...['panel','observe','rewrite'].map(name=>`${name}-${version}.js`)]);
const types = { '.html':'text/html; charset=utf-8', '.js':'application/javascript; charset=utf-8', '.sgmodule':'text/plain; charset=utf-8', '.zip':'application/zip' };
http.createServer(async (req,res) => {
  const p = new URL(req.url,'http://localhost').pathname;
  const file = p === '/' ? 'index.html' : p.slice(1);
  if (!['GET','HEAD'].includes(req.method) || !allowed.has(file)) { res.writeHead(404); res.end('Not found'); return; }
  try { const data = await readFile(path.join(root,file)); res.writeHead(200, { 'Content-Type':types[path.extname(file)] || 'text/plain; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff' }); res.end(req.method === 'HEAD' ? undefined : data); }
  catch { res.writeHead(404); res.end('Run npm run build first.'); }
}).listen(port,host,() => console.log(`Local: http://${host}:${port}/`));
