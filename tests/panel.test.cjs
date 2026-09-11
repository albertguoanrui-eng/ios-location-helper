'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createHelper, DEFAULT, ORIGIN, PANEL_PATH } = require('../src/core.cjs');
const html = fs.readFileSync(path.join(__dirname,'../web/panel.html'),'utf8');
const source = html.match(/<script>([\s\S]*?)<\/script>/)[1];
function backend(data = new Map()) {
  return createHelper({read:k=>data.get(k),write:(v,k)=>{data.set(k,v);return true;}});
}
const tick = () => new Promise(resolve=>setImmediate(resolve));
async function settle() { for(let i=0;i<4;i++) await tick(); }
function snapshot(helper) {
  return helper.handle({url:ORIGIN+PANEL_PATH},html).response.body.match(/<script id="initialState" type="application\/json">([\s\S]*?)<\/script>/)[1];
}
async function mount(fetcher, initial = snapshot(backend()), protocol='https:') {
  const nodes=new Map(), navigations=[], events={};
  const node=id=>{
    if(!nodes.has(id)) nodes.set(id,{textContent:'',value:'',style:{},disabled:true,className:'',events:{},addEventListener(t,f){this.events[t]=f;},reportValidity(){return true;}});
    return nodes.get(id);
  };
  node('initialState').textContent=initial;
  vm.runInNewContext(source,{document:{getElementById:node},location:{hostname:'gs-loc.apple.com',pathname:PANEL_PATH,protocol,replace:url=>navigations.push(url)},window:{addEventListener:(name,fn)=>events[name]=fn},navigator:{clipboard:{writeText:async()=>{}}},fetch:fetcher,AbortController,setTimeout,clearTimeout},{timeout:1000});
  await settle();
  return {node,navigations,events};
}
function controlFetch(helper) {
  return async (url,options) => {
    const request={url:ORIGIN+url,method:options.method||'GET',headers:{...options.headers,Origin:ORIGIN},body:options.body};
    const r=helper.handle(request,html).response;
    return new Response(r.body,{status:r.status,headers:r.headers});
  };
}
test('page carries current persisted state with no automatic fetch, including screenshot waiting state',async()=>{
  const helper=backend();helper.save({...DEFAULT,enabled:true});
  let calls=0;const {node}=await mount(async()=>{calls++;throw Error('unexpected fetch');},snapshot(helper));
  assert.equal(calls,0);assert.equal(node('control').textContent,'已连接');assert.equal(node('save').disabled,false);
  assert.equal(node('status').textContent,'设置已保存，等待定位请求');assert.equal(node('longitude').value,-0.1278);
  assert.equal(helper.state().request,null);assert.equal(helper.state().response,null);
});
test('save and stop each send once and navigate to read persisted state',async()=>{
  const helper=backend();let calls=0;const fetcher=async(...args)=>{calls++;return controlFetch(helper)(...args);};
  let panel=await mount(fetcher,snapshot(helper));
  panel.node('locationForm').events.submit({preventDefault(){}});await settle();
  assert.equal(calls,1);assert.equal(helper.config().enabled,true);assert.equal(panel.navigations.length,1);
  assert.match(panel.navigations[0],/^\/wloc-helper\/\?v=0\.1\.2&refresh=\d+$/);
  panel=await mount(fetcher,snapshot(helper));assert.equal(panel.node('enabled').textContent,'已开启');
  await panel.node('stop').onclick();assert.equal(calls,2);assert.equal(helper.config().enabled,false);assert.equal(panel.navigations.length,1);
  panel=await mount(fetcher,snapshot(helper));assert.equal(panel.node('enabled').textContent,'已关闭');
});
test('snapshot escapes stored HTML delimiters and replacement patterns without changing JSON data',()=>{
  const revision='</script><script>alert(1)</script>&$&';
  const helper=backend(new Map([['location_helper_v1:config',JSON.stringify({...DEFAULT,revision})]]));
  const raw=snapshot(helper);assert.equal(raw.includes('<'),false);assert.equal(raw.includes('&'),false);
  assert.equal(JSON.parse(raw).config.revision,revision);
});
test('invalid snapshot identifies the failed field, permits refresh and exports coordinate-free diagnostics',async()=>{
  const state=backend().state();state.protocol='1';
  const {node,navigations}=await mount(()=>{throw Error('unexpected');},JSON.stringify(state));
  assert.equal(node('save').disabled,true);assert.match(node('message').textContent,/状态校验失败：protocol/);
  assert.equal(node('export').disabled,false);await node('export').onclick();
  for(const secret of ['51.5074','-0.1278','revision']) assert.equal(node('reportBox').value.includes(secret),false);
  node('refresh').onclick();assert.equal(navigations.length,1);
});
test('missing snapshot does not fabricate success or fall back to the failing fetch path',async()=>{
  let calls=0;const {node}=await mount(()=>{calls++;},'null');
  assert.equal(calls,0);assert.equal(node('save').disabled,true);assert.match(node('message').textContent,/state/);
});
test('state validation rejects invalid coordinates, flags, unknown stage and patched counts',async()=>{
  for(const change of [s=>s.config.enabled='true',s=>s.config.latitude=91,s=>s.config.accuracy=1.1,s=>s.stage='private-unexpected',s=>s.stage='patched']) {
    const s=backend().state();change(s);const {node}=await mount(()=>{},JSON.stringify(s));
    assert.equal(node('save').disabled,true);assert.match(node('message').textContent,/状态校验失败/);
    assert.equal(node('connectionDetail').textContent.includes('private-unexpected'),false);
  }
});
for(const [name,response,expected] of [
  ['HTTP failure',()=>new Response('{}',{status:500,headers:{'X-Location-Helper':'1'}}),/HTTP 500/],
  ['untagged response',()=>new Response('{}'),/缺少本项目响应标识/],
  ['non JSON',()=>new Response('<html>private upstream error</html>',{status:404}),/非 JSON.*HTTP 404/],
  ['HTTP 200 application error',()=>new Response('{"error":"设备存储写入失败"}',{headers:{'X-Location-Helper':'1'}}),/设备存储写入失败/],
  ['network failure',()=>{throw TypeError('Failed to fetch');},/Failed to fetch/]
]) test('mutation '+name+' stays disabled without retry or navigation',async()=>{
  let calls=0;const {node,navigations}=await mount(async()=>{calls++;return response();});
  await node('stop').onclick();assert.equal(calls,1);assert.equal(navigations.length,0);assert.equal(node('save').disabled,true);
  assert.match(node('message').textContent,expected);assert.equal(node('message').textContent.includes('private upstream'),false);
});
test('HTTP page never sends coordinates and BFCache restoration refreshes only persisted pages',async()=>{
  let calls=0;const http=await mount(()=>{calls++;},snapshot(backend()),'http:');
  http.node('refresh').onclick();assert.equal(calls,0);assert.equal(http.navigations.length,0);assert.equal(http.node('status').textContent,'请使用 HTTPS 控制面板');
  const live=await mount(()=>{calls++;});live.events.pageshow({persisted:false});assert.equal(live.navigations.length,0);
  live.events.pageshow({persisted:true});assert.equal(live.navigations.length,1);
});
test('native HTTP transport returns fresh embedded state on each page navigation',async(t)=>{
  const http=require('node:http');const helper=backend();
  const server=http.createServer((req,res)=>{const reply=helper.handle({url:ORIGIN+req.url},html).response;res.writeHead(reply.status,reply.headers);res.end(reply.body);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url='http://127.0.0.1:'+server.address().port+PANEL_PATH;
  for(const enabled of [false,true,false]) {
    helper.save({...DEFAULT,enabled});const response=await fetch(url+'?refresh='+Date.now());
    assert.equal(response.headers.get('Cache-Control'),'no-store');const page=await response.text();
    const raw=page.match(/<script id="initialState" type="application\/json">([\s\S]*?)<\/script>/)[1];
    const {node}=await mount(()=>{throw Error('unexpected fetch');},raw);assert.equal(node('enabled').textContent,enabled?'已开启':'已关闭');
  }
});
