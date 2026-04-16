const WX_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) " +
  "AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 " +
  "MicroMessenger/8.0.49(0x1800312c) NetType/WIFI Language/zh_CN";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type",
};

export default {
  async fetch(request) {
    try {
      if (request.method === "OPTIONS") {
        return new Response(null, { headers: JSON_HEADERS });
      }

      const url = new URL(request.url);
      if (url.pathname === "/") {
        return htmlResponse(renderHome());
      }

      if (url.pathname === "/api/parse") {
        if (request.method === "GET" && url.searchParams.get("jsonp") === "1") {
          return await jsonpParseResponse(request, url);
        }

        const inputUrl = await readInputUrl(request, url);
        const result = await parseYuanbaoShare(inputUrl);
        return jsonResponse(result);
      }

      if (url.pathname === "/api/text") {
        const inputUrl = await readInputUrl(request, url);
        const result = await parseYuanbaoShare(inputUrl);
        return new Response(result.answerText || "", {
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "access-control-allow-origin": "*",
          },
        });
      }

      return jsonResponse({ error: "Not found" }, 404);
    } catch (error) {
      return jsonResponse({ error: error.message || String(error) }, 400);
    }
  },
};

async function jsonpParseResponse(request, currentUrl) {
  const id = currentUrl.searchParams.get("id") || "";
  const targetOrigin = currentUrl.searchParams.get("targetOrigin") || "*";

  try {
    const inputUrl = await readInputUrl(request, currentUrl);
    const result = await parseYuanbaoShare(inputUrl);
    return javascriptResponse(renderPostMessageScript({ id, ok: true, data: result }, targetOrigin));
  } catch (error) {
    return javascriptResponse(
      renderPostMessageScript(
        {
          id,
          ok: false,
          error: error.message || String(error),
        },
        targetOrigin,
      ),
    );
  }
}

async function readInputUrl(request, currentUrl) {
  if (request.method === "GET") {
    const inputUrl = currentUrl.searchParams.get("url");
    if (inputUrl) return inputUrl;
  }

  if (request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    if (body.url) return body.url;
  }

  throw new Error("Missing yuanbao share url");
}

async function parseYuanbaoShare(inputUrl) {
  const shareUrl = normalizeShareUrl(inputUrl);
  const response = await fetch(shareUrl.toString(), {
    redirect: "follow",
    headers: {
      "user-agent": WX_USER_AGENT,
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
      "upgrade-insecure-requests": "1",
    },
  });

  if (!response.ok) {
    throw new Error(`Yuanbao fetch failed: HTTP ${response.status}`);
  }

  const html = await response.text();
  const nextData = readNextData(html);
  const pageProps = nextData?.props?.pageProps;
  const pageData = pageProps?.data;

  if (!pageData) {
    throw new Error("Yuanbao response did not include page data");
  }

  if (pageData.err_code === "notInWX") {
    throw new Error("Yuanbao rejected the request as notInWX");
  }

  if (pageData.err_code && pageData.err_code !== 0) {
    throw new Error(pageData.err_msg || `Yuanbao returned err_code=${pageData.err_code}`);
  }

  const info = pageData.conversation_info || {};
  const conversations = extractConversations(info);
  const messages = conversations.map(toMessage).filter((message) => message.text);
  const answer = [...messages].reverse().find((message) => message.speaker === "ai");
  const question = messages.find((message) => message.speaker === "human");
  const shareCard = info.shareCardInfo || info.shareExtraDetailObj?.chatInfo?.[0]?.shareCardInfo || {};
  const title = shareCard.title || info.title || answer?.title || "";

  return {
    sourceUrl: shareUrl.toString(),
    shareId: pageProps.shareId || basename(shareUrl.pathname),
    title,
    description: shareCard.description || "",
    answerTime: shareCard.answerTime || "",
    questionText: question?.text || "",
    answerText: answer?.text || "",
    messages,
    images: extractImages(conversations),
    meta: {
      errCode: pageData.err_code,
      expireTime: info.expireTime || null,
      backendTraceId: pageProps.backendTraceId || "",
      tts: {
        status: "requires_yuanbao_token",
        websocketAudioUrl: "wss://api.yuanbao.tencent.com/ws/audio/tts",
        websocketSegmentUrl: "wss://api.yuanbao.tencent.com/ws/sentence/segmentSentences",
        httpFallbackUrl: "https://yb.tencent.com/api/audio/v2/tts",
      },
    },
  };
}

function normalizeShareUrl(inputUrl) {
  let url;
  try {
    url = new URL(inputUrl);
  } catch {
    throw new Error("Invalid url");
  }

  const allowedHosts = new Set(["yb.tencent.com", "yuanbao.tencent.com"]);
  if (!allowedHosts.has(url.hostname)) {
    throw new Error("Only yb.tencent.com and yuanbao.tencent.com share URLs are supported");
  }

  if (!url.pathname.startsWith("/wx/ct/")) {
    throw new Error("Only /wx/ct/ share URLs are supported");
  }

  return url;
}

function readNextData(html) {
  const match = html.match(
    /<script id="__NEXT_DATA__" type="application\/json"[^>]*>([\s\S]*?)<\/script>/,
  );
  if (!match) throw new Error("Could not find __NEXT_DATA__ in Yuanbao page");

  try {
    return JSON.parse(match[1]);
  } catch {
    throw new Error("Could not parse __NEXT_DATA__ JSON");
  }
}

function extractConversations(info) {
  const candidates = [
    info.shareExtraDetailObj?.chatInfo,
    info.chatInfo,
    info.dataObj?.chatInfo,
  ];

  for (const chatInfo of candidates) {
    if (!Array.isArray(chatInfo)) continue;
    const convs = chatInfo.flatMap((chat) => chat?.convs || []);
    if (convs.length > 0) return convs;
  }

  return [];
}

