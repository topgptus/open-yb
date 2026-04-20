let favorites = [];
let visibleFavorites = [];

const enabled = document.getElementById("enabled");
const autoSave = document.getElementById("auto-save");
const status = document.getElementById("options-status");
const list = document.getElementById("favorites-list");
const searchInput = document.getElementById("search");
const tagFilter = document.getElementById("tag-filter");
const sourceFilter = document.getElementById("source-filter");
const dateFilter = document.getElementById("date-filter");
const customDate = document.getElementById("custom-date");

init();

async function init() {
  const settings = await chrome.storage.sync.get({ enabled: true, autoSave: false });
  enabled.checked = settings.enabled;
  autoSave.checked = settings.autoSave;
  await loadFavorites({ persist: true });

  document.getElementById("save-settings").addEventListener("click", saveSettings);
  document.getElementById("select-all").addEventListener("click", selectAll);
  document.getElementById("batch-download-selected").addEventListener("click", batchDownloadSelected);
  document.getElementById("merge-download-selected").addEventListener("click", mergeDownloadSelected);
  document.getElementById("delete-selected").addEventListener("click", deleteSelected);
  document.getElementById("clear-filters").addEventListener("click", clearFilters);
  searchInput.addEventListener("input", renderFavorites);
  tagFilter.addEventListener("change", renderFavorites);
  sourceFilter.addEventListener("change", renderFavorites);
  dateFilter.addEventListener("change", renderFavorites);
  customDate.addEventListener("change", renderFavorites);
  window.addEventListener("focus", () => loadFavorites({ persist: false }));
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) loadFavorites({ persist: false });
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.favorites) return;
    favorites = dedupeFavorites((changes.favorites.newValue || []).map(normalizeFavorite));
    renderTagFilter();
    renderFavorites();
  });
}

async function saveSettings() {
  await chrome.storage.sync.set({ enabled: enabled.checked, autoSave: autoSave.checked });
  const response = await chrome.runtime.sendMessage({ type: "OPEN_YB_SYNC_RULE" }).catch((error) => ({
    ok: false,
    error: error.message || String(error),
  }));
  setStatus(response?.ok ? "设置已保存。" : `设置已保存，但同步请求头规则失败：${response?.error || "未知错误"}`);
}

async function loadFavorites({ persist = false } = {}) {
  const data = await chrome.storage.local.get({ favorites: [] });
  const nextFavorites = dedupeFavorites(data.favorites.map(normalizeFavorite));
  const shouldPersist = persist && JSON.stringify(nextFavorites) !== JSON.stringify(data.favorites);
  favorites = nextFavorites;
  if (shouldPersist) await chrome.storage.local.set({ favorites });
  renderTagFilter();
  renderFavorites();
}

function renderFavorites() {
  visibleFavorites = filteredFavorites();
  list.innerHTML = "";
  if (favorites.length === 0) {
    list.innerHTML = `<p class="oyb-empty">还没有收藏。打开元宝分享页后点击“收藏”，或开启“打开元宝链接后自动收藏”。</p>`;
    setStatus("收藏 0 篇。");
    return;
  }
  if (visibleFavorites.length === 0) {
    list.innerHTML = `<p class="oyb-empty">当前筛选没有匹配内容。</p>`;
    setStatus(`收藏 ${favorites.length} 篇，当前筛选 0 篇。`);
    return;
  }

  setStatus(`收藏 ${favorites.length} 篇，当前筛选 ${visibleFavorites.length} 篇。`);
  for (const item of visibleFavorites) {
    const row = document.createElement("article");
    row.className = "oyb-favorite";
    row.innerHTML = `
      <label class="oyb-check">
        <input type="checkbox" value="${escapeAttr(item.id)}">
        <span></span>
      </label>
      <div class="oyb-favorite-main">
        <div class="oyb-source-type">${escapeHtml(sourceTypeLabel(item.sourceType))}</div>
        <h2>${escapeHtml(item.title || "元宝分享内容")}</h2>
        <p>${escapeHtml(item.questionText || item.description || "无问题摘要")}</p>
        ${renderTags(item.tags)}
        <a href="${escapeAttr(item.sourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(item.sourceUrl)}</a>
        <time>${escapeHtml(formatDate(item.savedAt || item.createdAt || item.updatedAt))}</time>
      </div>
      <div class="oyb-favorite-actions">
        <button type="button" data-action="copy" data-id="${escapeAttr(item.id)}">复制</button>
        <button type="button" data-action="download" data-id="${escapeAttr(item.id)}">单篇导出</button>
        <button type="button" data-action="edit-tags" data-id="${escapeAttr(item.id)}">编辑标签</button>
        <button type="button" data-action="delete-one" data-id="${escapeAttr(item.id)}" class="oyb-danger">删除</button>
      </div>
    `;
    list.appendChild(row);
  }

  list.querySelectorAll("button[data-action]").forEach((button) => {
    button.addEventListener("click", handleRowAction);
  });
  list.querySelectorAll("button[data-tag]").forEach((button) => {
    button.addEventListener("click", () => {
      tagFilter.value = button.dataset.tag || "";
      renderFavorites();
    });
  });
}

