// Shadowrocket Location Helper 0.1.1 — AGPL-3.0
// Source: https://raw.githubusercontent.com/albertguoanrui-eng/ios-location-helper/main/module/source.zip
(function(){
const lib=(function(){var module={exports:{}};
'use strict';

const PREFIX = 'location_helper_v1';
const HOSTS = ['gs-loc.apple.com', 'gs-loc-cn.apple.com', 'gsp-ssl.ls.apple.com', 'bluedot.is.autonavi.com', 'bluedot.is.autonavi.com.gds.alibabadns.com'];
const ORIGIN = 'https://gs-loc.apple.com';
const PANEL_PATH = '/wloc-helper/';
const DEFAULT = Object.freeze({ enabled: false, latitude: 51.5074, longitude: -0.1278, accuracy: 25, revision: 'initial' });

function numeric(value, name, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(name + '超出范围');
  }
  return value;
}

function validate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.enabled !== 'boolean') throw new Error('配置格式错误');
  if (!Number.isInteger(input.accuracy)) throw new Error('精度必须为整数');
  return {
    enabled: input.enabled,
    latitude: numeric(input.latitude, '纬度', -90, 90),
    longitude: numeric(input.longitude, '经度', -180, 180),
    accuracy: numeric(input.accuracy, '精度', 1, 10000)
  };
}

function parseUrl(value) {
  // Shadowrocket does not guarantee the browser URL API in script runtimes.
  const match = /^https?:\/\/([^/?#:]+)(?::\d+)?([^?#]*)(?:\?[^#]*)?$/.exec(value || '');
  return match ? { host: match[1].toLowerCase(), path: match[2] || '/' } : null;
}

function header(headers, name) {
  const key = Object.keys(headers || {}).find(k => k.toLowerCase() === name.toLowerCase());
  return key ? String(headers[key]) : '';
}

function strippedHeaders(headers, names) {
  const out = {};
  for (const key of Object.keys(headers || {})) if (!names.includes(key.toLowerCase())) out[key] = headers[key];
  return out;
}

function createHelper(store, now = () => Date.now()) {
  function read(key, fallback) {
    try { const raw = store.read(PREFIX + ':' + key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
  }
  function write(key, value) {
    if (store.write(JSON.stringify(value), PREFIX + ':' + key) === false) throw new Error('设备存储写入失败');
  }
  function config() {
    const value = read('config', null);
    if (!value) return { ...DEFAULT };
    try {
      const checked = validate(value);
      if (typeof value.revision !== 'string' || value.revision.length > 100) throw new Error('invalid revision');
      return { ...checked, revision: value.revision };
    } catch { return { ...DEFAULT, revision: 'invalid-storage' }; }
  }
  function save(input) {
    const checked = validate(input);
    const value = { ...checked, revision: now() + '-' + Math.random().toString(36).slice(2) };
    write('config', value);
    return value;
  }
  function record(kind, data, revision) {
    // Last request and response use separate keys; diagnostics never overwrite configuration.
    write(kind, { ...data, at: now(), revision });
  }
  function state() {
    const selected = config();
    const current = key => {
      const value = read(key, null);
      return value && value.revision === selected.revision ? value : null;
    };
    const request = current('request'), response = current('response');
    let stage = selected.enabled ? 'waiting' : 'disabled';
    if (selected.enabled && request) stage = 'request-seen';
    if (selected.enabled && response) stage = response.result;
    return { protocol: 1, version: '0.1.1', config: selected, request, response, stage,
      systemLocationVerified: false };
  }
  function report() {
    const s = state();
    // Explicit allow-list: no coordinates, arbitrary error strings, query, body, IP, or headers.
    const event = value => value ? {
      at: value.at, host: value.host, result: value.result,
      wifiCount: value.wifiCount, cellCount: value.cellCount
    } : null;
    return { protocol: 1, version: s.version, enabled: s.config.enabled,
      stage: s.stage, request: event(s.request), response: event(s.response),
      systemLocationVerified: false };
  }
  function observe(request) {
    const url = parseUrl(request.url);
    if (!url || !HOSTS.includes(url.host) || url.path !== '/clls/wloc') return {};
    const selected = config();
    record('request', { host: url.host, result: 'request-seen' }, selected.revision);
    if (!selected.enabled) return {};
    return { headers: { ...strippedHeaders(request.headers, ['accept-encoding']), 'Accept-Encoding': 'identity' } };
  }
  function rewrite(request, response, engine) {
    const url = parseUrl(request.url);
    if (!url || !HOSTS.includes(url.host) || url.path !== '/clls/wloc') return {};
    const selected = config();
    const finish = (result, extra = {}) => record('response', { host: url.host, result, ...extra }, selected.revision);
    if (!selected.enabled) { finish('disabled'); return {}; }
    const status = response.statusCode || response.status || 200;
    if (!/^200(?:\s|$)/.test(String(status)) && status !== 'HTTP/1.1 200 OK') { finish('http-error'); return {}; }
    const encoding = header(response.headers, 'content-encoding').toLowerCase();
    if (encoding && encoding !== 'identity') { finish('compressed-response'); return {}; }
    try {
      const bytes = engine.messageBodyToBytes(response);
      if (!bytes || bytes.length < 2) { finish('empty-response'); return {}; }
      // Count real coordinate pairs, not containers: upstream counts empty Wi-Fi/cell
      // containers too. Unknown framing is passed through; no raw-byte guessing.
      const extraction = engine.extractAppleWLocPayload(bytes);
      const counts = { wifiCount: 0, cellCount: 0 };
      for (const field of engine.parseFields(extraction.payload)) {
        const wifi = field.fieldNumber === 2;
        if (field.wireType !== 2 || (!wifi && ![22, 24].includes(field.fieldNumber))) continue;
        for (const location of engine.parseFields(field.valueBytes)) {
          if (location.fieldNumber !== (wifi ? 2 : 5) || location.wireType !== 2) continue;
          const fields = engine.parseFields(location.valueBytes);
          if ([1, 2].every(n => fields.some(f => f.fieldNumber === n && f.wireType === 0))) counts[wifi ? 'wifiCount' : 'cellCount']++;
        }
      }
      if (!counts.wifiCount && !counts.cellCount) { finish('no-location-fields'); return {}; }
      const result = engine.spoofAppleResponse(bytes, engine.normalizeConfig({
        ...engine.DEFAULT_CONFIG, latitude: selected.latitude, longitude: selected.longitude,
        horizontalAccuracy: selected.accuracy, debug: false, failOpen: true
      }));
      if (!result.wifiCount && !result.cellCount) { finish('no-location-fields'); return {}; }
      finish('patched', counts);
      // Upstream adds a synthetic envelope for bare protobuf; retain the original
      // bare framing here. Invalidate transport metadata for the replaced bytes.
      return { headers: strippedHeaders(response.headers, ['content-length', 'content-encoding', 'etag', 'content-md5', 'digest']),
        body: extraction.kind === 'bare' ? result.payload : result.response };
    } catch { finish('parse-error'); return {}; }
  }
  function handle(request, html) {
    const url = parseUrl(request.url);
    if (!url || url.host !== 'gs-loc.apple.com' || !url.path.startsWith(PANEL_PATH)) return null;
    const path = url.path.slice(PANEL_PATH.length);
    const method = (request.method || 'GET').toUpperCase();
    function reply(code, body, type = 'application/json; charset=utf-8') {
      return { response: { status: code, headers: {
        'X-Location-Helper': '1', 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
      }, body: typeof body === 'string' ? body : JSON.stringify(body) } };
    }
    if (method === 'GET' && path === '') return reply(200, html, 'text/html; charset=utf-8');
    if (method === 'GET' && path === 'api/state') return reply(200, state());
    if (method === 'GET' && path === 'api/report') return reply(200, report());
    if (method !== 'POST') return reply(405, { error: '不支持此操作' });
    // Browser cross-origin requests cannot supply this custom header without a preflight;
    // OPTIONS is rejected, and no CORS permissions are issued. Also check Origin when present.
    if (header(request.headers, 'x-location-helper') !== '1' ||
        (header(request.headers, 'origin') && header(request.headers, 'origin') !== ORIGIN) ||
        !/^application\/json(?:;|$)/i.test(header(request.headers, 'content-type'))) {
      return reply(403, { error: '请从设备本地面板操作' });
    }
    try {
      if (path === 'api/config') {
        if (typeof request.body !== 'string' || request.body.length > 1024) throw new Error('配置内容不正确');
        save(JSON.parse(request.body));
      } else if (path === 'api/stop') {
        save({ ...config(), enabled: false });
      } else return reply(404, { error: '操作不存在' });
      return reply(200, state());
    } catch (e) { return reply(400, { error: e instanceof SyntaxError ? '配置格式错误' : e.message }); }
  }
  return { config, save, state, report, observe, rewrite, handle };
}

module.exports = { createHelper, validate, parseUrl, HOSTS, ORIGIN, PANEL_PATH, DEFAULT };

return module.exports;})();
const helper=lib.createHelper($persistentStore);
try{$done(helper.handle($request,"<!doctype html>\n<html lang=\"zh-CN\">\n<head>\n<meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1,viewport-fit=cover\">\n<meta name=\"color-scheme\" content=\"light\"><title>定位助手 · Shadowrocket</title>\n<style>\n:root{font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;color:#172b40;background:#edf2f7;font-size:16px;--blue:#145de3;--line:#dce4ee}*{box-sizing:border-box}body{margin:0}main{max-width:760px;margin:auto;padding:24px 18px 40px;padding-bottom:max(40px,env(safe-area-inset-bottom))}header{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px}h1{font-size:26px;letter-spacing:-1px;margin:0}h2{font-size:18px;margin:0 0 16px}p{line-height:1.65;margin:8px 0}.eyebrow{font-size:12px;letter-spacing:1.6px;color:#52708e;margin:0 0 5px}.version{font-size:13px;border:1px solid var(--line);padding:6px 10px;border-radius:20px;background:white}.card{background:#fff;border:1px solid var(--line);border-radius:20px;padding:20px;margin:14px 0}.status{background:#102b4e;color:#fff;border:0}.status-top{display:flex;align-items:center;gap:10px}.dot{width:10px;height:10px;border-radius:50%;background:#ffc56d;flex:none}.status p{color:#c1d0e2;font-size:14px}.status strong{font-size:19px}.warning{background:#fff6e4;border:1px solid #ebd5a5;color:#694609;border-radius:12px;padding:12px 14px;font-size:14px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}label{display:block;font-size:14px;font-weight:600;color:#486078}input{width:100%;padding:13px 12px;margin:8px 0 0;border:1px solid #b9c9db;border-radius:10px;font:inherit;color:#172b40;background:#f9fbfd;min-height:48px}input:focus{outline:3px solid #c6dbff;border-color:var(--blue)}button,.button{font:inherit;font-weight:600;border:0;border-radius:11px;padding:13px 16px;cursor:pointer;min-height:48px;text-align:center;background:#eaf0f8;color:#234361;text-decoration:none;display:inline-block}button:focus-visible,a:focus-visible{outline:3px solid #78a9ff;outline-offset:3px}button:disabled{opacity:.45;cursor:not-allowed}.primary{background:var(--blue);color:white}.danger{background:#fff0f0;color:#a62c38}.actions{display:flex;gap:10px;margin-top:16px;flex-wrap:wrap}.actions>*{flex:1}.small{font-size:14px;color:#58718c}.preset{font-size:14px;background:#e9f0ff;color:#164fb1;margin:0 0 18px;padding:8px 12px;min-height:40px}.row{display:flex;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid #edf1f6;font-size:14px;align-items:center}.row:last-child{border:0}.row span{color:#58718c}.row strong{text-align:right;font-size:14px;overflow-wrap:anywhere}details{margin-top:16px}summary{cursor:pointer;font-weight:600;font-size:14px;line-height:1.5}ol{padding-left:23px;font-size:14px;line-height:1.9}code{font-size:13px;overflow-wrap:anywhere}a{color:#145de3}footer{color:#657b92;font-size:13px;text-align:center;margin-top:22px}#message{min-height:24px;font-size:14px;line-height:1.6;color:#176547}#message.error{color:#a62c38}#install{display:none}.copy-text{width:100%;min-height:110px;font:13px ui-monospace,monospace;line-height:1.6;border:1px solid var(--line);border-radius:8px;padding:10px;margin-top:12px}#reportBox{display:none}.note{font-size:14px;color:#a62c38}#stageHelp{margin-top:12px}@media(max-width:390px){main{padding:18px 12px}.card{padding:16px}.actions{flex-direction:column}h1{font-size:24px}}@media(min-width:680px){.workspace{display:grid;grid-template-columns:1.1fr 1fr;gap:16px;align-items:start}.workspace .card{margin-top:0}header{margin-bottom:24px}}\n</style></head>\n<body><main>\n<header><div><p class=\"eyebrow\">SHADOWROCKET / LOCAL</p><h1>定位助手</h1></div><span class=\"version\">0.1.1</span></header>\n<section class=\"card status\" aria-live=\"polite\"><div class=\"status-top\"><i class=\"dot\" id=\"dot\"></i><strong id=\"status\">正在连接本机模块…</strong></div><p id=\"statusText\">读取保存在 Shadowrocket 中的设置。</p></section>\n<p class=\"warning\">iOS 27.0 RC 尚未验证可用。此模块依赖系统的 WLOC 请求；系统不发送请求或拒绝解密时，无法靠保存坐标改变位置。</p>\n<section class=\"card\" id=\"install\"><h2>先在小火箭中导入模块</h2><p class=\"small\">这里是安装与界面预览。真正的设置面板由手机上的 Shadowrocket 返回。</p><div class=\"actions\"><a class=\"button primary\" id=\"moduleLink\" href=\"https://raw.githubusercontent.com/albertguoanrui-eng/ios-location-helper/main/module/location-helper.sgmodule\">下载模块</a><button id=\"copyModule\" type=\"button\">复制模块地址</button></div><ol><li>在 Shadowrocket → 配置 → 模块中导入上方地址。如地址为局域网 IP，手机需连接同一局域网。</li><li>开启 HTTPS 解密，安装并完全信任小火箭证书。模块只追加所需的 5 个定位域名。</li><li>启用此模块，停用其他定位模块，再打开下方设备面板。</li></ol><a href=\"https://gs-loc.apple.com/wloc-helper/\">打开手机本地控制面板 ↗</a><p class=\"small\" id=\"installHint\">首次导入需要脚本文件可下载；导入、执行及离线缓存行为仍需手机实测。</p></section>\n<div class=\"workspace\"><section class=\"card\"><h2>目标位置</h2><button class=\"preset\" id=\"london\" type=\"button\">↗ 伦敦市中心</button><form id=\"locationForm\"><div class=\"grid\"><label for=\"latitude\">纬度 · Latitude<input id=\"latitude\" name=\"latitude\" type=\"number\" inputmode=\"decimal\" min=\"-90\" max=\"90\" step=\"any\" required value=\"51.5074\"></label><label for=\"longitude\">经度 · Longitude<input id=\"longitude\" name=\"longitude\" type=\"number\" inputmode=\"decimal\" min=\"-180\" max=\"180\" step=\"any\" required value=\"-0.1278\"></label></div><label for=\"accuracy\" style=\"margin-top:14px\">水平精度（米）<input id=\"accuracy\" name=\"accuracy\" type=\"number\" inputmode=\"decimal\" min=\"1\" max=\"10000\" step=\"1\" required value=\"25\"></label><p class=\"small\">使用 WGS-84 坐标。伦敦经度的负号表示西经。</p><div class=\"actions\"><button class=\"primary\" type=\"submit\" id=\"save\" disabled>保存并开启改写</button><button class=\"danger\" type=\"button\" id=\"stop\" disabled>停止改写</button></div></form><p id=\"message\" role=\"status\" aria-live=\"polite\"></p><p class=\"small\">停止后不再改写新响应，系统已有位置缓存可能仍需刷新。请打开苹果地图确认恢复。</p></section>\n<section class=\"card\"><h2>这次设置的诊断</h2><div class=\"row\"><span>本机控制接口</span><strong id=\"control\">未连接</strong></div><div class=\"row\"><span>坐标改写开关</span><strong id=\"enabled\">未知</strong></div><div class=\"row\"><span>收到 WLOC 请求</span><strong id=\"requestAt\">尚未观测</strong></div><div class=\"row\"><span>收到 WLOC 响应</span><strong id=\"responseAt\">尚未观测</strong></div><div class=\"row\"><span>改写结果</span><strong id=\"patchResult\">尚未执行</strong></div><div class=\"row\"><span>苹果地图实际位置</span><strong>需要你在手机确认</strong></div><p class=\"small\" id=\"stageHelp\">控制面板连通不等于系统定位已改变。</p><div class=\"actions\"><button type=\"button\" id=\"refresh\">刷新诊断</button><button type=\"button\" id=\"export\" disabled>复制诊断</button></div><textarea id=\"reportBox\" class=\"copy-text\" readonly aria-label=\"脱敏诊断，可手动复制\"></textarea><details><summary>没有变化时，怎样判断？</summary><ol><li>先确认开关已开启，再打开苹果地图，点击定位箭头。</li><li>一直没有请求：可能是缓存、规则未命中或系统不再使用该接口，单凭本面板不能区分。</li><li>有请求、无响应：查看小火箭连接日志中的 TLS / MITM 错误。</li><li>响应已改写但蓝点未变：系统可能未采用网络定位结果。模块不会把它标为“生效”。</li></ol></details></section></div>\n<footer>设置与诊断保存在手机的小火箭中 · <a id=\"sourceLink\" href=\"https://raw.githubusercontent.com/albertguoanrui-eng/ios-location-helper/main/module/source.zip\">完整源码 / AGPL-3.0</a></footer>\n</main><script>\n(() => {\n  'use strict';\n  const $ = id => document.getElementById(id);\n  const target = location.hostname === 'gs-loc.apple.com' && location.pathname.startsWith('/wloc-helper/');\n  const live = target && location.protocol === 'https:';\n  const base = '/wloc-helper/api/';\n  let connected = false, busy = false, loaded = false;\n  const labels = { disabled:'改写已关闭', waiting:'设置已保存，等待定位请求', 'request-seen':'已收到请求，等待响应', patched:'响应已改写，等待手机验证', 'parse-error':'收到响应，但解析失败', 'http-error':'定位服务返回异常', 'compressed-response':'响应仍被压缩，未改写', 'empty-response':'收到空响应，未改写', 'no-location-fields':'响应中没有可改写坐标' };\n  const tips = { disabled:'现在会放行真实响应。已有定位缓存不会被模块直接清除。', waiting:'请打开苹果地图触发定位，然后刷新诊断。', 'request-seen':'请求规则已执行；如一直没有响应，请查看小火箭 TLS / MITM 日志。', patched:'这里只确认二进制响应已修改。请切到苹果地图确认蓝点是否在目标位置。', 'parse-error':'响应格式可能变化。已保留原始响应，复制诊断以便排查。', 'compressed-response':'请求已尝试协商非压缩响应。此响应仍压缩，已保持原样。' };\n  function message(text, error = false) { $('message').textContent = text; $('message').className = error ? 'error' : ''; }\n  function buttons() { $('save').disabled = !connected || busy; $('stop').disabled = !connected || busy; $('export').disabled = !connected || busy; $('refresh').disabled = busy; }\n  async function api(path, body) {\n    if (!live) throw new Error('请先导入模块，再打开手机本地控制面板。');\n    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 6000);\n    try {\n      const response = await fetch(base + path, { cache:'no-store', signal:controller.signal,\n        ...(body === undefined ? {} : { method:'POST', headers:{'Content-Type':'application/json','X-Location-Helper':'1'}, body:JSON.stringify(body) }) });\n      const status = response.status;\n      const ownResponse = response.headers.get('X-Location-Helper') === '1';\n      const text = await response.text();\n      let result;\n      try { result = JSON.parse(text); } catch { throw new Error(`接口 ${path} 返回非 JSON（HTTP ${status}）；请检查面板脚本是否命中。`); }\n      if (!ownResponse) throw new Error(`接口 ${path} 缺少本项目响应标识（HTTP ${status}）；可能未命中规则或仍在使用旧脚本。`);\n      if (!response.ok) {\n        const detail = typeof result?.error === 'string' ? result.error.slice(0,160) : '请检查脚本返回的 HTTP 状态格式';\n        throw new Error(`接口 ${path} 返回 HTTP ${status}：${detail}`);\n      }\n      return result;\n    } finally { clearTimeout(timer); }\n  }\n  function time(value) { return value ? new Date(value).toLocaleTimeString('zh-CN', { hour12:false }) : '尚未观测'; }\n  function render(s, fill) {\n    if (s.protocol !== 1 || !s.config || !Object.hasOwn(labels, s.stage)) throw new Error('模块接口不兼容，请重新导入本项目模块。');\n    message('');\n    connected = true; $('control').textContent = '已连接'; $('enabled').textContent = s.config.enabled ? '已开启' : '已关闭';\n    $('status').textContent = labels[s.stage]; $('statusText').textContent = tips[s.stage] || '响应保持原样。可复制诊断继续排查。';\n    $('requestAt').textContent = time(s.request?.at); $('responseAt').textContent = time(s.response?.at);\n    $('patchResult').textContent = s.stage === 'patched' ? `Wi-Fi ${s.response.wifiCount} / 基站 ${s.response.cellCount}` : labels[s.stage];\n    $('stageHelp').textContent = '只显示当前设置的记录。修改坐标后，旧记录不会被当作新的成功证据。';\n    $('dot').style.background = s.stage === 'patched' ? '#77baff' : '#ffc56d';\n    if (fill) ['latitude','longitude','accuracy'].forEach(key => $(key).value = s.config[key]);\n    buttons();\n  }\n  function disconnected(error) {\n    connected = false; $('control').textContent = '未连接'; $('enabled').textContent = '未知';\n    $('requestAt').textContent = '连接后确认'; $('responseAt').textContent = '连接后确认'; $('patchResult').textContent = '未知';\n    $('status').textContent = live ? '无法连接本机模块' : '预览模式 · 尚未连接手机';\n    $('statusText').textContent = live ? '页面已加载，但控制接口未通过校验。请查看下方具体错误；这一步尚未验证系统定位。' : '在这里查看界面和获取模块，手机位置不会改变。';\n    if (target && !live) { $('status').textContent = '请使用 HTTPS 控制面板'; $('statusText').textContent = '当前页面不是 HTTPS，请打开 https://gs-loc.apple.com/wloc-helper/'; }\n    if (error) message(error.name === 'AbortError' ? '本机接口超时，请检查脚本下载与小火箭连接。' : error.message, true);\n    buttons();\n  }\n  async function refresh() { if (busy) return; busy = true; buttons(); try { render(await api('state'), !loaded); loaded = true; } catch(e) { disconnected(e); } finally { busy = false; buttons(); } }\n  async function mutate(path, body) { if (busy) return; busy = true; buttons(); try { render(await api(path, body), true); message(path === 'stop' ? '已关闭新响应改写。请到苹果地图确认真实位置恢复。' : '坐标已保存。等待系统请求，尚不能确认定位生效。'); } catch(e) { disconnected(e); } finally { busy = false; buttons(); } }\n  $('locationForm').addEventListener('submit', e => { e.preventDefault(); if (!connected || !$('locationForm').reportValidity()) return; mutate('config', { enabled:true, latitude:Number($('latitude').value), longitude:Number($('longitude').value), accuracy:Number($('accuracy').value) }); });\n  $('stop').onclick = () => mutate('stop', {});\n  $('london').onclick = () => { $('latitude').value = 51.5074; $('longitude').value = -0.1278; message('已填入伦敦坐标，点击保存后才会提交。'); };\n  $('refresh').onclick = refresh;\n  $('export').onclick = async () => { try { const text = JSON.stringify(await api('report'), null, 2); $('reportBox').style.display = 'block'; $('reportBox').value = text; try { await navigator.clipboard.writeText(text); message('诊断已复制，不含坐标、请求正文或配对信息。'); } catch { $('reportBox').focus(); $('reportBox').select(); message('请长按文本框，手动复制诊断。'); } } catch(e) { message(e.message, true); } };\n  $('copyModule').onclick = async () => { const link = $('moduleLink').href; try { await navigator.clipboard.writeText(link); message('模块地址已复制。'); } catch { $('reportBox').style.display = 'block'; $('reportBox').value = link; $('reportBox').select(); message('请手动复制下方模块地址。'); } };\n  if (!live) { if (!target) $('install').style.display = 'block'; disconnected(); } else refresh();\n  window.addEventListener('pageshow', () => { if (live) refresh(); });\n})();\n</script></body></html>\n") || {});}catch(e){$done({response:{status:500,headers:{'X-Location-Helper':'1','Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify({error:'模块存储或控制接口错误'})}});}
})();
