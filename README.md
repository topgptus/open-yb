# Open YB

Open YB 是一个把腾讯元宝微信分享链接转成浏览器可读内容的小工具。它由两部分组成：

- Cloudflare Worker：负责解析元宝公开分享页里的纯文本内容。
- Chrome 插件：负责在 Windows / macOS 的 Chrome 里接管元宝链接，显示内容、复制、收藏、导出 Markdown。

项目地址：<https://github.com/topgptus/open-yb>

示例链接：

```text
https://yb.tencent.com/wx/ct/YFJCmiMxnhFCZJ
```

腾讯元宝分享页在普通电脑浏览器里通常会提示“请在微信客户端打开该链接”。Open YB 的目标就是把这个过程变简单：你在微信里把公众号文章、视频号内容或其他素材转发给元宝，让元宝总结、概括、提炼信息；再把元宝生成的分享链接放到电脑浏览器里打开，插件会自动调用 Worker 解析出正文，最后可以复制、收藏或导出 Markdown，放进知识库、NotebookLM、Obsidian、Notion 等工具里继续使用。

Worker 会使用微信 WebView User-Agent 请求分享页，读取服务端渲染 HTML 中的 `__NEXT_DATA__`，再提取标题、用户问题、元宝回答、图片链接和部分元数据。

## 典型工作流

1. 在微信里添加腾讯元宝好友。
2. 看到有价值的微信公众号文章、视频号、聊天内容或网页素材时，直接转发给元宝。
3. 转发时配上合适提示词，例如：

```text
请总结这篇文章的核心观点，提炼项目地址、关键步骤、适合人群和标签。
```

```text
请概括这条视频的核心内容，拆解它的文案结构、开头钩子、转折点和行动号召。
```

```text
请把这篇内容整理成 Markdown 笔记，包含摘要、要点、可执行步骤、关键词和延伸问题。
```

4. 元宝生成回答后，拿到 `yb.tencent.com/wx/ct/...` 分享链接。
5. 在 Windows 或 macOS 的 Chrome 中打开这个链接。
6. Open YB 插件自动接管页面，调用你部署的 Worker，把内容转成可阅读文本。
7. 一键复制、收藏，或导出 Markdown。
8. 把 Markdown 放入知识库、NotebookLM、Obsidian、Notion 或其他资料库。

这个流程适合把原本需要手机打开、手动复制、反复整理的微信内容处理过程，变成“微信转发给元宝 -> 电脑浏览器打开 -> 导出 MD”的轻量链路。

## 功能

- Web UI：粘贴元宝分享链接，页面显示解析出的回答文本。
- 一键复制：复制解析出的元宝回答。
- JSON API：传入元宝 URL，返回结构化内容。
- Text API：传入元宝 URL，返回纯文本回答。
- CORS：API 默认允许跨域调用。
- Chrome 插件：打开元宝微信分享链接时自动接管页面，显示正文、复制、收藏和导出 Markdown。

## 快速开始

### 1. 部署 Worker

把 `worker.js` 复制到 Cloudflare Worker，或者在本仓库中用 Wrangler 部署：

```bash
npx wrangler deploy worker.js --name open-yb
```

部署后会得到一个 Worker 地址，例如：

```text
https://your-worker.workers.dev
```

本项目默认不配置 API Key。目的是让个人使用时足够简单：复制 `worker.js`、部署 Worker、安装 Chrome 插件、填入 Worker 地址即可。如果你要公开给多人使用，可以自行在 Worker 前面加访问控制、Cloudflare Access、Key 校验或限流。

### 2. 安装 Chrome 插件

`extension/` 目录提供了一个 Manifest V3 Chrome 插件，用于把“请在微信客户端打开该链接”的页面变成可阅读、可收藏、可导出的阅读器。

1. 打开 Chrome 的扩展管理页：

```text
chrome://extensions/
```

2. 打开“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本仓库的 `extension/` 目录。
5. 点击浏览器工具栏里的 Open YB 图标，确认 Worker 地址正确。

