const DEFAULT_WORKER_URL = "https://your-worker.workers.dev";

main().catch((error) => {
  renderShell();
  renderError(error);
});

async function main() {
  if (!isYuanbaoShareUrl(location.href)) return;

  const settings = await getSettings();
  if (!settings.enabled) return;

  renderShell();
  setStatus("正在通过 Worker 解析元宝分享内容...");

  const result = await parseCurrentPage(settings.workerBaseUrl);
  renderArticle(result, settings.workerBaseUrl);
}

function isYuanbaoShareUrl(url) {
  try {
    const parsed = new URL(url);
    return (
      ["yb.tencent.com", "yuanbao.tencent.com"].includes(parsed.hostname) &&
      parsed.pathname.startsWith("/wx/ct/")
    );
  } catch {
    return false;
  }
}

function getSettings() {
  return chrome.storage.sync.get({
    enabled: true,
    workerBaseUrl: DEFAULT_WORKER_URL,
  });
}

async function parseCurrentPage(workerBaseUrl) {
  const normalizedWorkerBaseUrl = normalizeWorkerBaseUrl(workerBaseUrl);
  const message = {
    type: "OPEN_YB_PARSE",
    workerBaseUrl: normalizedWorkerBaseUrl,
    sourceUrl: location.href,
  };
  const response = await chrome.runtime.sendMessage(message).catch((error) => ({
    ok: false,
    error: error.message || String(error),
  }));

  if (response?.ok) {
    return response.data;
  }

  const directResponse = await parseViaDirectFetch(normalizedWorkerBaseUrl).catch((error) => ({
    ok: false,
    error: error.message || String(error),
  }));
  if (directResponse?.ok) {
    return directResponse.data;
  }

  const jsonpResponse = await parseViaJsonp(normalizedWorkerBaseUrl).catch((error) => ({
    ok: false,
    error: error.message || String(error),
  }));
  if (jsonpResponse?.ok) {
    return jsonpResponse.data;
  }

  const error = new Error(
    [
      "无法连接 Worker。",
      `后台请求：${response?.error || "失败"}`,
      `直接请求：${directResponse?.error || "失败"}`,
      `JSONP 桥接：${jsonpResponse?.error || "失败"}`,
    ].join("\n"),
  );
  error.endpoint = response?.endpoint || buildParseEndpoint(normalizedWorkerBaseUrl, location.href);
  throw error;
}

async function parseViaDirectFetch(workerBaseUrl) {
  const endpoint = buildParseEndpoint(workerBaseUrl, location.href);
  const response = await fetch(endpoint, {
    method: "GET",
    headers: { accept: "application/json" },
    credentials: "omit",
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.error) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }

  return { ok: true, data };
}

