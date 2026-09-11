"""Optional native JavaScriptCore check. Uses an existing Linux library; installs nothing.
This tests the real engine with mocked Shadowrocket APIs, not iOS TLS or GPS.
Run after npm run build. No device data is used.
"""
import ctypes as c
import ctypes.util
import json
from pathlib import Path

root = Path(__file__).resolve().parent.parent
library = c.util.find_library('javascriptcoregtk-4.1') or c.util.find_library('javascriptcoregtk-6.0')
if not library:
    raise SystemExit('JavaScriptCore library unavailable; check NOT performed')
js = c.CDLL(library)
def bind(name, restype, args):
    fn = getattr(js, name)
    fn.restype, fn.argtypes = restype, args
    return fn
ptr = c.c_void_p
context = bind('JSGlobalContextCreate', ptr, [ptr])(None)
string = bind('JSStringCreateWithUTF8CString', ptr, [c.c_char_p])
release = bind('JSStringRelease', None, [ptr])
evaluate = bind('JSEvaluateScript', ptr, [ptr,ptr,ptr,ptr,c.c_int,c.POINTER(ptr)])
to_string = bind('JSValueToStringCopy', ptr, [ptr,ptr,c.POINTER(ptr)])
length = bind('JSStringGetMaximumUTF8CStringSize', c.c_size_t, [ptr])
utf8 = bind('JSStringGetUTF8CString', c.c_size_t, [ptr,c.c_char_p,c.c_size_t])
bundles = {n:(root/'dist'/f'{n}.js').read_text() for n in ['panel','observe','rewrite']}
source = '''
var scripts = BUNDLES, data = {}, results = [], console = {log:function(){}};
var $persistentStore = {read:function(k){return data[k];},write:function(v,k){data[k]=v;return true;}};
var $request, $response, $done;
function assert(value,label){if(!value)throw Error(label);}
function run(name,req,res){var calls=[];$request=req;$response=res;$done=function(r){calls.push(r);};eval(scripts[name]);assert(calls.length===1,'done once '+name);return calls[0];}
var origin='https://gs-loc.apple.com';
var req={url:'https://gs-loc-cn.apple.com:443/clls/wloc',headers:{'Accept-Encoding':'gzip'}};
var post={url:origin+'/wloc-helper/api/config',method:'POST',headers:{'Content-Type':'application/json','X-Location-Helper':'1'},body:JSON.stringify({enabled:true,latitude:51.5074,longitude:-0.1278,accuracy:25})};
assert(JSON.parse(run('panel',post).response.body).stage==='waiting','save');
var probe=run('observe',{url:'https://gs-loc-cn.apple.com:443/wloc-helper-probe/'});
assert(probe.response.body.indexOf('"binaryRewrite": true')>=0,'binary selftest');
assert(probe.response.body.indexOf('"storage": true')>=0,'storage');
var state=JSON.parse(run('panel',{url:origin+'/wloc-helper/api/state'}).response.body);
assert(state.stage==='waiting' && state.request===null && state.response===null,'probe isolation');
assert(run('observe',req).headers['Accept-Encoding']==='identity','explicit port observation');
var engine=(function(){var module={exports:{}};VENDOR;return module.exports;})();
var v=engine.makeVarintField,m=engine.makeLengthDelimitedField;
var loc=engine.concatBytes([v(1,100000000),v(2,200000000),v(3,39)]);
var result=run('rewrite',req,{status:200,body:engine.buildAppleWLocResponse(m(2,m(2,loc)))});
var rootField=engine.parseFields(engine.extractAppleWLocPayload(result.body).payload)[0];
assert(engine.locationSummary(engine.parseFields(rootField.valueBytes)[0].valueBytes)==='51.50740000,-0.12780000','actual response adapter');
state=JSON.parse(run('panel',{url:origin+'/wloc-helper/api/state'}).response.body);
assert(state.stage==='patched' && state.systemLocationVerified===false,'honest status');
var write=$persistentStore.write;
$persistentStore.write=function(value,key){return /:request$/.test(key)?false:write(value,key);};
assert(Object.keys(run('observe',req)).length===0,'fail open');
assert(JSON.parse(data['location_helper_v1:runtime:observe:wloc']).status==='failed','visible failure');
JSON.stringify({engine:'JavaScriptCore',checks:['save','CN probe','binary selftest','probe isolation','explicit port','response adapter London','fault telemetry'],result:'PASS',iOSDeviceTest:false});
'''.replace('BUNDLES', json.dumps(bundles)).replace('VENDOR', (root/'vendor/location-spoofer.cjs').read_text())
text = string(source.encode())
exception = ptr()
value = evaluate(context,text,None,None,1,c.byref(exception))
result = to_string(context,exception if exception.value else value,None)
size = length(result)
buffer = c.create_string_buffer(size)
utf8(result,buffer,size)
print(buffer.value.decode())
release(result)
release(text)
bind('JSGlobalContextRelease',None,[ptr])(context)
if exception.value:
    raise SystemExit(1)