### 3. 配置插件

1. 点击 Chrome 工具栏里的 Open YB 图标。
2. 打开“接管元宝分享页”。
3. 填入你自己的 Worker 地址，例如：

```text
https://your-worker.workers.dev
```

4. 保存设置。
5. 如果 Chrome 弹出域名访问权限确认，同意即可。

### 4. 打开元宝分享链接

1. 保持插件开关为开启。
2. 在 Chrome 中打开元宝分享链接：

```text
https://yb.tencent.com/wx/ct/YFJCmiMxnhFCZJ
```

3. 插件会覆盖原来的限制页，并显示 Worker 解析出的内容。
4. 点击“复制正文”可以复制回答文本。
5. 点击“收藏”会把内容保存到 Chrome 本地存储。
6. 点击“设置”或插件弹窗里的“打开收藏库”，可以管理收藏、合并导出 Markdown。

## Chrome 插件能力

- 开关控制：插件弹窗里可以开启或关闭元宝分享页接管。
- Worker 配置：默认 Worker 地址为 `https://your-worker.workers.dev`，安装后需要改成你自己部署的 Worker。
- 自动接管：访问 `https://yb.tencent.com/wx/ct/...` 或 `https://yuanbao.tencent.com/wx/ct/...` 时，插件会调用 Worker 的 `/api/parse` 解析正文。
- 当前页操作：显示标题、问题、回答，支持一键复制正文、收藏、导出当前内容为 Markdown。
- 收藏库：在插件设置页管理本地收藏，支持单篇复制、单篇导出、删除。
- 合并导出：勾选多篇收藏后，可以复制合并 Markdown 或下载合并 Markdown 文件。
- 知识库友好：导出的 Markdown 可以直接放进 NotebookLM、Obsidian、Notion、Dify 知识库或其他 RAG / 笔记系统。

## 提示词示例

你可以根据素材类型给元宝不同的提示词。Open YB 不负责调用元宝生成内容，它只负责把元宝已经生成的分享结果在电脑浏览器中打开、整理和导出。

### 公众号文章总结

```text
请总结这篇文章，输出：
1. 一句话摘要
2. 5 个核心观点
3. 值得保存的金句
4. 可执行步骤
5. 适合打的标签
6. 如果要放进知识库，建议的标题
```

### 视频号内容概括

```text
请概括这条视频的核心内容，并拆解：
1. 开头如何吸引注意力
2. 中间如何展开论证或讲故事
3. 结尾如何引导行动
4. 有哪些可复用的文案技巧
5. 适合二次创作的选题角度
```

### 项目信息提炼

```text
请从这条内容里提炼项目资料：
1. 项目名称
2. 项目地址
3. 解决的问题
4. 核心功能
5. 部署或使用步骤
6. 技术标签
7. 适合收藏到知识库的 Markdown 版本
```

### 知识库笔记格式

```text
请把这段内容整理成 Markdown 笔记，结构为：
# 标题
## 摘要
## 核心要点
## 操作步骤
## 关键链接
## 标签
## 后续可以追问的问题
```

### 插件架构

```mermaid
flowchart LR
  A["微信内容"] --> B["转发给元宝并写提示词"]
  B --> C["元宝生成总结或分析"]
  C --> D["获得 yb.tencent.com 分享链接"]
  D --> E["Chrome 插件接管页面"]
  E --> F["Worker 解析分享页"]
  F --> G["浏览器显示正文"]
  G --> H["复制 / 收藏 / 导出 Markdown"]
```

插件本身不保存云端数据，收藏内容保存在 Chrome 本地 `chrome.storage.local`。如果换电脑或清空浏览器数据，收藏库不会自动同步。

### 权限说明

插件使用的权限：

- `storage`：保存开关、Worker 地址和收藏内容。
- `host_permissions`：允许在元宝分享页运行内容脚本，并请求默认 Worker 和 `workers.dev` 上的 Worker API。
- `optional_host_permissions`：当你把 Worker 地址改成自定义域名时，插件会请求访问该 Worker 域名的权限。

