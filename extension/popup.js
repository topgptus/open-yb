const enabled = document.getElementById("enabled");
const autoSave = document.getElementById("auto-save");
const status = document.getElementById("popup-status");

init();

async function init() {
  const settings = await chrome.storage.sync.get({ enabled: true, autoSave: false });
  enabled.checked = settings.enabled;
  autoSave.checked = settings.autoSave;
  document.getElementById("save-settings").addEventListener("click", saveSettings);
  document.getElementById("save-page").addEventListener("click", saveCurrentPage);
  document.getElementById("open-options").addEventListener("click", () => chrome.runtime.openOptionsPage());
}

async function saveSettings() {
  await chrome.storage.sync.set({ enabled: enabled.checked, autoSave: autoSave.checked });
  const response = await chrome.runtime.sendMessage({ type: "OPEN_YB_SYNC_RULE" }).catch((error) => ({
    ok: false,
    error: error.message || String(error),
  }));
  status.textContent = response?.ok ? "已保存。刷新元宝页面后生效。" : `已保存，但同步请求头规则失败：${response?.error || "未知错误"}`;
}

async function saveCurrentPage() {
  status.textContent = "正在保存当前网页...";
  const response = await chrome.runtime.sendMessage({ type: "OPEN_YB_SAVE_CURRENT_PAGE" }).catch((error) => ({
    ok: false,
    error: error.message || String(error),
  }));
  if (!response?.ok) {
    status.textContent = `保存失败：${response?.error || "未知错误"}`;
    return;
  }
  status.textContent = response.created ? "已保存当前网页到收藏库。" : "当前网页已存在，已更新收藏内容。";
}
