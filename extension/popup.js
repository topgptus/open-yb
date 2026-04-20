const enabled = document.getElementById("enabled");
const autoSave = document.getElementById("auto-save");
const status = document.getElementById("popup-status");

init();

async function init() {
  const settings = await chrome.storage.sync.get({ enabled: true, autoSave: false });
  enabled.checked = settings.enabled;
  autoSave.checked = settings.autoSave;
  document.getElementById("save-settings").addEventListener("click", saveSettings);
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