插件采用“内容脚本接管页面”的方式实现，不修改系统代理，也不接管非元宝域名的页面。

### Worker 连接失败排查

如果页面显示 `无法连接 Worker` 或浏览器控制台出现 `net::ERR_CONNECTION_CLOSED`，说明 Chrome 到 Worker 域名的 HTTPS 连接被断开，常见原因是：

- Worker 地址写错，或部署还没有完成。
- `workers.dev` 在当前网络环境不可达。
- Worker 地址末尾带了多余的点，例如 `https://xxx.workers.dev.`。

处理方式：

1. 直接在 Chrome 打开插件提示里的“测试地址”。
2. 如果测试地址能打开但插件仍失败，请在 `chrome://extensions/` 里重新加载 Open YB。
3. 如果测试地址也打不开，先换网络或给 Worker 绑定自定义域名。
4. 在插件弹窗里把 Worker 地址改成可访问的域名，例如 `https://yb.example.com`，并同意 Chrome 弹出的域名访问权限。

插件请求 Worker 时会依次尝试扩展后台请求、内容脚本 CORS 请求、JSONP 桥接。JSONP 桥接需要 Worker 部署新版代码。

## API

### `GET /api/parse`

```bash
curl "https://<your-worker-domain>/api/parse?url=https%3A%2F%2Fyb.tencent.com%2Fwx%2Fct%2FYFJCmiMxnhFCZJ"
```

返回示例：

```json
{
  "sourceUrl": "https://yb.tencent.com/wx/ct/YFJCmiMxnhFCZJ",
  "shareId": "YFJCmiMxnhFCZJ",
  "title": "改变世界的数学公式",
  "description": "这17个公式是人类智慧结晶...",
  "answerTime": "2026年04月16日",
  "questionText": "请用纯文本来讲解一下这 17 个公式",
  "answerText": "这17个公式是人类智慧结晶的巅峰代表...",
  "messages": [],
  "images": [],
  "meta": {
    "errCode": 0,
    "expireTime": 1807420368,
    "backendTraceId": "",
    "tts": {
      "status": "requires_yuanbao_token",
      "websocketAudioUrl": "wss://api.yuanbao.tencent.com/ws/audio/tts",
      "websocketSegmentUrl": "wss://api.yuanbao.tencent.com/ws/sentence/segmentSentences",
      "httpFallbackUrl": "https://yb.tencent.com/api/audio/v2/tts"
    }
  }
}
```

### `POST /api/parse`

```bash
curl -X POST "https://<your-worker-domain>/api/parse" \
  -H "content-type: application/json" \
  -d '{"url":"https://yb.tencent.com/wx/ct/YFJCmiMxnhFCZJ"}'
```

### `GET /api/text`

```bash
curl "https://<your-worker-domain>/api/text?url=https%3A%2F%2Fyb.tencent.com%2Fwx%2Fct%2FYFJCmiMxnhFCZJ"
```

返回 `text/plain`，内容为解析出的元宝回答文本。

## 本地开发

安装 Wrangler 后运行：

```bash
npx wrangler dev worker.js
```

打开本地地址后，粘贴元宝分享 URL 即可测试。

## Worker 部署

```bash
npx wrangler deploy worker.js --name open-yb
```

也可以创建 `wrangler.toml` 后部署：

```toml
name = "open-yb"
main = "worker.js"
compatibility_date = "2026-04-16"
```

## 元宝分享页绕过逻辑

普通桌面浏览器或普通手机浏览器 User-Agent 请求 `https://yb.tencent.com/wx/ct/...` 时，服务端会返回：

```json
{
  "err_code": "notInWX"
}
```

页面文案通常是：

```text
请在微信客户端打开该链接
```

