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

  if (message?.type === "OPEN_YB_OPEN_OPTIONS") {
    chrome.runtime.openOptionsPage()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }

  if (message?.type === "OPEN_YB_SAVE_CURRENT_PAGE") {
    saveCurrentPage()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }

  return false;
});

async function saveCurrentPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !/^https?:\/\//.test(tab.url)) {
    throw new Error("当前页面不是可保存的网页。");
  }

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: extractCurrentPage,
  });
  if (!result?.markdown) {
    throw new Error("没有提取到可保存的网页内容。");
  }

  const item = normalizeWebPageItem(result);
  return saveFavorite(item);
}

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
    throw new Error("元宝页面没有返回 page data。可能是页面结构变化，或当前 Chrome 请求环境被元宝识别为非微信环境。");
  }

  if (pageData.err_code === "notInWX") {
    throw new Error(
      "元宝返回 notInWX：当前请求没有被识别为微信 WebView。请尝试刷新页面；如果仍失败，可以改用本地 agent skill 解析。",
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
      mode: "chrome-extension",
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
    throw new Error("找不到 __NEXT_DATA__。可能只拿到了限制页。");
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

function normalizeWebPageItem(page) {
  const now = new Date().toISOString();
  const sourceUrl = normalizeStoredUrl(page.sourceUrl || "");
  const title = page.title || "网页剪藏";
  return {
    id: `web-${hashText(sourceUrl || title)}`,
    sourceType: "webpage",
    sourceUrl,
    shareId: "",
    title,
    description: page.description || "",
    answerTime: "",
    questionText: page.selection ? "当前网页选中文本" : "",
    answerText: page.markdown || page.text || "",
    tags: [],
    savedAt: now,
    createdAt: now,
    updatedAt: now,
    meta: {
      mode: "webpage-clipper",
      clippedBy: "open-yb",
      usedSelection: Boolean(page.selection),
    },
  };
}

async function saveFavorite(item) {
  const { favorites = [] } = await chrome.storage.local.get({ favorites: [] });
  const existing = favorites.find((favorite) => isSameFavorite(favorite, item));
  const merged = existing
    ? {
        ...existing,
        ...item,
        id: existing.id || item.id,
        savedAt: existing.savedAt || item.savedAt,
        createdAt: existing.createdAt || existing.savedAt || item.createdAt,
        updatedAt: new Date().toISOString(),
        tags: normalizeTags([...(existing.tags || []), ...(item.tags || [])]),
      }
    : item;
  const next = [
    merged,
    ...favorites.filter((favorite) => !isSameFavorite(favorite, item)),
  ];
  await chrome.storage.local.set({ favorites: next });
  return { created: !existing, item: merged };
}

function isSameFavorite(left, right) {
  if (left.shareId && right.shareId && left.shareId === right.shareId) return true;
  if (left.id && right.id && left.id === right.id) return true;
  return normalizeStoredUrl(left.sourceUrl || "") === normalizeStoredUrl(right.sourceUrl || "");
}

function normalizeStoredUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    url.search = "";
    return url.toString();
  } catch {
    return String(value || "");
  }
}

function extractTags(text) {
  const tags = [];
  const regex = /#([\u4e00-\u9fa5A-Za-z0-9_\-/.]+)/g;
  let match;
  while ((match = regex.exec(text || "")) && tags.length < 60) {
    tags.push(match[1]);
  }
  return normalizeTags(tags).slice(0, 30);
}

