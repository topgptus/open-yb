main().catch((error) => {
  renderShell();
  renderError(error);
});

async function main() {
  if (!isYuanbaoShareUrl(location.href)) return;

  const { enabled = true } = await chrome.storage.sync.get({ enabled: true });
  if (!enabled) return;

  renderShell();
  setStatus("正在用纯 Chrome 插件模式解析...");
  await chrome.runtime.sendMessage({ type: "OPEN_YB_SYNC_RULE" }).catch(() => null);

  const response = await chrome.runtime.sendMessage({
    type: "OPEN_YB_PURE_PARSE",
    sourceUrl: location.href,
  });

  if (!response?.ok) {
    throw new Error(response?.error || "纯插件解析失败");
  }

  renderArticle(response.data);
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

function renderShell() {
  document.documentElement.classList.add("open-yb-root");
  document.title = "Open YB Pure";
  document.body.innerHTML = `
    <main class="oyb-page">
      <section class="oyb-reader">
        <div class="oyb-toolbar">
          <div>
            <p class="oyb-kicker">Open YB Pure</p>
            <h1 id="oyb-title">正在解析</h1>
          </div>
          <div class="oyb-actions">
            <button id="oyb-copy" type="button" disabled>复制正文</button>
            <button id="oyb-save" type="button" disabled>收藏</button>
            <button id="oyb-download" type="button" disabled>导出 MD</button>
            <button id="oyb-options" type="button">收藏库</button>
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
  document.title = normalized.title ? `${normalized.title} - Open YB Pure` : "Open YB Pure";
  document.getElementById("oyb-title").textContent = normalized.title || "元宝分享内容";
  setStatus(`来源：${normalized.sourceUrl}`);

  const content = document.getElementById("oyb-content");
  content.innerHTML = "";

  if (normalized.questionText) {
    content.appendChild(renderBlock("问题", normalized.questionText));
  }
  content.appendChild(renderBlock("回答", normalized.answerText || "未解析到回答正文。"));
  if (normalized.answerTime || normalized.description) {
    content.appendChild(renderBlock("摘要", [normalized.answerTime, normalized.description].filter(Boolean).join("\n")));
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
    setStatus("已保存到 Open YB Pure 收藏库。");
  });
  downloadButton.addEventListener("click", () => {
    downloadMarkdown(`${safeFileName(item.title || item.shareId || "yuanbao")}.md`, itemToMarkdown(item));
    setStatus("已生成 Markdown 文件。");
  });
}

function normalizeItem(item) {
  return {
    id: item.id || item.shareId || hashText(item.sourceUrl || location.href),
    sourceUrl: item.sourceUrl || location.href,
    shareId: item.shareId || "",
    title: item.title || "",
    description: item.description || "",
    answerTime: item.answerTime || "",
    questionText: item.questionText || "",
    answerText: item.answerText || "",
    savedAt: item.savedAt || new Date().toISOString(),
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
    "",
  ].filter((line, index, array) => line || array[index - 1] !== "");
  if (item.questionText) lines.push("## 问题", "", item.questionText, "");
  if (item.answerText) lines.push("## 回答", "", item.answerText, "");
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
  document.getElementById("oyb-title").textContent = "纯插件解析失败";
  setStatus(error.message || String(error));
  const content = document.getElementById("oyb-content");
  content.innerHTML = `
    <section class="oyb-block">
      <h2>说明</h2>
      <pre>${[
        "纯插件版不依赖 Worker，但受 Chrome 扩展请求头限制影响。",
        "如果这里提示 notInWX，说明 Chrome 没能稳定把请求伪装成微信 WebView。",
        "这种情况下请继续使用 Worker 版插件，或使用本地 skill / Python 脚本。",
      ].join("\n")}</pre>
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

function hashText(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return `yb-${hash.toString(16)}`;
}
