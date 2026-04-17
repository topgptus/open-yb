# Open YB Pure Chrome Extension

这是一个实验性的纯 Chrome 插件版本，不依赖 Cloudflare Worker。

它会尝试：

1. 用 `declarativeNetRequest` 给 `yb.tencent.com/wx/ct/...` 请求设置微信 WebView 风格请求头。
2. 在扩展 background service worker 里直接请求元宝分享页。
3. 解析 HTML 中的 `__NEXT_DATA__`，提取标题、问题、回答，并在页面里渲染。

## 安装

1. 打开 `chrome://extensions/`。
2. 打开“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择仓库里的 `extension-pure/` 目录。

## 重要限制

纯插件版是否成功，取决于 Chrome 是否允许扩展稳定修改或影响 `User-Agent` 请求头。

如果页面显示 `notInWX`，说明元宝没有把请求识别成微信 WebView。这不是解析逻辑的问题，而是浏览器扩展请求环境限制。此时请继续使用：

- `extension/`：Worker 版 Chrome 插件
- `skills/open-yb/`：本地 Python skill
- `worker.js`：Cloudflare Worker API

## 功能

- 开关：启用或关闭纯插件接管。
- 页面解析：尝试直接读取元宝分享页并展示正文。
- 收藏：保存当前解析结果到 Chrome 本地存储。
- 导出：单篇导出 Markdown。
- 收藏库：复制、删除、单篇导出、勾选多篇合并导出 Markdown。
