# Rayburst 下载 · FISH-Dock 插件

[![CI](https://github.com/says693/rayburst-fish-plugin/actions/workflows/ci.yml/badge.svg)](https://github.com/says693/rayburst-fish-plugin/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/says693/rayburst-fish-plugin)](https://github.com/says693/rayburst-fish-plugin/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

在 FISH-Dock 中直接管理 [AnInsomniacy/rayburst](https://github.com/AnInsomniacy/rayburst) 下载器。插件通过 Rayburst 本机 aria2 JSON-RPC 工作，不经过第三方服务器。

> 非官方 Rayburst 集成。插件 ID：`says693.rayburst`；当前版本：`1.0.0`；宿主 API：1；平台：Windows x64。

## 功能

- 添加 HTTP、HTTPS、FTP、SFTP、磁力、ED2K、迅雷链接；支持每行一个的批量添加。
- 显示全局下载/上传速度、活动任务数、等待任务数。
- 显示任务进度、已下载/总大小、连接数、预计剩余时间与错误信息。
- 按状态和文件名/GID/目录筛选任务。
- 暂停、恢复、全部暂停、全部恢复。
- 移除活动任务或清除完成/错误记录；**不会删除磁盘文件**，移除前有页内二次确认。
- 使用 Windows 资源管理器打开文件所在目录。
- 自动刷新（1–10 秒可调），连接设置与 RPC 密钥分开保存。
- RPC 密钥通过 FISH-Dock `writeSecret` 接口由当前 Windows 用户加密保存，页面不回显密钥。

## 环境要求

- Windows x64。
- FISH-Dock 2.2.0 或更新版本，宿主插件 API 1。
- 在 FISH-Dock 的插件依赖设置中配置 Node.js 22.17.0 或更新运行时。
- Rayburst 正在运行；插件不会替你启动或关闭 Rayburst。

接口依据：FISH-Dock 源码提交 `0626a19`，Rayburst 源码提交 `0c880e5`。Rayburst 默认 RPC 地址为 `127.0.0.1:29100/jsonrpc`。

## 安装与配置

1. 从 [v1.0.0 Release](https://github.com/says693/rayburst-fish-plugin/releases/tag/v1.0.0) 下载 `rayburst.fish-plugin`。
2. 在 FISH-Dock 插件页导入该文件。
3. 打开 Rayburst「设置 → 高级 → RPC 设置」，确认 RPC 端口并复制 RPC 密钥。
4. 打开 Dock 中的「Rayburst 下载 → 连接设置」，填写端口和密钥，点击「保存并测试」。
5. 返回任务页，点击「添加下载」提交链接。

如果 Rayburst 的 RPC 密钥被有意设为空，插件中勾选“保存时清除已存密钥”后保存。插件只连接 `127.0.0.1`，不提供远程 RPC 配置，也不会启用 Rayburst 的“允许远程连接”。

Release 同时提供：

| 文件 | 用途 |
| --- | --- |
| `rayburst.fish-plugin` | FISH-Dock 可导入安装包 |
| `rayburst-fish-plugin-source.zip` | 完整源码、测试、文档与工作流 |
| `manifest.json` | 版本、下载地址、大小和 SHA-256 |
| `catalog.json` | FISH-Dock 商店目录 schema 1 兼容元数据 |
| `SHA256SUMS.txt` | 上述发布文件的校验值 |

`catalog.json` 仅表示元数据格式兼容，不表示插件已被 FISH-Dock 官方商店收录。

## 从源码构建

```sh
npm ci
npm run check
npm test
npm run build
npm run verify
node scripts/assert-release.mjs v1.0.0
```

构建产物位于 `dist/`。`fflate` 与 `jsdom` 仅用于构建和测试，不会进入 `.fish-plugin` 运行包。ZIP 条目使用固定时间戳，同一源码可重复得到相同哈希。

## 后端命令

所有页面调用都带 `rayburst.` 前缀：

| 命令 | 用途 |
| --- | --- |
| `rayburst.settings` | 读取端口、刷新间隔和是否已存密钥 |
| `rayburst.saveSettings` | 保存设置；空密钥保留，显式 `clearSecret` 才清除 |
| `rayburst.test` | 调用 `aria2.getVersion` 验证连接 |
| `rayburst.snapshot` | 一次 `system.multicall` 读取引擎、统计和任务 |
| `rayburst.add` | 批量 `aria2.addUri`，返回逐项结果 |
| `rayburst.action` | 暂停、恢复或移除单个任务 |
| `rayburst.pauseAll` | 全部暂停 |
| `rayburst.resumeAll` | 恢复可恢复的暂停任务 |
| `rayburst.reveal` | 在资源管理器中显示文件或目录 |

`system.multicall` 的认证令牌按 Rayburst 原生规则注入每个子调用。任务快照在返回宿主前会裁剪字段、去重并限制在 850,000 字节以内，避免超过 FISH-Dock 的 1 MiB 单行协议上限。

## Dock 插件标准与测试

发布包结构、能力声明、SDK 协议、资源哈希、页面限制和 Release 规则见 [PLUGIN-COMPLIANCE.md](docs/PLUGIN-COMPLIANCE.md)。

当前共 22 项自动化测试，覆盖：

- 本机 HTTP 模拟 Rayburst RPC：认证、批量调用、任务快照、添加、暂停/恢复、移除、错误码。
- jsdom 页面测试：统计渲染、筛选、密钥不回显、添加任务、移除二次确认。
- 真实 FISH-Dock Node SDK：换行 JSON 协议、握手、激活、宿主存储回调、业务调用、停用。
- 发行包测试：ZIP 文件集合、资源 SHA-256、清单能力、无运行时开发依赖。

**未执行真实 Windows Rayburst 实例与 FISH-Dock 图形界面联调。** 当前验收使用与源码一致的协议模拟服务；首次导入后应通过“保存并测试”验证实际安装环境。

## 当前边界

- 任务通过引擎 RPC 直接创建，不弹出 Rayburst 的扩展下载确认窗口；应用层站点规则和保存凭据不会由插件逐个重建，需要这些策略时请改用 Rayburst 自身的添加窗口。
- 支持磁力链接；未提供本地 `.torrent` 文件选择器。
- 需要种子文件选择的任务会提示在 Rayburst 中完成选择，不绕过该流程。
- 默认读取全部活动任务、前 100 条等待任务和最近 30 条停止记录；极端长文本下还会按宿主帧预算截断。
- “移除”只操作任务或记录，不提供删除下载文件功能。
- 仅声明 `storage`、`network`、`services` 能力，不申请系统代理、窗口、拖入或 Dock 状态能力。

## 隐私与安全

页面不加载任何远程脚本、字体、图片或分析服务。RPC 请求使用 `node:http` 直连本机回环地址，不继承系统代理。密钥不写入普通配置、不进入页面视图模型，错误信息会隐藏已存密钥。资源管理器调用使用参数数组且 `shell: false`。

安全报告见 [SECURITY.md](SECURITY.md)，贡献与发布流程见 [CONTRIBUTING.md](CONTRIBUTING.md)，版本变化见 [CHANGELOG.md](CHANGELOG.md)。

## 许可

插件源码采用 [MIT](LICENSE) 许可。FISH-Dock SDK 的原始许可保留在 `sdk/LICENSE.txt`；详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。Rayburst 名称与相关权利归其原作者所有，本插件不是官方插件。
