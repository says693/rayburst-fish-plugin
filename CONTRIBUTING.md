# 贡献指南

## 开发环境

- Windows x64
- Node.js 22.17.0 或更新版本
- npm 10 或更新版本

## 验证流程

```sh
npm ci
npm run check
npm test
npm run build
npm run verify
node scripts/assert-release.mjs v1.0.0
```

提交 Pull Request 前必须完成上述检查。涉及 RPC 的修改需要增加模拟服务测试；涉及页面的修改需要增加 jsdom 测试；涉及清单或打包的修改必须更新验包规则。

## 代码约定

- 使用原生 ESM，不增加运行时 npm 依赖。
- 页面禁止内联脚本和远程资源。
- 不引入删除磁盘文件、远程 RPC 或绕过 Rayburst 种子选择流程的能力。
- 新能力必须同步更新 `plugin.json`、README、测试和合规文档。
- 不修改 `sdk/` 下的第三方源码；确需升级时保留原始许可。

## 发布

1. 更新 `package.json`、`plugin.json` 和 `CHANGELOG.md` 的版本。
2. 完整执行验证流程。
3. 合并到 `main` 后创建 `vX.Y.Z` 标签并推送。
4. Release 工作流会重新测试、验包并上传安装包、源码、清单和校验文件。

## 提交信息

使用简明祈使句，例如 `Add task filtering` 或 `Fix RPC authentication`。不要在提交中包含 RPC 密钥、个人下载目录或真实下载链接。