function parseViaJsonp(workerBaseUrl) {
  return new Promise((resolve, reject) => {
    const id = `open-yb-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const endpoint = buildJsonpEndpoint(workerBaseUrl, location.href, id);
    const script = document.createElement("script");
    let settled = false;

    const cleanup = () => {
      window.removeEventListener("message", handleMessage);
      script.remove();
    };

    const finish = (callback) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };

    const timer = setTimeout(() => {
      finish(() => reject(new Error("JSONP 请求超时")));
    }, 15000);

    const handleMessage = (event) => {
      if (event.source !== window) return;
      if (event.data?.source !== "OPEN_YB_JSONP" || event.data?.id !== id) return;

      clearTimeout(timer);
      finish(() => {
        if (event.data.ok) {
          resolve({ ok: true, data: event.data.data });
        } else {
          reject(new Error(event.data.error || "JSONP 解析失败"));
        }
      });
    };

    window.addEventListener("message", handleMessage);
    script.src = endpoint;
    script.async = true;
    script.onerror = () => {
      clearTimeout(timer);
      finish(() => reject(new Error("JSONP 脚本加载失败，可能被页面 CSP 拦截")));
    };
    document.documentElement.appendChild(script);
  });
}

function normalizeWorkerBaseUrl(value) {
  const trimmed = String(value || DEFAULT_WORKER_URL).trim().replace(/\/+$/, "");
  if (!trimmed) return DEFAULT_WORKER_URL;

  try {
    const url = new URL(trimmed);
    url.hostname = url.hostname.replace(/\.+$/, "");
    url.pathname = url.pathname.replace(/\/+$/, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return trimmed.replace(/\.+$/, "");
  }
}

function buildParseEndpoint(workerBaseUrl, sourceUrl) {
  const baseUrl = normalizeWorkerBaseUrl(workerBaseUrl);
  return `${baseUrl}/api/parse?url=${encodeURIComponent(sourceUrl)}`;
}

function buildJsonpEndpoint(workerBaseUrl, sourceUrl, id) {
  const baseUrl = normalizeWorkerBaseUrl(workerBaseUrl);
  const params = new URLSearchParams({
    url: sourceUrl,
    jsonp: "1",
    id,
    targetOrigin: location.origin,
  });
  return `${baseUrl}/api/parse?${params.toString()}`;
}

function renderShell() {
  document.documentElement.classList.add("open-yb-root");
  document.title = "Open YB";
  document.body.innerHTML = `
    <main class="oyb-page">
      <section class="oyb-reader">
        <div class="oyb-toolbar">
          <div>
            <p class="oyb-kicker">Open YB</p>
            <h1 id="oyb-title">正在解析</h1>
          </div>
          <div class="oyb-actions">
            <button id="oyb-copy" type="button" disabled>复制正文</button>
            <button id="oyb-save" type="button" disabled>收藏</button>
            <button id="oyb-download" type="button" disabled>导出 MD</button>
            <button id="oyb-options" type="button">设置</button>
          </div>
        </div>
        <p id="oyb-status" class="oyb-status">准备中...</p>
        <article id="oyb-content" class="oyb-content"></article>
      </section>
    </main>
  `;

  document.getElementById("oyb-options").addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });
}

function renderArticle(item) {
  const normalized = normalizeItem(item);
  document.title = normalized.title ? `${normalized.title} - Open YB` : "Open YB";
  document.getElementById("oyb-title").textContent = normalized.title || "元宝分享内容";
  setStatus(`来源：${normalized.sourceUrl}`);

  const content = document.getElementById("oyb-content");
  content.innerHTML = "";

  if (normalized.questionText) {
    content.appendChild(renderBlock("问题", normalized.questionText));
  }

  if (normalized.answerText) {
    content.appendChild(renderBlock("回答", normalized.answerText));
  } else {
    content.appendChild(renderBlock("回答", "未解析到回答正文。"));
  }

  if (normalized.answerTime || normalized.description) {
    const meta = [normalized.answerTime, normalized.description].filter(Boolean).join("\n");
    content.appendChild(renderBlock("摘要", meta));
  }

  wireArticleActions(normalized);
}

function renderBlock(title, text) {
  const section = document.createElement("section");
  section.className = "oyb-block";

  const heading = document.createElement("h2");
  heading.textContent = title;

  const pre = document.createElement("pre");
  pre.textContent = text;

  section.append(heading, pre);
  return section;
}

function wireArticleActions(item) {
  const copyButton = document.getElementById("oyb-copy");
  const saveButton = document.getElementById("oyb-save");
  const downloadButton = document.getElementById("oyb-download");

  copyButton.disabled = false;
  saveButton.disabled = false;
  downloadButton.disabled = false;

  copyButton.addEventListener("click", async () => {
    await navigator.clipboard.writeText(item.answerText || itemToMarkdown(item));
    setStatus("已复制正文。");
  });

  saveButton.addEventListener("click", async () => {
    await saveFavorite(item);
    saveButton.textContent = "已收藏";
    setStatus("已保存到 Open YB 收藏库。");
  });

  downloadButton.addEventListener("click", () => {
    downloadMarkdown(`${safeFileName(item.title || item.shareId || "yuanbao")}.md`, itemToMarkdown(item));
    setStatus("已生成 Markdown 文件。");
  });
}

function normalizeItem(item) {
  const savedAt = item.savedAt || new Date().toISOString();
  return {
    id: item.id || item.shareId || hashText(item.sourceUrl || location.href),
    sourceUrl: item.sourceUrl || location.href,
    shareId: item.shareId || "",
    title: item.title || "",
    description: item.description || "",
    answerTime: item.answerTime || "",
    questionText: item.questionText || "",
    answerText: item.answerText || "",
    savedAt,
  };
}

async function saveFavorite(item) {
  const normalized = normalizeItem(item);
  const { favorites = [] } = await chrome.storage.local.get({ favorites: [] });
  const next = [
    normalized,
    ...favorites.filter((favorite) => favorite.sourceUrl !== normalized.sourceUrl && favorite.id !== normalized.id),
  ];
  await chrome.storage.local.set({ favorites: next });
}

function itemToMarkdown(item) {
  const lines = [
    `# ${item.title || "元宝分享内容"}`,
    "",
    `来源：${item.sourceUrl || ""}`,
    item.answerTime ? `时间：${item.answerTime}` : "",
    item.savedAt ? `保存：${formatDate(item.savedAt)}` : "",
    "",
  ].filter((line, index, array) => line || array[index - 1] !== "");

  if (item.questionText) {
    lines.push("## 问题", "", item.questionText, "");
  }

  if (item.answerText) {
    lines.push("## 回答", "", item.answerText, "");
  }

  return `${lines.join("\n").trim()}\n`;
}

function downloadMarkdown(fileName, markdown) {
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function setStatus(message) {
  const status = document.getElementById("oyb-status");
  if (status) status.textContent = message;
}

function renderError(error) {
  document.getElementById("oyb-title").textContent = "解析失败";
  setStatus(error.message || String(error));
  const content = document.getElementById("oyb-content");
  const endpoint = error.endpoint || "";
  content.innerHTML = `
    <section class="oyb-block">
      <h2>处理建议</h2>
      <pre>${[
        "请先确认 Worker 地址能在当前 Chrome 中直接打开。",
        "如果测试地址能打开但插件仍失败，请在 chrome://extensions/ 里重新加载 Open YB。",
        "如果 workers.dev 被网络阻断，请给 Worker 绑定一个可访问的自定义域名，再填到插件设置里。",
        endpoint ? `测试地址：${endpoint}` : "",
      ]
        .filter(Boolean)
        .join("\n")}</pre>
    </section>
  `;
}

function safeFileName(value) {
  return String(value)
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 80) || "yuanbao";
}

function formatDate(value) {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function hashText(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return `yb-${hash.toString(16)}`;
}