function toMessage(conv) {
  const text = extractText(conv);
  return {
    speaker: conv.speaker || "",
    text,
    title: conv.title || "",
    index: conv.index ?? null,
    id: conv.id || "",
  };
}

function extractText(conv) {
  if (typeof conv.speech === "string" && conv.speech.trim()) {
    return conv.speech.trim();
  }

  if (!Array.isArray(conv.speechesV2)) return "";

  return conv.speechesV2
    .flatMap((speech) => speech?.content || [])
    .filter((item) => item?.type === "text" && item.msg)
    .map((item) => item.msg)
    .join("\n")
    .trim();
}

function extractImages(conversations) {
  const images = [];
  for (const conv of conversations) {
    for (const speech of conv.speechesV2 || []) {
      for (const item of speech.content || []) {
        if ((item.type === "image" || item.docType === "image") && item.url) {
          images.push(item.url);
        }
      }
    }
  }
  return [...new Set(images)];
}

function basename(pathname) {
  const parts = pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] || "";
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: JSON_HEADERS,
  });
}

function javascriptResponse(source, status = 200) {
  return new Response(source, {
    status,
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    },
  });
}

function renderPostMessageScript(payload, targetOrigin) {
  return `window.postMessage(${JSON.stringify(
    {
      source: "OPEN_YB_JSONP",
      ...payload,
    },
  )}, ${JSON.stringify(targetOrigin)});`;
}

function htmlResponse(html) {
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
    },
  });
}

function renderHome() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Open YB</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f5f7fb;
      color: #172033;
    }
    body {
      margin: 0;
      min-height: 100vh;
      background: linear-gradient(180deg, #f5f7fb 0%, #eef3f8 100%);
    }
    main {
      max-width: 920px;
      margin: 0 auto;
      padding: 40px 18px;
    }
    h1 {
      margin: 0 0 10px;
      font-size: 32px;
      line-height: 1.2;
    }
    p {
      color: #4c5a6f;
      line-height: 1.7;
    }
    form {
      display: flex;
      gap: 10px;
      margin: 26px 0 18px;
    }
    input {
      flex: 1;
      min-width: 0;
      border: 1px solid #c9d3df;
      border-radius: 8px;
      padding: 12px 14px;
      font-size: 16px;
      background: white;
      color: #172033;
    }
    button {
      border: 0;
      border-radius: 8px;
      padding: 12px 16px;
      background: #1473e6;
      color: white;
      font-size: 15px;
      cursor: pointer;
    }
    button.secondary {
      background: #24364f;
    }
    button:disabled {
      opacity: .55;
      cursor: wait;
    }
    .result {
      display: none;
      margin-top: 22px;
      background: white;
      border: 1px solid #d8e0ea;
      border-radius: 8px;
      overflow: hidden;
    }
    .result header {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
      border-bottom: 1px solid #e7edf4;
      padding: 14px;
    }
    .result h2 {
      margin: 0;
      font-size: 18px;
    }
    pre {
      white-space: pre-wrap;
      word-break: break-word;
      margin: 0;
      padding: 16px;
      line-height: 1.7;
      color: #1c2636;
    }
    .meta {
      padding: 0 16px 14px;
      color: #66748a;
      font-size: 13px;
    }
    .error {
      display: none;
      margin-top: 18px;
      color: #b42318;
      background: #fff0ed;
      border: 1px solid #ffd3ca;
      border-radius: 8px;
      padding: 12px 14px;
    }
    @media (max-width: 620px) {
      form, .result header {
        flex-direction: column;
        align-items: stretch;
      }
      h1 {
        font-size: 26px;
      }
    }
  </style>
</head>
<body>
  <main>
    <h1>Open YB</h1>
    <p>粘贴腾讯元宝分享链接，解析公开分享页里的纯文本内容。音频接口需要元宝侧 token，本页面只提供文本解析。</p>
    <form id="form">
      <input id="url" name="url" placeholder="https://yb.tencent.com/wx/ct/YFJCmiMxnhFCZJ" autocomplete="url" required>
      <button id="submit" type="submit">解析</button>
    </form>
    <div id="error" class="error"></div>
    <section id="result" class="result">
      <header>
        <h2 id="title"></h2>
        <button id="copy" class="secondary" type="button">一键复制</button>
      </header>
      <pre id="answer"></pre>
      <div id="meta" class="meta"></div>
    </section>
  </main>
  <script>
    const form = document.getElementById("form");
    const urlInput = document.getElementById("url");
    const submit = document.getElementById("submit");
    const result = document.getElementById("result");
    const errorBox = document.getElementById("error");
    const title = document.getElementById("title");
    const answer = document.getElementById("answer");
    const meta = document.getElementById("meta");
    const copy = document.getElementById("copy");

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      submit.disabled = true;
      submit.textContent = "解析中";
      errorBox.style.display = "none";
      result.style.display = "none";

      try {
        const response = await fetch("/api/parse", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: urlInput.value.trim() })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "解析失败");

        title.textContent = data.title || data.shareId || "元宝分享";
        answer.textContent = data.answerText || "";
        meta.textContent = data.questionText ? "问题：" + data.questionText : "";
        result.style.display = "block";
      } catch (error) {
        errorBox.textContent = error.message;
        errorBox.style.display = "block";
      } finally {
        submit.disabled = false;
        submit.textContent = "解析";
      }
    });

    copy.addEventListener("click", async () => {
      await navigator.clipboard.writeText(answer.textContent);
      copy.textContent = "已复制";
      setTimeout(() => { copy.textContent = "一键复制"; }, 1200);
    });
  </script>
</body>
</html>`;
}
