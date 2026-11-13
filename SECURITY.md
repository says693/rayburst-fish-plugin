# 安全策略

## 支持版本

当前支持 `1.0.x`。安全问题修复后通过 GitHub Release 发布新版本。

## 报告漏洞

请使用本仓库的 GitHub Private Vulnerability Reporting / Security Advisory 提交报告，不要在公开 Issue 中披露 RPC 密钥、下载目录或其他敏感信息。

报告应包含受影响版本、复现步骤、预期与实际行为，以及相关日志；提交前移除密钥和个人路径。

## 安全设计

- RPC 密钥仅通过 FISH-Dock `writeSecret` 保存，页面只读取 `hasSecret`。
- 插件仅连接本机回环地址，不开放远程 RPC 配置。
- 页面不加载远程脚本、字体、图片或遥测服务。
- 移除任务不删除磁盘文件，页面移除操作需要二次确认。
- 所有发行资源均记录 SHA-256；Release 附带校验文件。