function renderTags(tags) {
  const normalized = normalizeTags(tags || []);
  if (normalized.length === 0) return `<div class="oyb-tags oyb-tags-empty">无标签</div>`;
  return `
    <div class="oyb-tags">
      ${normalized.map((tag) => `<button type="button" data-tag="${escapeAttr(tag)}">#${escapeHtml(tag)}</button>`).join("")}
    </div>
  `;
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
  if (event.currentTarget.dataset.action === "edit-tags") {
    await editTags(item);
  }
  if (event.currentTarget.dataset.action === "delete-one") {
    await removeFavorites([id]);
  }
}

async function editTags(item) {
  const raw = prompt("编辑标签，用空格、逗号或 # 分隔：", normalizeTags(item.tags || []).map((tag) => `#${tag}`).join(" "));
  if (raw === null) return;
  const tags = normalizeTags(raw.split(/[\s,，、#]+/));
  favorites = favorites.map((favorite) => (
    favorite.id === item.id
      ? { ...favorite, tags, updatedAt: new Date().toISOString() }
      : favorite
  ));
  await chrome.storage.local.set({ favorites });
  renderTagFilter();
  renderFavorites();
  setStatus("标签已更新。");
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
  renderTagFilter();
  renderFavorites();
  setStatus(`已删除 ${ids.length} 篇。`);
}

function selectedFavorites() {
  const ids = new Set([...list.querySelectorAll('input[type="checkbox"]:checked')].map((box) => box.value));
  return visibleFavorites.filter((item) => ids.has(item.id));
}

function filteredFavorites() {
  const keyword = searchInput.value.trim().toLocaleLowerCase();
  const selectedTag = tagFilter.value;
  const selectedSource = sourceFilter.value;
  return favorites.filter((item) => {
    if (keyword) {
      const haystack = [
        item.title,
        item.description,
        item.questionText,
        item.answerText,
        item.sourceUrl,
        ...(item.tags || []),
      ].join("\n").toLocaleLowerCase();
      if (!haystack.includes(keyword)) return false;
    }
    if (selectedTag && !normalizeTags(item.tags || []).includes(selectedTag)) return false;
    if (selectedSource !== "all" && normalizeSourceType(item) !== selectedSource) return false;
    return matchesDateFilter(item);
  });
}

function matchesDateFilter(item) {
  const mode = dateFilter.value;
  if (mode === "all") return true;
  const date = new Date(item.savedAt || item.createdAt || item.updatedAt || 0);
  if (Number.isNaN(date.getTime())) return false;
  const start = startOfDay(new Date());
  const itemDay = startOfDay(date);

  if (mode === "today") return itemDay.getTime() === start.getTime();
  if (mode === "yesterday") {
    const yesterday = addDays(start, -1);
    return itemDay.getTime() === yesterday.getTime();
  }
  if (mode === "7days") return itemDay >= addDays(start, -6);
  if (mode === "month") {
    return itemDay.getFullYear() === start.getFullYear() && itemDay.getMonth() === start.getMonth();
  }
  if (mode === "custom") {
    return customDate.value && formatDateOnly(itemDay) === customDate.value;
  }
  return true;
}

function clearFilters() {
  searchInput.value = "";
  tagFilter.value = "";
  sourceFilter.value = "all";
  dateFilter.value = "all";
  customDate.value = "";
  renderFavorites();
}

function renderTagFilter() {
  const current = tagFilter.value;
  const tags = [...new Set(favorites.flatMap((item) => normalizeTags(item.tags || [])))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  tagFilter.innerHTML = `<option value="">全部标签</option>${tags.map((tag) => `<option value="${escapeAttr(tag)}">#${escapeHtml(tag)}</option>`).join("")}`;
  tagFilter.value = tags.includes(current) ? current : "";
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
  const tags = normalizeTags(item.tags || []);
  const lines = [
    "---",
    `title: ${yamlValue(item.title || "元宝分享内容")}`,
    `source: ${yamlValue(item.sourceUrl || "")}`,
    item.savedAt ? `created: ${formatDateOnly(new Date(item.savedAt))}` : "",
    tags.length ? "tags:" : "",
    ...tags.map((tag) => `  - ${tag}`),
    "---",
    "",
    `## ${item.title || "元宝分享内容"}`,
    "",
    `来源：${item.sourceUrl || ""}`,
    item.answerTime ? `时间：${item.answerTime}` : "",
    item.savedAt ? `保存：${formatDate(item.savedAt)}` : "",
    tags.length ? `标签：${tags.map((tag) => `#${tag}`).join(" ")}` : "",
    "",
  ].filter((line, index, array) => line || array[index - 1] !== "");
  if (item.questionText) lines.push("### 问题", "", item.questionText, "");
  if (item.answerText) lines.push("### 回答", "", item.answerText, "");
  return `${lines.join("\n").trim()}\n`;
}

function normalizeFavorite(item) {
  const text = `${item.questionText || ""}\n${item.answerText || ""}\n${item.description || ""}`;
  const sourceUrl = normalizeSourceUrl(item.sourceUrl || "");
  const sourceType = normalizeSourceType(item);
  const tags = sourceType === "webpage"
    ? normalizeTags(item.tags || [])
    : normalizeTags([...(item.tags || []), ...extractTags(text)]);
  const now = new Date().toISOString();
  return {
    ...item,
    id: item.id || item.shareId || hashText(sourceUrl),
    sourceType,
    sourceUrl,
    tags,
    savedAt: item.savedAt || item.createdAt || now,
    createdAt: item.createdAt || item.savedAt || now,
    updatedAt: item.updatedAt || item.savedAt || now,
  };
}

function normalizeSourceType(item) {
  if (item.sourceType === "webpage") return "webpage";
  return "yuanbao";
}

function sourceTypeLabel(type) {
  return type === "webpage" ? "网页剪藏" : "元宝分享";
}

function dedupeFavorites(items) {
  const result = [];
  for (const item of items) {
    const index = result.findIndex((existing) => isSameFavorite(existing, item));
    if (index === -1) {
      result.push(item);
      continue;
    }
    result[index] = {
      ...result[index],
      ...item,
      id: result[index].id || item.id,
      savedAt: result[index].savedAt || item.savedAt,
      createdAt: result[index].createdAt || result[index].savedAt || item.createdAt,
      updatedAt: item.updatedAt || result[index].updatedAt,
      tags: normalizeTags([...(result[index].tags || []), ...(item.tags || [])]),
    };
  }
  return result;
}

function isSameFavorite(left, right) {
  if (left.shareId && right.shareId && left.shareId === right.shareId) return true;
  if (left.id && right.id && left.id === right.id) return true;
  return normalizeSourceUrl(left.sourceUrl || "") === normalizeSourceUrl(right.sourceUrl || "");
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
  status.textContent = message;
}

function normalizeSourceUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    url.search = "";
    return url.toString();
  } catch {
    return String(value || "");
  }
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

function formatDateOnly(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function yamlValue(value) {
  return JSON.stringify(String(value || ""));
}

function hashText(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return `yb-${hash.toString(16)}`;
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
