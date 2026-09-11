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
  const match = /^(https?):\/\/([^/?#:@]+)(?::(\d+))?([^?#]*)(?:\?[^#]*)?$/.exec(value || '');
  if (!match || (match[3] && match[3] !== (match[1] === 'https' ? '443' : '80'))) return null;
  return { host: match[2].toLowerCase(), path: match[4] || '/' };
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
    return { protocol: 1, version: '0.1.3', config: selected, request, response, stage,
      systemLocationVerified: false, experiments: experiments() };
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
      systemLocationVerified: false, experiments: experiments() };
  }
  function experiments() {
    const probe = read('probe', null);
    const runtime = [];
    for (const adapter of ['panel', 'observe', 'rewrite']) for (const source of ['control', 'probe', 'wloc', 'other']) {
      const value = read('runtime:' + adapter + ':' + source, null);
      if (value && value.version === '0.1.3' && ['entered', 'completed', 'failed'].includes(value.status)) {
        runtime.push({ adapter, source, at: value.at, status: value.status,
          error: ['Error', 'TypeError', 'ReferenceError', 'SyntaxError', 'RangeError'].includes(value.error) ? value.error : undefined });
      }
    }
    return { probe: probe && probe.version === '0.1.3' ? {
      version: probe.version, at: probe.at, storage: probe.storage === true,
      binaryRewrite: probe.binaryRewrite === true, systemLocationVerified: false
    } : null, runtime };
  }
  function isProbe(request) {
    const url = parseUrl(request.url);
    return !!url && url.host === 'gs-loc-cn.apple.com' && url.path === '/wloc-helper-probe/';
  }
  function probe(request, engine) {
    if (!isProbe(request)) return null;
    if ((request.method || 'GET').toUpperCase() !== 'GET') return { response: { status: 405, body: 'GET only' } };
    const result = { version: '0.1.3', at: now(), storage: false, binaryRewrite: false, systemLocationVerified: false };
    try {
      const token = now() + '-' + Math.random();
      write('probe-roundtrip', token);
      result.storage = read('probe-roundtrip', null) === token;
    } catch { /* Return a visible failure even if diagnostic persistence is unavailable. */ }
    try {
      // Synthetic fixture and isolated storage: never changes the user's selection or WLOC records.
      const data = {};
      const isolated = createHelper({ read: key => data[key], write: (value, key) => { data[key] = value; return true; } }, now);
      isolated.save({ ...DEFAULT, enabled: true });
      const v = engine.makeVarintField, m = engine.makeLengthDelimitedField, concat = engine.concatBytes;
      const location = concat([v(1, 100000000), v(2, 200000000), v(3, 39)]);
      const fixture = engine.buildAppleWLocResponse(m(2, m(2, location)));
      const changed = isolated.rewrite({ url: 'https://gs-loc-cn.apple.com:443/clls/wloc' }, { status: 200, body: fixture }, engine);
      const payload = engine.extractAppleWLocPayload(changed.body).payload;
      const root = engine.parseFields(payload).find(f => f.fieldNumber === 2);
      const loc = engine.parseFields(root.valueBytes).find(f => f.fieldNumber === 2);
      result.binaryRewrite = isolated.state().stage === 'patched' && engine.locationSummary(loc.valueBytes) === '51.50740000,-0.12780000';
    } catch { /* Keep failure explicit; never echo packet data or exception messages. */ }
    try { write('probe', result); } catch { result.storage = false; }
    const json = JSON.stringify(result, null, 2);
    return { response: { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
      'X-Location-Helper': '1', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'" },
      body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>定位助手自检</title><main style="font:18px system-ui;padding:20px;line-height:1.6"><h1>本机实验自检</h1><p>中国区域名上的请求脚本已执行。下面仅为人工测试，不代表系统定位成功。</p><pre style="white-space:pre-wrap">' + json + '</pre><p>storage：存储读写；binaryRewrite：合成数据改写。true 为通过，false 为未通过。</p><a href="https://gs-loc.apple.com/wloc-helper/?v=0.1.3">返回面板并刷新诊断</a></main>' } };
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
    if (method === 'GET' && path === '') {
      // Escape HTML delimiters before embedding stored data in a non-executable JSON block.
      const snapshot = JSON.stringify(state()).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
      const page = html.replace('<script id="initialState" type="application/json">null</script>',
        () => '<script id="initialState" type="application/json">' + snapshot + '</script>');
      return reply(200, page, 'text/html; charset=utf-8');
    }
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
  return { config, save, state, report, observe, rewrite, handle, isProbe, probe };
}

module.exports = { createHelper, validate, parseUrl, HOSTS, ORIGIN, PANEL_PATH, DEFAULT };
