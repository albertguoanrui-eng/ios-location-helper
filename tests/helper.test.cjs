'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHelper, validate, DEFAULT, HOSTS, ORIGIN, PANEL_PATH } = require('../src/core.cjs');
const engine = require('../vendor/location-spoofer.cjs');
const { readFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function setup() {
  const values = new Map();
  const store = { read: k => values.get(k), write: (v,k) => { values.set(k,v); return true; } };
  const helper = createHelper(store, () => 1700000000000);
  return { values, store, helper };
}
function active() { const ctx = setup(); ctx.helper.save({ ...DEFAULT, enabled:true }); return ctx; }
const request = { url:ORIGIN + '/clls/wloc', method:'POST', headers:{'Accept-Encoding':'gzip',Authorization:'private'} };
const concat = engine.concatBytes, v = engine.makeVarintField, m = engine.makeLengthDelimitedField;
function payload(withCoordinates = true) {
  const loc = concat(withCoordinates ? [v(1,100000000),v(2,200000000),v(3,39),v(4,777)] : [v(3,39)]);
  return concat([m(2,concat([m(1,new Uint8Array([1,2,3])),m(2,loc)])),m(22,m(5,loc)),m(24,m(5,loc)),v(31,991)]);
}
function response(body = engine.buildAppleWLocResponse(payload())) {
  return { status:200, headers:{'Content-Type':'application/octet-stream','Content-Length':'100','ETag':'test'}, body };
}
const post = (name, body, headers = {}) => ({url:ORIGIN+PANEL_PATH+'api/'+name,method:'POST',headers:{'Content-Type':'application/json','X-Location-Helper':'1',Origin:ORIGIN,...headers},body:JSON.stringify(body)});
const json = result => JSON.parse(result.response.body);

test('new and corrupt storage default to disabled; stopping persists across script instances', () => {
  const {helper,store,values} = setup();
  assert.equal(helper.state().stage,'disabled');
  values.set('location_helper_v1:config','{bad');
  assert.equal(helper.config().enabled,false);
  helper.save({...DEFAULT,enabled:true});
  assert.equal(createHelper(store).config().enabled,true);
  assert.equal(json(helper.handle(post('stop',{}),'')).stage,'disabled');
  assert.equal(createHelper(store).config().enabled,false);
});

test('strict finite coordinates, integer precision and boolean enable flag', () => {
  for (const changes of [{latitude:91},{longitude:-181},{latitude:NaN},{longitude:Infinity},{latitude:'51'},{accuracy:0},{accuracy:1.5},{enabled:'true'}]) assert.throws(() => validate({...DEFAULT,...changes}));
  assert.equal(validate({...DEFAULT,longitude:-180,latitude:90}).latitude,90);
});

test('control panel returns local HTML and JSON state without CORS', () => {
  const {helper} = setup();
  const page = helper.handle({url:ORIGIN+PANEL_PATH},'<html>local</html>');
  assert.equal(page.response.body,'<html>local</html>');
  assert.equal(page.response.headers['Cache-Control'],'no-store');
  assert.equal(page.response.headers['Access-Control-Allow-Origin'],undefined);
  assert.equal(json(helper.handle({url:ORIGIN+PANEL_PATH+'api/state'},'')).config.enabled,false);
  assert.equal(helper.handle({url:'https://other.example/wloc-helper/'},''),null);
});

test('control mutations reject cross-origin, simple requests, invalid bodies and preflights', () => {
  const {helper} = setup();
  for (const headers of [{Origin:'https://evil.example'},{'X-Location-Helper':''},{'Content-Type':'text/plain'}]) assert.equal(helper.handle(post('config',{...DEFAULT,enabled:true},headers),'').response.status,403);
  assert.equal(helper.handle({...post('config',{}),method:'OPTIONS'},'').response.status,405);
  assert.equal(helper.handle({...post('config',{}),body:'{bad'},'').response.status,400);
  assert.equal(helper.handle({...post('config',{}),body:' '.repeat(1025)},'').response.status,400);
  assert.equal(helper.config().enabled,false);
});

test('failed storage writes cannot report successful configuration', () => {
  const helper = createHelper({ read:()=>null, write:()=>false });
  assert.equal(helper.handle(post('config',{...DEFAULT,enabled:true}),'').response.status,400);
});

test('only five exact WLOC hosts and path are observed; disabled requests are unchanged', () => {
  const {helper} = setup();
  assert.deepEqual(helper.observe(request),{});
  helper.save({...DEFAULT,enabled:true});
  for (const host of HOSTS) assert.equal(helper.observe({...request,url:'https://'+host+'/clls/wloc?x=1'}).headers['Accept-Encoding'],'identity');
  for (const url of ['https://gs-loc.apple.com.evil.example/clls/wloc','https://example.com/clls/wloc',ORIGIN+'/clls/wloc/other',ORIGIN+'/other']) assert.deepEqual(helper.observe({...request,url}),{});
  assert.equal(helper.observe(request).headers.Authorization,'private');
});

test('protobuf fixture rewrites London including negative longitude; preserves other fields', () => {
  const {helper} = active();
  helper.observe(request);
  const result = helper.rewrite(request,response(),engine);
  assert.ok(result.body instanceof Uint8Array);
  const decoded = engine.extractAppleWLocPayload(result.body);
  const roots = engine.parseFields(decoded.payload);
  assert.deepEqual(Array.from(roots.find(f=>f.fieldNumber===31).raw),Array.from(v(31,991)));
  for (const f of roots.filter(f=>[2,22,24].includes(f.fieldNumber))) {
    const loc = engine.parseFields(f.valueBytes).find(x=>x.fieldNumber===(f.fieldNumber===2?2:5));
    assert.equal(engine.locationSummary(loc.valueBytes),'51.50740000,-0.12780000');
    const fields = engine.parseFields(loc.valueBytes);
    assert.deepEqual(Array.from(fields.find(f=>f.fieldNumber===3).raw),Array.from(v(3,25)));
    assert.deepEqual(Array.from(fields.find(f=>f.fieldNumber===4).raw),Array.from(v(4,777)));
  }
  assert.equal(result.headers['Content-Length'],undefined);
  assert.equal(result.headers['Content-Type'],'application/octet-stream');
  assert.equal(helper.state().stage,'patched');
  assert.equal(helper.state().response.wifiCount,1);
  assert.equal(helper.state().response.cellCount,2);
  assert.equal(helper.state().systemLocationVerified,false);
});

test('empty location containers do not create a false patched result', () => {
  const {helper} = active();
  assert.deepEqual(helper.rewrite(request,response(engine.buildAppleWLocResponse(payload(false))),engine),{});
  assert.equal(helper.state().stage,'no-location-fields');
});

test('ARPC and bare protobuf fixtures preserve framing and rewrite coordinates', () => {
  const arpc = { version:1, locale:'en_GB', appIdentifier:'test.fixture', osVersion:'fixture', functionId:1, payload:payload() };
  for (const [body,kind] of [[engine.serializeArpc(arpc),'arpc'],[payload(),'bare']]) {
    const {helper} = active();
    const output = helper.rewrite(request,response(body),engine);
    const decoded = engine.extractAppleWLocPayload(output.body);
    assert.equal(decoded.kind,kind);
    assert.match(engine.patchedPayloadSummary(decoded.payload),/51\.50740000,-0\.12780000/);
    if (kind === 'arpc') assert.equal(decoded.arpc.appIdentifier,arpc.appIdentifier);
  }
});

for (const [name, input, stage] of [
  ['compressed',{...response(),headers:{'Content-Encoding':'gzip'}},'compressed-response'],
  ['HTTP failure',{...response(),status:503},'http-error'],
  ['empty',response(new Uint8Array()),'empty-response'],
  ['malformed',response(new Uint8Array([255,255,255])),'parse-error']
]) test(name+' responses pass through without claiming success', () => {
  const {helper} = active();
  assert.deepEqual(helper.rewrite(request,input,engine),{});
  assert.equal(helper.state().stage,stage);
});

test('new coordinates invalidate old diagnostics and stop prevents further writes to response', () => {
  const {helper} = active();
  helper.rewrite(request,response(),engine);
  helper.save({...DEFAULT,enabled:true,latitude:10});
  assert.equal(helper.state().stage,'waiting');
  assert.equal(helper.state().response,null);
  helper.handle(post('stop',{}),'');
  assert.deepEqual(helper.rewrite(request,response(),engine),{});
  assert.equal(helper.state().stage,'disabled');
});

test('exported diagnostics omit coordinates, credentials, body and URL query', () => {
  const {helper} = active();
  helper.observe({...request,url:request.url+'?secret=private',body:'private'});
  helper.rewrite(request,response(),engine);
  const report = JSON.stringify(helper.report());
  for (const secret of ['51.5074','-0.1278','latitude','longitude','Authorization','private','revision']) assert.equal(report.includes(secret),false);
  assert.equal(helper.report().systemLocationVerified,false);
});

test('built Shadowrocket adapters execute against shared storage and binary response', () => {
  execFileSync(process.execPath,['scripts/build.mjs'],{cwd:root,env:{...process.env,PUBLIC_BASE_URL:'http://127.0.0.1:4187'}});
  const {store} = setup();
  const run = (file,req,res) => {
    const results=[];
    vm.runInNewContext(readFileSync(path.join(root,'dist',file),'utf8'),{$persistentStore:store,$request:req,$response:res,$done:r=>results.push(r),Uint8Array,ArrayBuffer},{timeout:1000});
    assert.equal(results.length,1);
    return results[0];
  };
  assert.match(run('panel.js',{url:ORIGIN+PANEL_PATH}).response.body,/定位助手/);
  assert.equal(run('panel.js',{url:ORIGIN+PANEL_PATH+'api/state'}).response.status,200);
  assert.equal(json(run('panel.js',post('config',{...DEFAULT,enabled:true}))).stage,'waiting');
  assert.equal(run('observe.js',request).headers['Accept-Encoding'],'identity');
  assert.ok(run('rewrite.js',request,response()).body.length>0);
  assert.equal(json(run('panel.js',{url:ORIGIN+PANEL_PATH+'api/state'})).stage,'patched');
  assert.equal(json(run('panel.js',post('stop',{}))).stage,'disabled');
  assert.equal(Object.keys(run('rewrite.js',request,response())).length,0);
  const moduleText=readFileSync(path.join(root,'dist/location-helper.sgmodule'),'utf8');
  const patterns=[...moduleText.matchAll(/pattern=([^,\n]+)/g)].map(x=>new RegExp(x[1]));
  assert.equal(patterns.length,3);
  for (const match of moduleText.matchAll(/script-path=([^,\n]+)/g)) {
    const filename = match[1].split('/').pop();
    assert.match(filename, /^(panel|observe|rewrite)-0\.1\.1\.js$/);
    assert.ok(readFileSync(path.join(root,'dist',filename)).length>0);
  }
  for(const host of HOSTS) assert.equal(patterns[2].test('https://'+host+'/clls/wloc'),true);
  assert.equal(patterns[2].test('https://gs-loc.apple.com.evil.example/clls/wloc'),false);
  assert.equal(patterns[0].test(ORIGIN+PANEL_PATH+'api/stop'),true);
});
