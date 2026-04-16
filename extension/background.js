chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "OPEN_YB_PARSE") return false;

  parseYuanbaoUrl(message.workerBaseUrl, message.sourceUrl)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error.message || String(error),
        endpoint: buildParseEndpoint(message.workerBaseUrl, message.sourceUrl),
      });
    });

  return true;
});

async function parseYuanbaoUrl(workerBaseUrl, sourceUrl) {
  const endpoint = buildParseEndpoint(workerBaseUrl, sourceUrl);
  let response;

  try {
    response = await fetch(endpoint, {
      method: "GET",
      headers: { accept: "application/json" },
    });
  } catch (error) {
    throw new Error(
      `无法连接 Worker。请直接打开 Worker 地址测试网络连通性。原始错误：${error.message || String(error)}`,
    );
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    throw new Error(data.error || `Worker 请求失败：HTTP ${response.status}`);
  }

  return data;
}

function buildParseEndpoint(workerBaseUrl, sourceUrl) {
  const baseUrl = normalizeWorkerBaseUrl(workerBaseUrl);
  return `${baseUrl}/api/parse?url=${encodeURIComponent(sourceUrl)}`;
}

function normalizeWorkerBaseUrl(value) {
  const trimmed = String(value || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";

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
