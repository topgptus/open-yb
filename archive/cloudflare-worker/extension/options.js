const DEFAULT_WORKER_URL = "https://your-worker.workers.dev";

let favorites = [];

const enabled = document.getElementById("enabled");
const workerUrl = document.getElementById("worker-url");
const status = document.getElementById("options-status");
const list = document.getElementById("favorites-list");

init();

async function init() {
  await loadSettings();
  await loadFavorites();

  document.getElementById("save-settings").addEventListener("click", saveSettings);
  document.getElementById("select-all").addEventListener("click", selectAll);
  document.getElementById("batch-download-selected").addEventListener("click", batchDownloadSelected);
  document.getElementById("merge-download-selected").addEventListener("click", mergeDownloadSelected);
  document.getElementById("delete-selected").addEventListener("click", deleteSelected);
}

async function loadSettings() {
  const settings = await chrome.storage.sync.get({
    enabled: true,
    workerBaseUrl: DEFAULT_WORKER_URL,
  });
  enabled.checked = settings.enabled;
  workerUrl.value = settings.workerBaseUrl;
}

async function saveSettings() {
  const nextUrl = normalizeWorkerBaseUrl(workerUrl.value);
  const granted = await requestWorkerPermission(nextUrl);
  if (!granted) {
    setStatus("未获得该 Worker 域名权限，插件可能无法请求这个地址。");
    return;
  }

  await chrome.storage.sync.set({
    enabled: enabled.checked,
    workerBaseUrl: nextUrl,
  });
  workerUrl.value = nextUrl;
  setStatus("设置已保存。");
}

async function requestWorkerPermission(workerBaseUrl) {
  const origin = workerOriginPattern(workerBaseUrl);
  if (!origin) return false;
  const permission = { origins: [origin] };
  const hasPermission = await chrome.permissions.contains(permission);
  if (hasPermission) return true;
  return chrome.permissions.request(permission);
}

function workerOriginPattern(workerBaseUrl) {
  try {
    return `${new URL(workerBaseUrl).origin}/*`;
  } catch {
    return "";
  }
}

async function loadFavorites() {
  const data = await chrome.storage.local.get({ favorites: [] });
  favorites = data.favorites;
  renderFavorites();
}

function renderFavorites() {
  list.innerHTML = "";

  if (favorites.length === 0) {
    list.innerHTML = `<p class="oyb-empty">还没有收藏。打开元宝分享页后点击“收藏”。</p>`;
    setStatus("收藏 0 篇。");
    return;
  }

  setStatus(`收藏 ${favorites.length} 篇。`);
  for (const item of favorites) {
    const row = document.createElement("article");
    row.className = "oyb-favorite";
    row.innerHTML = `
      <label class="oyb-check">
        <input type="checkbox" value="${escapeAttr(item.id)}">
        <span></span>
      </label>
      <div class="oyb-favorite-main">
        <h2>${escapeHtml(item.title || "元宝分享内容")}</h2>
        <p>${escapeHtml(item.questionText || item.description || "无问题摘要")}</p>
        <a href="${escapeAttr(item.sourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(item.sourceUrl)}</a>
        <time>${escapeHtml(formatDate(item.savedAt))}</time>
      </div>
      <div class="oyb-favorite-actions">
        <button type="button" data-action="copy" data-id="${escapeAttr(item.id)}">复制</button>
        <button type="button" data-action="download" data-id="${escapeAttr(item.id)}">单篇导出</button>
        <button type="button" data-action="delete-one" data-id="${escapeAttr(item.id)}" class="oyb-danger">删除</button>
      </div>
    `;
    list.appendChild(row);
  }

  list.querySelectorAll("button[data-action]").forEach((button) => {
    button.addEventListener("click", handleRowAction);
  });
}