实测关键检查点是 User-Agent 里是否包含微信内置浏览器标识 `MicroMessenger/...`。Worker 因此使用类似下面的 UA 请求分享页：

```text
Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.49(0x1800312c) NetType/WIFI Language/zh_CN
```

这个方式可以让服务端返回公开分享内容，而不是客户端限制页。

## 文本解析逻辑

分享页是 Next.js 页面，正文数据在 HTML 的 `__NEXT_DATA__` 中。Worker 会：

1. 请求分享页 HTML。
2. 提取 `<script id="__NEXT_DATA__">...</script>`。
3. 解析 JSON。
4. 读取 `props.pageProps.data.conversation_info`。
5. 优先从 `shareExtraDetailObj.chatInfo[].convs` 提取完整对话。
6. 返回最后一条 `speaker === "ai"` 的文本作为 `answerText`。

## “听全文”TTS 链路分析

元宝分享页里的“听全文”按钮确实不是浏览器内置朗读，而是腾讯服务器提供的 TTS。

前端代码里存在两条路径：

### WebSocket 流式 TTS

优先使用 WebSocket：

```text
wss://api.yuanbao.tencent.com/ws/sentence/segmentSentences
wss://api.yuanbao.tencent.com/ws/audio/tts
```

连接参数包括：

```text
hy_user=<hyUser>
hy_token=<hyToken>
hy_source=web
randStr=<random>
```

分句接口发送：

```text
[BEGIN_<uuid>]
完整文本
[DONE]
```

音频接口逐句发送：

```json
{
  "inputText": "这17个公式是人类智慧结晶的巅峰代表",
  "voiceType": 606242081,
  "speechSpeed": 0,
  "source": 3,
  "textIdx": 0,
  "codec": "mp3",
  "sessionid": "<random-session-id>"
}
```

返回消息包含多段 `base64Audio`，最后以 `final: true` 标记结束。前端会把同一个 `sessionid` 的 `base64Audio` 拼接成 `audio/mpeg` Blob 播放。

### HTTP 降级 TTS

WebSocket 失败后，前端会降级到：

```text
POST https://yb.tencent.com/api/audio/v2/tts
```

请求体：

```json
{
  "inputText": "你好",
  "voiceType": 606242081,
  "speechSpeed": 0,
  "source": 3
}
```

成功时返回：

```json
{
  "data": {
    "base64Audio": "..."
  }
}
```

## 为什么当前 Worker 不提供元宝原生音频

公开分享链接本身不包含 `hy_user`、`hy_token` 或音频 URL。微信消息 XML 也只包含分享卡片元数据，例如标题、摘要、URL、缩略图 CDN 信息，不包含 TTS token。

无 token 调用 HTTP TTS 接口会返回：

```text
HTTP 401
get token err
```

因此，只传一个公开元宝 URL 时：

- 文本解析：可以实现。
- 复用腾讯元宝原生“听全文”音频：缺少 token，不能稳定匿名实现。

如果后续能从微信 WebView 请求里抓到 `hy_user` 和 `hy_token`，可以扩展 Worker：

- `/api/audio/stream`：连接腾讯 WebSocket TTS，并把音频片段转发给调用方。
- `/api/audio/download`：收集所有 `base64Audio`，合并为 MP3 下载。
- 可选 R2 缓存：用分享 ID 和文本 hash 作为 key 缓存音频文件。

## 安全说明

当前 Worker 只允许解析以下域名的 `/wx/ct/` 链接：

- `yb.tencent.com`
- `yuanbao.tencent.com`

这样可以避免把 Worker 变成任意 URL 代理。

## 文件

- `worker.js`：Cloudflare Worker 源码，包含 Web UI 和 API。
- `open-yb.mjs`：本地 Node 调试脚本，用相同 UA 抓取分享页并保存 HTML 快照。
- `extension/`：Chrome 插件源码，包含页面接管、弹窗设置、收藏库和 Markdown 导出。
- `extension/icons/open-yb-logo.svg`：Chrome 插件 Logo 源文件。
