# Cloudflare Worker Archive

这里保存 Open YB 早期的 Cloudflare Worker 版本。

这部分现在不是主推荐路径。当前主线只保留：

- `../../extension/`：纯 Chrome 插件，不需要部署服务。
- `../../skills/open-yb/`：本地 Agent Skill，不需要部署服务。

## 归档内容

- `worker.js`：Cloudflare Worker Web UI 和 API。
- `extension/`：依赖 Worker 地址的旧版 Chrome 插件。
- `open-yb.mjs`：本地调试抓取脚本。
- `package.json`：Wrangler 开发依赖和脚本。
- `wrangler.toml`：Worker 部署配置。

## 什么时候还值得启用

Cloudflare 方案后续可以继续发展成：

- Cloudflare KV 云端收藏夹。
- 云端知识库存储。
- 给其他工具调用的公开 HTTP API。
- 多设备同步。
- 团队共享的元宝内容整理服务。

如果只是个人在 Chrome 里打开元宝分享页，或让 Codex / Claude Code / OpenClaw 解析元宝链接，主目录里的插件和 skill 更简单。
