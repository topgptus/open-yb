const WX_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) " +
  "AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 " +
  "MicroMessenger/8.0.49(0x1800312c) NetType/WIFI Language/zh_CN";

const RULE_ID = 1001;

chrome.runtime.onInstalled.addListener(() => {
  syncHeaderRule().catch(console.error);
});

chrome.runtime.onStartup.addListener(() => {
  syncHeaderRule().catch(console.error);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.enabled) {
    syncHeaderRule().catch(console.error);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "OPEN_YB_PURE_PARSE") {
    parseYuanbaoUrl(message.sourceUrl)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }

  if (message?.type === "OPEN_YB_SYNC_RULE") {
    syncHeaderRule()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }

  return false;
});

async function syncHeaderRule() {
  const { enabled = true } = await chrome.storage.sync.get({ enabled: true });
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [RULE_ID],
    addRules: enabled
      ? [
          {
            id: RULE_ID,
            priority: 1,
            action: {
              type: "modifyHeaders",
              requestHeaders: [
                { header: "user-agent", operation: "set", value: WX_USER_AGENT },
                {
                  header: "accept-language",
                  operation: "set",
                  value: "zh-CN,zh;q=0.9,en;q=0.8",
                },
              ],
            },
            condition: {
              regexFilter: "^https://(yb|yuanbao)\\.tencent\\.com/wx/ct/",
              resourceTypes: ["main_frame", "xmlhttprequest"],
            },
          },
        ]
      : [],
  });
}

async function parseYuanbaoUrl(inputUrl) {
  const shareUrl = normalizeShareUrl(inputUrl);
  const response = await fetch(shareUrl.toString(), {
    method: "GET",
    redirect: "follow",
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
    },
    credentials: "omit",
  });

  if (!response.ok) {
    throw new Error(`元宝页面请求失败：HTTP ${response.status}`);
  }

  return parseYuanbaoHtml(await response.text(), shareUrl);
}

function parseYuanbaoHtml(html, shareUrl) {
  const nextData = readNextData(html);
  const pageProps = nextData?.props?.pageProps || {};
  const pageData = pageProps?.data;

  if (!pageData) {
    throw new Error("元宝页面没有返回 page data。纯插件模式可能被页面结构或 Chrome 请求限制影响。");
  }

  if (pageData.err_code === "notInWX") {
    throw new Error(
      "元宝返回 notInWX：当前请求没有被识别为微信 WebView。纯 Chrome 插件可能无法稳定伪造 User-Agent，请尝试刷新页面；如果仍失败，说明该环境需要 Worker 版。",
    );
  }

  if (pageData.err_code && pageData.err_code !== 0) {
    throw new Error(pageData.err_msg || `元宝返回 err_code=${pageData.err_code}`);
  }

  const info = pageData.conversation_info || {};
  const conversations = extractConversations(info);
  const messages = conversations.map(toMessage).filter((message) => message.text);
  const answer = [...messages].reverse().find((message) => message.speaker === "ai") || {};
  const question = messages.find((message) => message.speaker === "human") || {};
  const shareCard = info.shareCardInfo || info.shareExtraDetailObj?.chatInfo?.[0]?.shareCardInfo || {};

  return {
    sourceUrl: shareUrl.toString(),
    shareId: pageProps.shareId || basename(shareUrl.pathname),
    title: shareCard.title || info.title || answer.title || "",
    description: shareCard.description || "",
    answerTime: shareCard.answerTime || "",
    questionText: question.text || "",
    answerText: answer.text || "",
    messages,
    images: extractImages(conversations),
    meta: {
      errCode: pageData.err_code,
      expireTime: info.expireTime || null,
      backendTraceId: pageProps.backendTraceId || "",
      mode: "pure-extension",
    },
  };
}

function normalizeShareUrl(inputUrl) {
  let url;
  try {
    url = new URL(inputUrl);
  } catch {
    throw new Error("无效 URL");
  }

  if (!["yb.tencent.com", "yuanbao.tencent.com"].includes(url.hostname)) {
    throw new Error("只支持 yb.tencent.com 和 yuanbao.tencent.com");
  }

  if (!url.pathname.startsWith("/wx/ct/")) {
    throw new Error("只支持 /wx/ct/ 分享链接");
  }

  return url;
}

function readNextData(html) {
  const match = html.match(
    /<script id="__NEXT_DATA__" type="application\/json"[^>]*>([\s\S]*?)<\/script>/,
  );
  if (!match) {
    throw new Error("找不到 __NEXT_DATA__。纯插件模式可能只拿到了限制页。");
  }

  try {
    return JSON.parse(unescapeHtml(match[1]));
  } catch {
    throw new Error("无法解析 __NEXT_DATA__ JSON");
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
  return {
    speaker: conv.speaker || "",
    text: extractText(conv),
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

function unescapeHtml(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