function normalizeTags(tags) {
  const seen = new Set();
  const result = [];
  for (const raw of tags || []) {
    const tag = String(raw || "")
      .replace(/^#+/, "")
      .replace(/[，。；;、,.!?！？：:]+$/g, "")
      .trim();
    if (tag.length < 2 || tag.length > 32) continue;
    const key = tag.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
  }
  return result;
}

function hashText(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return `yb-${hash.toString(16)}`;
}

function extractCurrentPage() {
  const sourceUrl = location.href;
  const title = document.title || document.querySelector("h1")?.textContent?.trim() || "网页剪藏";
  const description = document.querySelector('meta[name="description"]')?.content ||
    document.querySelector('meta[property="og:description"]')?.content ||
    "";
  const selection = String(window.getSelection?.() || "").trim();
  const root = selection ? null : pickContentRoot();
  const markdown = selection
    ? selection
    : htmlToMarkdown(root ? root.cloneNode(true) : document.body.cloneNode(true));
  const clipped = [
    `# ${title}`,
    "",
    `来源：${sourceUrl}`,
    description ? `摘要：${description}` : "",
    "",
    markdown,
  ].filter(Boolean).join("\n").trim();

  return {
    sourceUrl,
    title,
    description,
    selection,
    text: selection || (root?.innerText || document.body.innerText || "").slice(0, 50000),
    markdown: clipped,
    tags: [],
  };

  function pickContentRoot() {
    const candidates = [
      document.querySelector("article"),
      document.querySelector("main"),
      document.querySelector('[role="main"]'),
      document.querySelector(".article"),
      document.querySelector(".post"),
      document.body,
    ].filter(Boolean);
    return candidates.sort((a, b) => scoreNode(b) - scoreNode(a))[0] || document.body;
  }

  function scoreNode(node) {
    const textLength = (node.innerText || "").trim().length;
    const paragraphCount = node.querySelectorAll?.("p, li, pre, blockquote").length || 0;
    return textLength + paragraphCount * 120;
  }

  function htmlToMarkdown(node) {
    cleanup(node);
    return normalizeMarkdown(walk(node)).slice(0, 80000);
  }

  function cleanup(node) {
    node.querySelectorAll("script, style, noscript, iframe, nav, header, footer, aside, form, button, input, textarea, select, svg").forEach((el) => el.remove());
  }

  function walk(node) {
    if (!node) return "";
    if (node.nodeType === Node.TEXT_NODE) return node.textContent.replace(/\s+/g, " ");
    if (node.nodeType !== Node.ELEMENT_NODE) return "";

    const tag = node.tagName.toLowerCase();
    const children = () => [...node.childNodes].map(walk).join("").trim();
    const text = () => children();

    if (/^h[1-6]$/.test(tag)) {
      const level = Number(tag.slice(1));
      return `\n\n${"#".repeat(level)} ${text()}\n\n`;
    }
    if (tag === "p") return `\n\n${text()}\n\n`;
    if (tag === "br") return "\n";
    if (tag === "strong" || tag === "b") return `**${text()}**`;
    if (tag === "em" || tag === "i") return `*${text()}*`;
    if (tag === "code") return node.closest("pre") ? node.textContent : `\`${node.textContent.trim()}\``;
    if (tag === "pre") return `\n\n\`\`\`\n${node.textContent.replace(/\n{3,}/g, "\n\n").trim()}\n\`\`\`\n\n`;
    if (tag === "blockquote") return `\n\n${text().split("\n").map((line) => `> ${line}`).join("\n")}\n\n`;
    if (tag === "a") {
      const label = text() || node.href;
      return node.href ? `[${label}](${node.href})` : label;
    }
    if (tag === "img") {
      const src = node.currentSrc || node.src || node.getAttribute("src") || "";
      if (!src) return "";
      const alt = node.alt || "image";
      return `\n\n![${alt}](${src})\n\n`;
    }
    if (tag === "ul" || tag === "ol") {
      return `\n${[...node.children].filter((child) => child.tagName?.toLowerCase() === "li").map((li, index) => {
        const marker = tag === "ol" ? `${index + 1}.` : "-";
        return `${marker} ${walk(li).trim().replace(/\n+/g, "\n  ")}`;
      }).join("\n")}\n`;
    }
    if (tag === "li") return text();
    if (tag === "table") return tableToMarkdown(node);
    if (["div", "section", "main", "article"].includes(tag)) return `\n${children()}\n`;
    return children();
  }

  function tableToMarkdown(table) {
    const rows = [...table.querySelectorAll("tr")].map((tr) => [...tr.children].map((cell) => cell.innerText.trim().replace(/\s+/g, " ")));
    if (!rows.length) return "";
    const header = rows[0];
    const separator = header.map(() => "---");
    const body = rows.slice(1);
    return `\n\n| ${header.join(" | ")} |\n| ${separator.join(" | ")} |\n${body.map((row) => `| ${row.join(" | ")} |`).join("\n")}\n\n`;
  }

  function normalizeMarkdown(value) {
    return value
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{4,}/g, "\n\n\n")
      .replace(/^\s+|\s+$/g, "")
      .trim();
  }

}
