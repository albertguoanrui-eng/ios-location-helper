'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createHelper, DEFAULT, ORIGIN, PANEL_PATH } = require('../src/core.cjs');
const html = fs.readFileSync(path.join(__dirname,'../web/panel.html'),'utf8');
const source = html.match(/<script>([\s\S]*?)<\/script>/)[1];
function backend() {
  const data = new Map();
  return createHelper({read:k=>data.get(k),write:(v,k)=>{data.set(k,v);return true;}});
}
const tick = () => new Promise(resolve=>setImmediate(resolve));
async function settle() { for(let i=0;i<4;i++) await tick(); }
async function mount(fetcher,protocol='https:') {
  const nodes=new Map();
  const node=id=>{
    if(!nodes.has(id)) nodes.set(id,{textContent:'',value:'',style:{},disabled:true,className:'',events:{},addEventListener(t,f){this.events[t]=f;},reportValidity(){return true;}});
    return nodes.get(id);
  };
  vm.runInNewContext(source,{document:{getElementById:node},location:{hostname:'gs-loc.apple.com',pathname:PANEL_PATH,protocol},window:{addEventListener(){}},navigator:{clipboard:{writeText:async()=>{}}},fetch:fetcher,AbortController,setTimeout,clearTimeout},{timeout:1000});
  await settle();
  return node;
}
function controlFetch(helper) {
  return async (url,options) => {
    const request={url:ORIGIN+url,method:options.method||'GET',headers:{...options.headers,Origin:ORIGIN},body:options.body};
    const r=helper.handle(request,html).response;
    return new Response(r.body,{status:r.status,headers:r.headers});
  };
}

test('control responses have numeric HTTP statuses usable by a real Fetch Response', async()=>{
  const helper=backend();
  for(const [request,status] of [
    [{url:ORIGIN+PANEL_PATH},200],
    [{url:ORIGIN+PANEL_PATH+'api/state'},200],
    [{url:ORIGIN+PANEL_PATH+'api/stop',method:'POST'},403],
    [{url:ORIGIN+PANEL_PATH+'api/config',method:'POST',headers:{'Content-Type':'application/json','X-Location-Helper':'1'},body:'bad'},400]
  ]) {
    const r=helper.handle(request,html).response;
    assert.equal(r.status,status); assert.equal(typeof r.status,'number');
    const fetchResponse=new Response(r.body,{status:r.status,headers:r.headers});
    assert.equal(fetchResponse.ok,status===200);
    assert.equal(fetchResponse.headers.get('X-Location-Helper'),'1');
  }
});

test('actual panel fetch path connects, saves London and stops through the control API',async()=>{
  const helper=backend(); const node=await mount(controlFetch(helper));
  assert.equal(node('control').textContent,'已连接'); assert.equal(node('save').disabled,false);
  assert.equal(node('longitude').value,DEFAULT.longitude);
  node('locationForm').events.submit({preventDefault(){}}); await settle();
  assert.equal(helper.config().enabled,true); assert.equal(node('enabled').textContent,'已开启');
  await node('stop').onclick(); await settle();
  assert.equal(helper.config().enabled,false); assert.equal(node('enabled').textContent,'已关闭');
});

test('screenshot-like valid state with HTTP failure stays disabled and shows exact status',async()=>{
  const helper=backend();
  const node=await mount(async()=>new Response(JSON.stringify(helper.state()),{status:500,headers:{'X-Location-Helper':'1'}}));
  assert.equal(node('control').textContent,'未连接'); assert.equal(node('save').disabled,true);
  assert.match(node('message').textContent,/HTTP 500/); assert.match(node('message').textContent,/HTTP 状态格式/);
});

test('untagged JSON from old script or upstream is not accepted as local API success',async()=>{
  const node=await mount(async()=>new Response(JSON.stringify(backend().state()),{status:200}));
  assert.equal(node('save').disabled,true); assert.match(node('message').textContent,/缺少本项目响应标识.*HTTP 200/);
});

test('non-JSON HTTP response is diagnosed without displaying upstream body',async()=>{
  const node=await mount(async()=>new Response('<html>private upstream error</html>',{status:404}));
  assert.equal(node('save').disabled,true); assert.match(node('message').textContent,/非 JSON.*HTTP 404/);
  assert.equal(node('message').textContent.includes('private upstream'),false);
});

test('network errors keep controls disabled',async()=>{
  const node=await mount(async()=>{throw new TypeError('Failed to fetch');});
  assert.equal(node('save').disabled,true); assert.match(node('message').textContent,/Failed to fetch/);
});

test('HTTP page gives explicit HTTPS guidance and never sends coordinates',async()=>{
  let calls=0;const node=await mount(async()=>{calls++;return new Response('{}');},'http:');
  assert.equal(calls,0);assert.equal(node('save').disabled,true);
  assert.equal(node('status').textContent,'请使用 HTTPS 控制面板');
});

test('successful retry clears obsolete error message',async()=>{
  const realFetch=controlFetch(backend());let first=true;
  const node=await mount(async(...args)=>{if(first){first=false;return new Response('{}',{status:502,headers:{'X-Location-Helper':'1'}});}return realFetch(...args);});
  assert.match(node('message').textContent,/HTTP 502/);
  await node('refresh').onclick();await settle();
  assert.equal(node('control').textContent,'已连接');assert.equal(node('message').textContent,'');assert.equal(node('message').className,'');
});
