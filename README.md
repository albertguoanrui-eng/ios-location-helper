# 定位助手 · Shadowrocket

独立开源项目。提供小火箭模块、手机中文控制面板、伦敦预设、停止开关和分阶段诊断，无需安装额外签名 App。

**已经实现 WLOC 响应改写，但没有验证 iOS 27.0 RC 能采用改写结果。它不是已破解 RC 限制的方案。** 如果系统不发送可解密的定位请求，这个模块也无法改变系统位置。

## 手机使用

公开仓库：<https://github.com/albertguoanrui-eng/ios-location-helper>。模块和脚本由 GitHub 分发，手机可直接导入，不需要连接开发机。

1. 复制下面的模块地址。
2. 在 Shadowrocket 当前配置的「模块」入口添加这个地址并启用：

   ```text
   https://raw.githubusercontent.com/albertguoanrui-eng/ios-location-helper/main/module/location-helper.sgmodule
   ```

3. 停用之前的其他定位改写模块，避免多个脚本覆盖同一个响应。
4. 在 Shadowrocket 开启 HTTPS 解密，生成并安装它的 CA 证书。在 iOS「设置 → 通用 → 关于本机 → 证书信任设置」中启用该证书的完全信任。模块会追加下方 5 个域名。
5. 保持小火箭连接，Safari 打开设备控制面板：

   ```text
   https://gs-loc.apple.com/wloc-helper/
   ```

   这是由本项目的请求脚本在手机内返回的页面。若出现 Apple 页面、404 或证书错误，说明面板拦截没有成功，先检查模块、脚本下载和证书。
6. 点击「伦敦市中心」，确认纬度 `51.5074`、经度 `-0.1278`，点击「保存并开启改写」。默认处于关闭状态。
7. 打开苹果地图，点击定位箭头，再返回面板「刷新诊断」。只有在地图上确认蓝点移动，才能判断本机实测生效。
8. 使用完点击「停止改写」。它只停止后续响应改写，不能直接清除系统缓存；回到苹果地图确认真实位置恢复，必要时停用模块并重启手机再检查。

HTTP 解密域名（逗号分隔）：

```text
gs-loc.apple.com,gs-loc-cn.apple.com,gsp-ssl.ls.apple.com,bluedot.is.autonavi.com,bluedot.is.autonavi.com.gds.alibabadns.com
```

模块导入、脚本首次下载和更新要求手机能访问 `raw.githubusercontent.com`；小火箭的离线缓存行为尚未真机验证。若下载失败，先检查该域名的网络连通性和小火箭下载日志。

## 怎样读诊断

| 面板结果 | 能确认的事情 | 接下来检查 |
| --- | --- | --- |
| 控制接口已连接 | 手机能执行面板脚本并读取配置 | 开启改写后触发地图定位 |
| 设置已保存，等待定位请求 | 坐标写入小火箭存储 | 缓存、规则和系统是否使用 WLOC；不能仅凭此状态判定系统封堵 |
| 已收到请求，等待响应 | 请求脚本已命中 | 小火箭连接日志的 TLS / MITM 错误 |
| 响应已改写 | 可识别响应中的坐标已经写入目标值 | 地图蓝点是否实际移动 |
| 没有可改写坐标 / 解析失败 / 压缩响应 | 此响应保持原样 | 复制诊断继续排查，不显示定位成功 |

诊断只记录当前设置的最近请求和响应，不累计并发计数。坐标改变后，旧设置的记录不会被视为本次成功。复制的诊断不包含坐标、认证头、请求正文或完整 URL。没有埋点或诊断上传服务；正常 WLOC 请求仍访问原定位服务。

## 本地开发

要求 Node.js 22+ 和 Python 3（只用于标准库 ZIP 打包），无第三方 npm 依赖。

```bash
npm test
PUBLIC_BASE_URL=http://192.168.1.10:4187 npm run build
npm run check
HOST=192.168.1.10 PORT=4187 npm run dev
```

请把示例 IP 换为开发机实际局域网地址。仅在本机预览时可以省略环境变量，默认 `127.0.0.1:4187`，这个默认地址不能用于另一台手机导入。

- `src/core.cjs`：配置、控制 API、精确域名匹配与诊断。
- `web/panel.html`：内嵌到小火箭脚本中的中文面板；开发机预览不模拟定位成功。
- `vendor/`：固定版本的上游二进制解析实现及哈希。
- `module/`：已构建的 GitHub 分发文件，可直接导入。
- `dist/`：构建后的 `.sgmodule`、三份脚本、预览页、对应源码 ZIP 和校验清单。
- `tests/`：合成 protobuf/ARPC 用例、控制接口与打包脚本集成测试。

`npm test` 会重新构建用于集成测试的本机地址版本；手机导入前再次用正确的 `PUBLIC_BASE_URL` 构建。`dist` 不加入 Git。公开分发版本使用 `npm run build:github`，先构建并校验，然后将产物复制到 `module/`。更新源码后应重新执行该命令并一起提交源码与 `module/`。

## 验证与来源

[验收记录](docs/acceptance.md) 列出自动测试和未完成的真机验收；[技术说明](docs/technical-assessment.md) 说明实现与边界。

基于 [mekos2772/ios-location-spoofer](https://github.com/mekos2772/ios-location-spoofer) 的 AGPL v3 解析代码。上游有 [iOS 27 beta 6+ 失效反馈](https://github.com/mekos2772/ios-location-spoofer/issues/79)，版本标签不能替代 RC 实测。

本项目遵循 AGPL v3，保留 [完整许可证](LICENSE) 和 [第三方说明](THIRD_PARTY_NOTICES.md)。构建会提供包含对应源码的 `source.zip`。源码与可导入模块发布到本仓库；未配置 Jenkins 或 GitHub Pages。