async function handleRowAction(event) {
  const id = event.currentTarget.dataset.id;
  const item = favorites.find((favorite) => favorite.id === id);
  if (!item) return;

  if (event.currentTarget.dataset.action === "copy") {
    await navigator.clipboard.writeText(itemToMarkdown(item));
    setStatus("已复制这篇 Markdown。");
  }

  if (event.currentTarget.dataset.action === "download") {
    downloadMarkdown(`${safeFileName(item.title || item.shareId || "yuanbao")}.md`, itemToMarkdown(item));
    setStatus("已导出这篇 Markdown。");
  }

  if (event.currentTarget.dataset.action === "delete-one") {
    await removeFavorites([id]);
  }
}

function selectAll() {
  const boxes = [...list.querySelectorAll('input[type="checkbox"]')];
  const shouldCheck = boxes.some((box) => !box.checked);
  boxes.forEach((box) => {
    box.checked = shouldCheck;
  });
}

function batchDownloadSelected() {
  const selected = selectedFavorites();
  if (selected.length === 0) {
    setStatus("请先勾选要批量导出的内容。");
    return;
  }
  selected.forEach((item, index) => {
    const fileName = `${String(index + 1).padStart(2, "0")}-${safeFileName(item.title || item.shareId || "yuanbao")}.md`;
    window.setTimeout(() => downloadMarkdown(fileName, itemToMarkdown(item)), index * 120);
  });
  setStatus(`已开始批量导出 ${selected.length} 篇 Markdown。`);
}

function mergeDownloadSelected() {
  const selected = selectedFavorites();
  if (selected.length === 0) {
    setStatus("请先勾选要合并导出的内容。");
    return;
  }
  downloadMarkdown(`open-yb-${dateStamp()}.md`, collectionToMarkdown(selected));
  setStatus(`已导出 ${selected.length} 篇合并 Markdown。`);
}

async function deleteSelected() {
  const selected = selectedFavorites();
  if (selected.length === 0) {
    setStatus("请先勾选要删除的内容。");
    return;
  }
  await removeFavorites(selected.map((item) => item.id));
}

async function removeFavorites(ids) {
  const idSet = new Set(ids);
  favorites = favorites.filter((item) => !idSet.has(item.id));
  await chrome.storage.local.set({ favorites });
  renderFavorites();
  setStatus(`已删除 ${ids.length} 篇。`);
}

function selectedFavorites() {
  const ids = new Set([...list.querySelectorAll('input[type="checkbox"]:checked')].map((box) => box.value));
  return favorites.filter((item) => ids.has(item.id));
}

function collectionToMarkdown(items) {
  const header = [
    "# 元宝收藏合集",
    "",
    `导出时间：${formatDate(new Date().toISOString())}`,
    `篇数：${items.length}`,
    "",
  ].join("\n");
  return header + items.map(itemToMarkdown).join("\n---\n\n");
}

function itemToMarkdown(item) {
  const lines = [
    `## ${item.title || "元宝分享内容"}`,
    "",
    `来源：${item.sourceUrl || ""}`,
    item.answerTime ? `时间：${item.answerTime}` : "",
    item.savedAt ? `保存：${formatDate(item.savedAt)}` : "",
    "",
  ].filter((line, index, array) => line || array[index - 1] !== "");

  if (item.questionText) {
    lines.push("### 问题", "", item.questionText, "");
  }

  if (item.answerText) {
    lines.push("### 回答", "", item.answerText, "");
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

function normalizeWorkerBaseUrl(value) {
  const trimmed = String(value || DEFAULT_WORKER_URL).trim().replace(/\/+$/, "");
  try {
    const url = new URL(trimmed);
    url.hostname = url.hostname.replace(/\.+$/, "");
    return url.origin + url.pathname.replace(/\/+$/, "");
  } catch {
    return DEFAULT_WORKER_URL.replace(/\.+$/, "");
  }
}

function setStatus(message) {
  status.textContent = message;
}

function safeFileName(value) {
  return String(value)
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 80) || "yuanbao";
}

function dateStamp() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function formatDate(value) {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}
