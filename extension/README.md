# Open YB Chrome Extension

这是 Open YB 的主插件，不需要部署 Cloudflare Worker。

它会尝试用微信 WebView 风格请求头打开腾讯元宝分享页，并解析页面里的 `__NEXT_DATA__`。页面正文尽量保持元宝原版显示，插件只增加一个悬浮工具条，用于复制、收藏和导出 Markdown。

## 安装

1. 打开 `chrome://extensions/`。
2. 打开“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择仓库里的 `extension/` 目录。

## 功能

- 开关：启用或关闭元宝分享页接管。
- 原版显示：尽量保留元宝在微信里看到的原版页面。
- 复制正文：复制元宝回答文本。
- 收藏：保存当前解析结果到 Chrome 本地存储。
- 单篇导出：把当前内容导出为 Markdown。
- 收藏库：复制、删除、单篇导出、批量导出和合并导出。

## 限制

插件能否成功，取决于 Chrome 是否允许扩展稳定影响 `User-Agent` 请求头。

如果页面提示 `notInWX`，说明元宝没有把请求识别成微信 WebView。可以先刷新页面；如果仍失败，推荐使用 `skills/open-yb/` 本地 skill。
