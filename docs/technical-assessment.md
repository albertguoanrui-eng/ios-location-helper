# 技术说明与核查

日期：2026-09-11。用户选择 Shadowrocket，项目先在本地完成，随后授权上传到公开 GitHub 仓库。

## 当前实现

手机 Safari → Shadowrocket 请求脚本返回内嵌页面 → 控制 API 写入 `$persistentStore` → 请求脚本观测 WLOC → 响应脚本改写 protobuf → iOS 自行选择定位来源。

手机上的控制页使用 `https://gs-loc.apple.com/wloc-helper/`，由 `panel.js` 拦截并返回，开发机的静态服务仅分发模块和脚本，不作为坐标 API。没有原生 App、开发者配对、签名包或 USB 操作。

模块包含三个独立脚本，配置和诊断经小火箭持久存储共享。默认关闭，停止时写入新的关闭配置。面板响应采用数值 HTTP 状态，带 `X-Location-Helper: 1` 来源标识且不允许缓存；POST 要求 JSON、自定义头并检查 Origin，拒绝跨域预检，不开放 CORS。存储失败不能返回配置成功。

仅拦截列出的 5 个域名及 `/clls/wloc`，观测请求不生成替代请求，也不改请求正文。启用时把 `Accept-Encoding` 设为 `identity`；仍然压缩、HTTP 异常、空响应或解析失败时保持原样。响应脚本最大正文为 1 MiB，超过脚本处理限制的流量可能无法出现在诊断中。

解析器支持多种上游封装；本项目先要求识别封装并确认位置子消息含经纬度，再调用改写。不会对未知格式启用上游原始字节扫描兜底。只替换已有纬度、经度和水平精度，保留其他 protobuf 字段。不把没有坐标的 Wi-Fi 或基站容器计为改写成功。

诊断是当前配置版本的最近事件。面板无法读取苹果地图真实蓝点，`systemLocationVerified` 始终为 `false`，不是经过观测得出的失败状态，而是未验证的明确标记。

## 固定的源码与来源

直接复用 [mekos2772/ios-location-spoofer](https://github.com/mekos2772/ios-location-spoofer) 的 `location-spoofer.js`，提交 `f183fd9bb6455af88373f846da47185d9295cb98`。副本改用 `.cjs` 文件名，内容未修改；构建校验 `vendor/upstream.json` 中的 SHA-256。

参考 [xweiba/location-spoofer](https://github.com/xweiba/location-spoofer) 的 WLOC 路线与现有限制。Roam Control / Locus 属于另一条原生配对和开发者服务路线，无法通过移植网页界面获得相同权限。本项目未复制其实现，也未引入其签名安装流程。

[上游 Issue #79](https://github.com/mekos2772/ios-location-spoofer/issues/79) 报告 iOS 27 beta 6+ 出现失败；这不足以证明每台 RC 设备必然失败，也不能证明本项目已修复。上游 README 的成功说明和缓存建议不等同于对用户这台设备的验证。

## 尚未解决的限制

1. 操作系统不发送可拦截 WLOC 请求或拒绝 TLS 解密时，当前模块没有新的系统定位执行路径。
2. 改写成功后，系统仍可能使用 GPS、其他定位来源或已有缓存。
3. 停止开关不调用系统清除模拟定位或清缓存接口；需要用户确认恢复。
4. 没有本机 Shadowrocket 版本和真机日志，导入界面、脚本运行及离线缓存均待确认。
5. 公开模块经 GitHub Raw 下载，手机需要能访问该域名；本地预览入口仍只对能连接开发机的设备可用。
