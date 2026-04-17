#!/usr/bin/env python3
"""Small Open YB HTTP server with Web UI and API.

This server intentionally uses only Python standard library modules. Put it in
the same directory as parse_yuanbao.py and run it with Python 3.
"""

from __future__ import annotations

import argparse
import json
import os
import traceback
import urllib.parse
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from parse_yuanbao import format_result, parse_yuanbao_share


DEFAULT_HOST = "0.0.0.0"
DEFAULT_PORT = 8765


class OpenYBHandler(BaseHTTPRequestHandler):
    server_version = "OpenYB/0.1"

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path in ("", "/"):
            self.send_html(index_html())
            return
        if parsed.path == "/healthz":
            self.send_json({"ok": True, "service": "openyb"})
            return
        if parsed.path == "/api/parse":
            query = urllib.parse.parse_qs(parsed.query)
            self.handle_parse(query.get("url", [""])[0], output_format="json")
            return
        if parsed.path == "/api/text":
            query = urllib.parse.parse_qs(parsed.query)
            self.handle_parse(query.get("url", [""])[0], output_format="text")
            return
        self.send_error(HTTPStatus.NOT_FOUND, "Not found")

    def do_POST(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != "/api/parse":
            self.send_error(HTTPStatus.NOT_FOUND, "Not found")
            return

        length = int(self.headers.get("content-length") or "0")
        raw_body = self.rfile.read(length).decode("utf-8", errors="replace")
        content_type = self.headers.get("content-type", "")

        url = ""
        output_format = "json"
        if "application/json" in content_type:
            try:
                payload = json.loads(raw_body or "{}")
                url = str(payload.get("url") or "")
                output_format = str(payload.get("format") or "json")
            except json.JSONDecodeError:
                self.send_json({"ok": False, "error": "Invalid JSON body"}, status=HTTPStatus.BAD_REQUEST)
                return
        else:
            form = urllib.parse.parse_qs(raw_body)
            url = form.get("url", [""])[0]
            output_format = form.get("format", ["json"])[0]

        self.handle_parse(url, output_format=output_format)

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_cors_headers()
        self.end_headers()

    def handle_parse(self, url: str, output_format: str) -> None:
        if not url.strip():
            self.send_json({"ok": False, "error": "Missing url"}, status=HTTPStatus.BAD_REQUEST)
            return

        output_format = output_format if output_format in {"json", "text", "markdown"} else "json"

        try:
            result = parse_yuanbao_share(url, timeout=25, fetch_engine="auto")
            if output_format == "text":
                self.send_text(format_result(result, "text"))
            elif output_format == "markdown":
                self.send_text(format_result(result, "markdown"), content_type="text/markdown; charset=utf-8")
            else:
                self.send_json(result)
        except Exception as exc:  # Keep API errors readable for manual use.
            if os.environ.get("OPENYB_DEBUG") == "1":
                error = f"{exc}\n{traceback.format_exc()}"
            else:
                error = str(exc)
            self.send_json({"ok": False, "error": error}, status=HTTPStatus.BAD_REQUEST)

    def send_html(self, body: str, status: HTTPStatus = HTTPStatus.OK) -> None:
        self.send_response(status)
        self.send_cors_headers()
        self.send_header("content-type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(body.encode("utf-8"))

    def send_text(
        self,
        body: str,
        status: HTTPStatus = HTTPStatus.OK,
        content_type: str = "text/plain; charset=utf-8",
    ) -> None:
        self.send_response(status)
        self.send_cors_headers()
        self.send_header("content-type", content_type)
        self.end_headers()
        self.wfile.write(body.encode("utf-8"))

    def send_json(self, payload: dict[str, Any], status: HTTPStatus = HTTPStatus.OK) -> None:
        self.send_response(status)
        self.send_cors_headers()
        self.send_header("content-type", "application/json; charset=utf-8")
        self.end_headers()
        self.wfile.write(json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8"))

    def send_cors_headers(self) -> None:
        self.send_header("access-control-allow-origin", "*")
        self.send_header("access-control-allow-methods", "GET, POST, OPTIONS")
        self.send_header("access-control-allow-headers", "content-type")

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"{self.address_string()} - {fmt % args}", flush=True)


def index_html() -> str:
    return """<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Open YB Server</title>
  <style>
    :root { color-scheme: light; }
    body {
      background: #f3f6f1;
      color: #1c211b;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif;
      margin: 0;
      padding: 36px 18px 60px;
    }
    main { max-width: 980px; margin: 0 auto; }
    h1 { font-size: 42px; margin: 0 0 8px; }
    p { color: #566258; line-height: 1.7; }
    .panel {
      background: #fff;
      border: 1px solid #d8ded3;
      border-radius: 8px;
      padding: 22px;
      margin-top: 18px;
    }
    .row { display: flex; gap: 12px; }
    input {
      border: 1px solid #cbd6cc;
      border-radius: 8px;
      box-sizing: border-box;
      flex: 1;
      font: inherit;
      min-height: 44px;
      padding: 10px 12px;
    }
    button {
      background: #1f6b48;
      border: 1px solid #1f6b48;
      border-radius: 8px;
      color: #fff;
      cursor: pointer;
      font: inherit;
      min-height: 44px;
      padding: 10px 16px;
    }
    button.secondary { background: #fff; color: #1f6b48; }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 12px; }
    pre {
      background: #f7f8f5;
      border: 1px solid #d8ded3;
      border-radius: 8px;
      line-height: 1.75;
      min-height: 260px;
      overflow: auto;
      padding: 16px;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .status { min-height: 24px; }
    @media (max-width: 720px) {
      .row { flex-direction: column; }
    }
  </style>
</head>
<body>
  <main>
    <h1>Open YB Server</h1>
    <p>粘贴腾讯元宝分享链接，解析成可复制的文本或 Markdown。支持 <code>yb.tencent.com/wx/ct/...</code> 和 <code>yuanbao.tencent.com/wx/ct/...</code>。</p>
    <section class="panel">
      <div class="row">
        <input id="url" placeholder="https://yb.tencent.com/wx/ct/..." autocomplete="off">
        <button id="parse">解析</button>
      </div>
      <div class="actions">
        <button class="secondary" id="copy">复制正文</button>
        <button class="secondary" id="copy-md">复制 Markdown</button>
        <button class="secondary" id="download">下载 MD</button>
      </div>
      <p id="status" class="status">等待输入链接。</p>
      <pre id="output"></pre>
    </section>
  </main>
  <script>
    let current = null;
    const $ = (id) => document.getElementById(id);
    const status = (text) => $("status").textContent = text;

    $("parse").addEventListener("click", parse);
    $("url").addEventListener("keydown", (event) => {
      if (event.key === "Enter") parse();
    });
    $("copy").addEventListener("click", async () => {
      await navigator.clipboard.writeText(current?.answerText || $("output").textContent || "");
      status("已复制正文。");
    });
    $("copy-md").addEventListener("click", async () => {
      await navigator.clipboard.writeText(toMarkdown(current));
      status("已复制 Markdown。");
    });
    $("download").addEventListener("click", () => {
      const blob = new Blob([toMarkdown(current)], { type: "text/markdown;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = safeFileName(current?.title || current?.shareId || "yuanbao") + ".md";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      status("已生成 Markdown 下载。");
    });

    async function parse() {
      const url = $("url").value.trim();
      if (!url) {
        status("请先粘贴元宝分享链接。");
        return;
      }
      status("解析中...");
      $("output").textContent = "";
      const response = await fetch("/api/parse?url=" + encodeURIComponent(url));
      const data = await response.json();
      if (!response.ok || data.ok === false) {
        current = null;
        $("output").textContent = data.error || "解析失败";
        status("解析失败。");
        return;
      }
      current = data;
      $("output").textContent = [
        data.title || "元宝分享内容",
        "",
        data.questionText ? "问题：\\n" + data.questionText + "\\n" : "",
        data.answerText || ""
      ].filter(Boolean).join("\\n");
      status("解析完成。");
    }

    function toMarkdown(item) {
      if (!item) return $("output").textContent || "";
      const lines = ["# " + (item.title || "元宝分享内容"), "", "来源：" + (item.sourceUrl || "")];
      if (item.answerTime) lines.push("时间：" + item.answerTime);
      if (item.description) lines.push("", "## 摘要", "", item.description);
      if (item.questionText) lines.push("", "## 问题", "", item.questionText);
      if (item.answerText) lines.push("", "## 回答", "", item.answerText);
      return lines.join("\\n").trim() + "\\n";
    }

    function safeFileName(value) {
      return String(value).trim().replace(/[\\\\/:*?"<>|]+/g, "-").replace(/\\s+/g, " ").slice(0, 80) || "yuanbao";
    }
  </script>
</body>
</html>
"""


def main() -> int:
    parser = argparse.ArgumentParser(description="Run Open YB web server.")
    parser.add_argument("--host", default=os.environ.get("OPENYB_HOST", DEFAULT_HOST))
    parser.add_argument("--port", type=int, default=int(os.environ.get("OPENYB_PORT", DEFAULT_PORT)))
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), OpenYBHandler)
    print(f"Open YB server listening on http://{args.host}:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
