# FISH-Dock 插件标准对照

本文记录 `says693.rayburst` v1.0.1 的发布契约。依据为 FISH-Dock 源码提交 `0626a19` 与 FISH-DOCK-Plugins 开发者文档提交 `af6ddd9`；本仓库是独立第三方插件仓库，不是官方插件集的一部分。

| 项目 | 发布实现 | 验证方式 |
| --- | --- | --- |
| 发行格式 | ZIP 格式的 `.fish-plugin` | `npm run verify` 解压并校验文件集合 |
| 清单版本 | `schema: 1`、`hostApi: 1` | `plugin.json` 与验包断言 |
| 插件标识 | `says693.rayburst` | 后端握手、页面 ticket 与协议测试一致 |
| 目标平台 | `windows-x86_64` | 清单、CI 与 Release 均使用 Windows |
| Node 运行时 | 22.17.0 或更新 | `engines.node`，CI 固定 22.17.0 |
| 自启动 | 不启动或管理本机服务，显式声明 `behaviors.autostart: false` | 验包测试 |
| 页面设计 | 宿主主题、语义状态色、焦点与强制颜色模式 | 页面样式与键盘操作测试；真实 WebView 待验收 |
| SDK 入口 | 现行 `createPlugin` | 真实 SDK 子进程握手测试 |
| 宿主协议 | 换行 JSON、请求 ID、稳定错误码 | `tests/protocol.test.mjs` |
| 帧大小 | 快照压缩至 850,000 字节以内 | 超长中文任务快照测试 |
| 运行资源 | 12 个文件逐项记录 SHA-256 | 独立验包重新计算摘要 |
| 文件集合 | ZIP 仅包含 `plugin.json` 与已声明资源 | 验包比较完整路径集合 |
| 路径安全 | 无绝对路径、反斜杠或 `..` | `scripts/verify-package.mjs` |
| 当前文档 | 运行包含 README、LICENSE、第三方声明 | 构建列表与验包断言 |
| 能力最小化 | 仅 `storage`、`network`、`services` | 清单与测试断言 |
| 普通配置 | 宿主 storage，dataSchema 1 | 宿主回调测试 |
| RPC 密钥 | 宿主 `writeSecret`，页面仅得到 `hasSecret` | 服务、页面和协议测试 |
| 页面资源 | 无内联脚本、远程脚本、字体或图片 | HTML/CSS 验包规则与 jsdom 测试 |
| 网络安全 | 仅连接 `127.0.0.1`，不继承代理 | 服务实现与 RPC 测试 |
| 删除边界 | 不接受删除文件参数，移除需二次确认 | 页面与 RPC 测试 |
| 外部进程 | explorer 参数数组，`shell: false` | 注入场景测试 |
| SDK 许可 | 原样保留 `sdk/LICENSE.txt` | 运行包与源码包检查 |
| 可复现构建 | ZIP 固定 mtime，开发依赖不进入运行包 | 连续构建哈希比较 |
| 商店目录 | Release 生成 schema 1 `catalog.json` | 校验 ID、版本、平台、URL、大小与哈希 |
| CI | Windows 上执行检查、24 项测试、构建和验包 | `.github/workflows/ci.yml` |
| Release | `v*` 标签触发，重新构建并上传五项资产 | `.github/workflows/release.yml` |

## 发布文件

1. `rayburst.fish-plugin`
2. `rayburst-fish-plugin-source.zip`
3. `manifest.json`
4. `catalog.json`
5. `SHA256SUMS.txt`

## 尚未覆盖的验收

真实 Windows Rayburst 实例与 FISH-Dock 图形界面联调尚未执行。导入后的“保存并测试”可验证实际 RPC 连接，但不能替代完整 GUI 验收。`catalog.json` 的格式兼容不等于已被官方商店收录。
