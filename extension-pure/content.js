let parsedItem = null;

main().catch((error) => {
  renderFloatingToolbar();
  setToolbarState("error", error.message || String(error));
});

async function main() {
  if (!isYuanbaoShareUrl(location.href)) return;

  const { enabled = true } = await chrome.storage.sync.get({ enabled: true });
  if (!enabled) return;

  renderFloatingToolbar();
  setToolbarState("loading", "正在解析，页面会保持元宝原版显示...");
  await chrome.runtime.sendMessage({ type: "OPEN_YB_SYNC_RULE" }).catch(() => null);

  const response = await chrome.runtime.sendMessage({
    type: "OPEN_YB_PURE_PARSE",
    sourceUrl: location.href,
  });

  if (!response?.ok) {
    throw new Error(response?.error || "纯插件解析失败");
  }

  parsedItem = normalizeItem(response.data);
  setToolbarState("ready", parsedItem.title || "已解析，可复制、收藏或导出 MD");
  wireToolbarActions();
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

function renderFloatingToolbar() {
  const existing = document.getElementById("oyb-pure-tools");
  if (existing) return existing;

  const toolbar = document.createElement("aside");
  toolbar.id = "oyb-pure-tools";
  toolbar.className = "oyb-pure-tools";
  toolbar.innerHTML = `
    <div class="oyb-pure-head">
      <div>
        <p class="oyb-pure-kicker">Open YB Pure</p>
        <p id="oyb-pure-status" class="oyb-pure-status">准备中...</p>
      </div>
      <button id="oyb-pure-minimize" class="oyb-pure-icon" type="button" title="收起">-</button>
    </div>
    <div id="oyb-pure-actions" class="oyb-pure-actions">
      <button id="oyb-copy" type="button" disabled>复制正文</button>
      <button id="oyb-save" type="button" disabled>收藏</button>
      <button id="oyb-download" type="button" disabled>导出 MD</button>
      <button id="oyb-options" type="button">收藏库</button>
    </div>
  `;

  const host = document.body || document.documentElement;
  host.appendChild(toolbar);
  document.getElementById("oyb-pure-minimize").addEventListener("click", () => {
    toolbar.classList.toggle("is-collapsed");
  });
  document.getElementById("oyb-options").addEventListener("click", openOptionsPage);
  return toolbar;
}

function setToolbarState(state, message) {
  const toolbar = renderFloatingToolbar();
  toolbar.dataset.state = state;
  const status = document.getElementById("oyb-pure-status");
  if (status) status.textContent = message;
}

function wireToolbarActions() {
  const copyButton = document.getElementById("oyb-copy");
  const saveButton = document.getElementById("oyb-save");
  const downloadButton = document.getElementById("oyb-download");

  copyButton.disabled = false;
  saveButton.disabled = false;
  downloadButton.disabled = false;

  copyButton.addEventListener("click", async () => {
    await navigator.clipboard.writeText(parsedItem.answerText || itemToMarkdown(parsedItem));
    setToolbarState("ready", "已复制正文。");
  });
  saveButton.addEventListener("click", async () => {
    await saveFavorite(parsedItem);
    saveButton.textContent = "已收藏";
    setToolbarState("ready", "已保存到收藏库。");
  });
  downloadButton.addEventListener("click", () => {
    downloadMarkdown(`${safeFileName(parsedItem.title || parsedItem.shareId || "yuanbao")}.md`, itemToMarkdown(parsedItem));
    setToolbarState("ready", "已生成 Markdown 文件。");
  });
}

async function openOptionsPage() {
  const response = await chrome.runtime.sendMessage({ type: "OPEN_YB_OPEN_OPTIONS" }).catch((error) => ({
    ok: false,
    error: error.message || String(error),
  }));
  if (!response?.ok) {
    setToolbarState("error", response?.error || "无法打开收藏库。请从插件图标进入。");
  }
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
