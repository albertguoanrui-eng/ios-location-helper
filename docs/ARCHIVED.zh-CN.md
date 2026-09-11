# 项目归档说明

归档日期：2026-09-11。最后实验版本：0.1.3。

## 为什么归档

目标是在 iPhone 上仅依靠 Shadowrocket 将系统位置改为指定坐标。项目已完成本地控制面板、坐标持久化、WLOC 二进制响应改写和诊断工具，但 **没有在测试设备的 iOS 27.0 RC（24A435）上实现系统定位修改**。用户最终仍看到真实位置，故按用户要求停止继续尝试并归档。

实测和诊断区分如下：

- Safari 人工自检验证了脚本执行、存储及合成二进制改写，不能证明系统定位成功。
- 真实定位观测长期停留在 waiting，request 与 response 为 null；已有代理日志显示多次解密尝试后连接迅速结束，没有对应真实 WLOC 改写证据。
- 系统诊断将 Apple 专用证书策略检查失败关联到了 locationd；历史安全事件同时涉及定位域名、AppleIssued 策略和 Shadowrocket 签发证书。
- 多项证据高度指向系统定位客户端的证书策略阻碍 HTTPS 解密。HTTP 脚本执行前发生的问题，不能靠调整坐标、面板或 protobuf 改写来解决。
- 单条候选证书路径检查失败不等于整个最终信任评估失败。没有取得每条 TLS 连接与系统校验一一对应的完整证据，因此保留“高度指向”的诊断表述，不声称破解、修复或定位成功。
- 安全事件中的 TrustResult: 4 不被直接当作失败码；公开 SecTrust 枚举中的 4 表示 Unspecified，遥测字段映射未确认。

公开语义参考：[Apple 证书检查实现](https://github.com/apple-oss-distributions/Security/blob/main/trust/trustd/SecPolicyServer.c)、[SecTrust 枚举](https://github.com/apple-oss-distributions/Security/blob/main/trust/headers/SecTrust.h)。这些参考不等同于掌握该系统构建的全部实现。

## 存档内容

统一项目文件夹仍为 `ios-location-helper/`，保留 Git 历史和现有模块路径。

```text
ios-location-helper/
  README.md                  归档提示与历史说明
  docs/                      公开教程、技术记录、归档原因
  src/ web/ scripts/ tests/   实现、面板、构建及校验
  vendor/                    上游代码与许可证说明
  module/                    历史发布模块及对应源码包
  dist/                      本地构建产物
  local-archive/              仅本地保存，Git 忽略
    README.md                本地资料入口
    inputs/                  原始代理日志和 sysdiagnose 压缩包
    original-extraction/     原有完整解压副本
    analysis/                诊断报告、精简证据、完整解析输出
    screenshots/             本次设备截图
    tools/                   临时分析工具、源码、构建工具链和编辑脚本
    migration-map.json       旧路径到归档路径的映射
    inventory.jsonl          文件大小、SHA-256、符号链接信息
```

公开 GitHub 只同步代码与不含私人日志的归档说明。原始系统诊断、精确设备活动、截图和分析工具不进入公开仓库；完整日志内可能包含与本项目无关的私人数据。本地原报告中的旧路径保留为历史记录，新入口见 local-archive/README.md。

## 历史产物与校验

保留 0.1.2 和 0.1.3 已发布模块、source.zip 及校验和的原始字节，用于追溯已有实验。归档没有生成宣称可用的新定位版本。历史源码包保留当时的 README；仓库当前 README 和本说明记录最终状态。

现有校验命令可用于研究复现：

```sh
npm test
npm run build
npm run check
python3 scripts/check-jsc.py
```

测试成功只代表被测逻辑通过，不代表 iOS 真机 TLS 解密或系统定位成功。本项目无 Jenkins 任务或在线部署目标；归档同步至 GitHub 后停止发布。

## 检索过的其他路线

截至归档日，Locus 与 Roam Control 的项目文档描述了 iOS 27 本机配对和开发调试定位通道；这类原生 App 与 Shadowrocket HTTP 改写是不同方案，并未集成或在本测试设备上验证。

- [Locus](https://github.com/ChrisMack32/Locus)：MIT，文档说明使用开发者定位服务及 LocalDevVPN，仍需完成 IPA 签名安装。
- [Roam Control](https://github.com/seanhowarthdev/Roam-Control)：当前源码为 PolyForm Noncommercial；最初 Beta 1 保留 MIT 许可。安装及本机配对不等同于本设备已验证成功。
- [SideInstaller](https://github.com/FrizzleM/SideInstaller)：提供手机端安装入口，但首次安装依赖可用签名；证书状态随时间变化，不能据此保证全程免电脑安装成功。

这些链接作为研究记录保留，不是本项目的修复承诺。没有发现针对该测试环境已验证成功的纯 Shadowrocket 新修复。

## 恢复研究的条件

如以后继续，应先取得新的真实请求或系统定位成功证据，并明确系统版本和安装条件；不得用面板状态或合成探针代替真机结果。管理员可以解除 GitHub 归档后再提交变更。AGPL-3.0 与已有第三方许可证继续适用。
