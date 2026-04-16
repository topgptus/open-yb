const DEFAULT_WORKER_URL = "https://your-worker.workers.dev";

const enabled = document.getElementById("enabled");
const workerUrl = document.getElementById("worker-url");
const status = document.getElementById("popup-status");

init();

async function init() {
  const settings = await chrome.storage.sync.get({
    enabled: true,
    workerBaseUrl: DEFAULT_WORKER_URL,
  });
  enabled.checked = settings.enabled;
  workerUrl.value = settings.workerBaseUrl;

  document.getElementById("save-settings").addEventListener("click", saveSettings);
  document.getElementById("open-options").addEventListener("click", () => chrome.runtime.openOptionsPage());
}

async function saveSettings() {
  const nextUrl = normalizeWorkerBaseUrl(workerUrl.value);
  const granted = await requestWorkerPermission(nextUrl);
  if (!granted) {
    status.textContent = "未获得该 Worker 域名权限，插件可能无法请求这个地址。";
    return;
  }

  await chrome.storage.sync.set({
    enabled: enabled.checked,
    workerBaseUrl: nextUrl,
  });
  workerUrl.value = nextUrl;
  status.textContent = "已保存。刷新元宝页面后生效。";
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
