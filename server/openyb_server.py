#!/usr/bin/env python3
"""Small Open YB HTTP server with Web UI and API.

This server intentionally uses only Python standard library modules. Put it in
the same directory as parse_yuanbao.py and run it with Python 3.
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import traceback
import urllib.parse
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
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
        if parsed.path.startswith("/static/"):
            self.send_static(parsed.path)
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

    def do_HEAD(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path in ("", "/", "/healthz"):
            self.send_response(HTTPStatus.OK)
            self.send_cors_headers()
            self.send_header("content-type", "text/html; charset=utf-8")
            self.end_headers()
            return
        if parsed.path.startswith("/static/"):
            self.send_static(parsed.path, head_only=True)
            return
        self.send_error(HTTPStatus.NOT_FOUND, "Not found")

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

    def send_static(self, request_path: str, head_only: bool = False) -> None:
        name = request_path.removeprefix("/static/").strip("/")
        if not name or "/" in name or "\\" in name:
            self.send_error(HTTPStatus.NOT_FOUND, "Not found")
            return
        path = Path(__file__).resolve().parent / "static" / name
        if not path.is_file():
            self.send_error(HTTPStatus.NOT_FOUND, "Not found")
            return
        content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        self.send_response(HTTPStatus.OK)
        self.send_header("content-type", content_type)
        self.send_header("cache-control", "public, max-age=86400")
        self.end_headers()
        if not head_only:
            self.wfile.write(path.read_bytes())

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
  <title>Open YB - 元宝链接解析</title>
  <style>
    :root {
      color-scheme: light;
      --bg: radial-gradient(circle at 12% 18%, #f5faf7 0%, #eef7f2 38%, #f4f7fb 100%);
      --card: #ffffff;
      --glass: rgba(255, 255, 255, 0.76);
      --accent: #1f7a55;
      --accent-strong: #15583e;
      --accent-soft: rgba(31, 122, 85, 0.12);
      --accent-gradient: linear-gradient(135deg, #1f7a55 0%, #20a36b 48%, #0f766e 100%);
      --warning: #f59e0b;
      --danger: #ef4444;
      --border: rgba(125, 145, 130, 0.18);
      --text: #17221c;
      --muted: #5d6b62;
      --muted-strong: #435349;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font-family: "PingFang SC", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .page {
      max-width: 1080px;
      margin: 0 auto;
      padding: 3.5rem 1.5rem 4rem;
    }
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 28px;
      box-shadow: 0 32px 110px rgba(23, 34, 28, 0.08);
    }
    .floating-ad {
      position: fixed;
      left: 24px;
      top: 120px;
      z-index: 1000;
      cursor: pointer;
      display: block;
    }
    .floating-ad img {
      display: block;
      width: 260px;
      max-width: min(260px, calc(100vw - 48px));
      height: auto;
      border-radius: 16px;
      box-shadow: 0 18px 45px rgba(23, 34, 28, 0.24);
    }
    .floating-ad-toggle {
      position: absolute;
      top: -12px;
      right: -12px;
      width: 32px;
      height: 32px;
      border-radius: 999px;
      border: 2px solid #fecaca;
      background: #ef4444;
      color: #fff;
      cursor: pointer;
      font-weight: 800;
      box-shadow: 0 10px 25px rgba(239, 68, 68, 0.55);
    }
    .floating-ad.is-mini { left: 12px; top: auto; bottom: 80px; }
    .floating-ad.is-mini img { width: 120px; border-radius: 14px; }
    .hero {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 220px;
      gap: 2rem;
      align-items: center;
      padding: 2.7rem 3rem;
      margin-bottom: 1.75rem;
    }
    .hero-brand { display: flex; gap: 1rem; align-items: center; margin-bottom: 1rem; }
    .brand-icon {
      width: 54px;
      height: 54px;
      border-radius: 14px;
      display: grid;
      place-items: center;
      background: var(--accent-gradient);
      color: #fff;
      font-weight: 900;
      box-shadow: 0 12px 28px rgba(31, 122, 85, 0.22);
      overflow: hidden;
    }
    .brand-icon img { width: 100%; height: 100%; object-fit: cover; }
    h1 { margin: 0; font-size: 2.1rem; line-height: 1.2; }
    .hero-subtitle {
      display: inline-flex;
      align-items: center;
      gap: .5rem;
      padding: .5rem .95rem;
      border-radius: 999px;
      background: var(--accent-soft);
      color: var(--accent);
      font-weight: 700;
      margin-top: .4rem;
      font-size: .92rem;
    }
    .hero-desc { color: var(--muted); line-height: 1.75; font-size: 1rem; margin: 0; }
    .tip-row { display: flex; gap: .75rem; flex-wrap: wrap; align-items: center; margin-top: 1.2rem; }
    .invite-tip {
      color: #dc2626;
      font-size: .92rem;
      font-weight: 700;
      padding: .62rem 1rem;
      background: rgba(239, 68, 68, .08);
      border: 1px solid rgba(239, 68, 68, .18);
      border-radius: 10px;
    }
    .member-tip {
      color: #166534;
      font-size: .92rem;
      font-weight: 700;
      padding: .62rem 1rem;
      background: rgba(34, 197, 94, .1);
      border: 1px solid rgba(34, 197, 94, .18);
      border-radius: 10px;
    }
    .promo-card {
      display: flex;
      align-items: center;
      gap: 1rem;
      margin-top: 1.2rem;
      padding: 1rem;
      border-radius: 18px;
      background: #fff;
      border: 1px solid var(--border);
      box-shadow: 0 12px 28px rgba(23, 34, 28, 0.06);
    }
    .promo-card img {
      width: 120px;
      height: 120px;
      object-fit: cover;
      border-radius: 18px;
      flex: 0 0 auto;
      box-shadow: 0 10px 24px rgba(23, 34, 28, 0.12);
    }
    .promo-card p {
      margin: 0;
      color: var(--muted-strong);
      line-height: 1.6;
      font-size: .96rem;
    }
    .promo-card a {
      color: #2563eb;
      font-weight: 800;
      text-decoration: none;
    }
    .qr-card {
      justify-self: end;
      width: 190px;
      padding: 1.25rem;
      text-align: center;
      background: var(--glass);
      border: 1px solid var(--border);
      border-radius: 22px;
      backdrop-filter: blur(18px);
    }
    .qr-card img { width: 132px; height: 132px; object-fit: cover; border-radius: 18px; display: block; margin: 0 auto .8rem; }
    .qr-card span { color: var(--muted); font-size: .82rem; line-height: 1.55; }
    .qr-card strong { color: #dc2626; }
    .parser-card { padding: 1.8rem 2rem; margin-bottom: 1.75rem; }
    .search-form { display: flex; align-items: center; gap: .9rem; flex-wrap: wrap; }
    .input-wrapper { position: relative; flex: 1 1 520px; }
    input[type="text"] {
      width: 100%;
      padding: 1rem 3rem 1rem 1.1rem;
      border-radius: 18px;
      border: 1px solid transparent;
      background: #f8fafc;
      font: inherit;
      font-size: 1rem;
      transition: border-color .2s, box-shadow .2s, background .2s;
    }
    input[type="text"]:focus {
      outline: none;
      background: #fff;
      border-color: rgba(31, 122, 85, .35);
      box-shadow: 0 0 0 5px rgba(31, 122, 85, .11);
    }
    .clear-btn {
      position: absolute;
      right: .65rem;
      top: 50%;
      transform: translateY(-50%);
      width: 32px;
      height: 32px;
      border-radius: 999px;
      border: none;
      background: rgba(125, 145, 130, .14);
      color: var(--muted-strong);
      cursor: pointer;
    }
    button {
      border: none;
      border-radius: 16px;
      cursor: pointer;
      font: inherit;
      font-weight: 700;
      min-height: 48px;
      padding: .9rem 1.35rem;
      transition: transform .2s, box-shadow .2s;
    }
    button:hover { transform: translateY(-1px); }
    .parse-btn { background: var(--accent-gradient); color: #fff; box-shadow: 0 20px 44px rgba(31, 122, 85, .26); }
    .secondary { background: rgba(31, 122, 85, .1); color: var(--accent); }
    .actions { display: flex; flex-wrap: wrap; gap: .75rem; margin-top: 1rem; }
    .status { color: var(--muted); min-height: 26px; margin: 1rem 0 .8rem; }
    .output-wrap { display: grid; gap: 1rem; grid-template-columns: minmax(0, 1fr) 260px; align-items: stretch; }
    pre {
      background: #f7faf8;
      border: 1px solid var(--border);
      border-radius: 18px;
      color: #1f2a24;
      line-height: 1.76;
      margin: 0;
      min-height: 320px;
      overflow: auto;
      padding: 1.2rem;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .guide-card {
      background: linear-gradient(180deg, #ffffff, #f8fbf9);
      border: 1px solid var(--border);
      border-radius: 18px;
      padding: 1.2rem;
    }
    .guide-card h3 { margin: 0 0 .8rem; font-size: 1rem; }
    .guide-card ul { margin: 0; padding-left: 1.2rem; color: var(--muted-strong); line-height: 1.75; font-size: .9rem; }
    .extension-card { padding: 1.6rem 2rem; margin-bottom: 1.75rem; }
    .extension-layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 220px;
      gap: 1.25rem;
      align-items: center;
    }
    .extension-card h2 { margin: 0 0 .65rem; font-size: 1.35rem; }
    .extension-card p { margin: 0; color: var(--muted); line-height: 1.7; }
    .extension-steps {
      margin: 1rem 0 0;
      padding-left: 1.25rem;
      color: var(--muted-strong);
      line-height: 1.75;
      font-size: .94rem;
    }
    .download-box {
      display: grid;
      gap: .75rem;
      justify-items: stretch;
      padding: 1rem;
      border-radius: 18px;
      background: #f8fafc;
      border: 1px solid var(--border);
    }
    .download-box img {
      width: 72px;
      height: 72px;
      border-radius: 16px;
      justify-self: center;
      box-shadow: 0 10px 24px rgba(23, 34, 28, 0.12);
    }
    .download-link {
      display: inline-flex;
      min-height: 48px;
      align-items: center;
      justify-content: center;
      border-radius: 16px;
      background: var(--accent-gradient);
      color: #fff;
      font-weight: 800;
      text-decoration: none;
      box-shadow: 0 20px 44px rgba(31, 122, 85, .22);
    }
    .download-box small { color: var(--muted); line-height: 1.5; text-align: center; }
    .info-card { padding: 1.6rem 2rem; margin-bottom: 1.75rem; }
    .info-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; }
    .info-item { background: #f8fafc; border: 1px solid var(--border); border-radius: 18px; padding: 1.15rem; }
    .info-item h3 { margin: 0 0 .55rem; font-size: 1rem; }
    .info-item p { margin: 0; color: var(--muted); line-height: 1.65; font-size: .9rem; }
    .footer-card { padding: 1.6rem 2rem; text-align: center; color: var(--muted); }
    .footer-card a { color: var(--accent); font-weight: 800; text-decoration: none; }
    .footer-card .star { display: inline-block; margin-top: .55rem; padding: .5rem .8rem; border-radius: 999px; background: var(--accent-soft); }
    @media (max-width: 1280px) { .floating-ad { display: none; } }
    @media (max-width: 760px) {
      .page { padding: 2rem 1rem 3rem; }
      .hero { grid-template-columns: 1fr; padding: 2rem 1.4rem; }
      .qr-card { justify-self: start; }
      .output-wrap, .info-grid { grid-template-columns: 1fr; }
      .extension-layout { grid-template-columns: 1fr; }
      .promo-card { align-items: flex-start; flex-direction: column; }
      .promo-card img { width: 100%; max-width: 180px; height: auto; }
      .parser-card, .extension-card, .info-card, .footer-card { padding: 1.35rem; }
      h1 { font-size: 1.7rem; }
    }
  </style>
</head>
<body>
  <a class="floating-ad" id="floatingAd" href="https://gt.topgpt.us/archives/1765038037689" target="_blank" rel="noopener noreferrer">
    <button type="button" class="floating-ad-toggle" onclick="toggleFloatingAd(event)">×</button>
    <img id="floatingAdImage" src="/static/bananaflow.jpg" alt="Nano Banana Flow 批量生图神器">
  </a>

  <div class="page">
    <header class="hero card">
      <div>
        <div class="hero-brand">
          <div class="brand-icon"><img src="/static/open-yb-logo.svg" alt="Open YB Logo"></div>
          <div>
            <h1>Open YB 元宝研究员</h1>
            <div class="hero-subtitle"><span>⚡</span> 元宝分享页解析 · Markdown 导出</div>
          </div>
        </div>
        <p class="hero-desc">支持腾讯元宝微信分享链接。粘贴链接即可解析正文，复制、下载 Markdown，并导入 NotebookLM、Obsidian、Notion、Dify 或自己的 RAG 知识库。</p>
        <div class="tip-row">
          <div class="invite-tip">电脑端打不开？粘贴元宝链接即可解析</div>
          <div class="member-tip">会员提示：想批量整理素材，建议先在微信里让元宝按固定模板输出</div>
        </div>
        <section class="promo-card">
          <img src="/static/buymeacoffee.jpg" alt="Buy me a coffee">
          <p>
            立即下载 banana flow<br>
            💻 <a href="https://gt.topgpt.us/archives/1765038037689" target="_blank" rel="noopener noreferrer">2.0 视频演示</a>
            &nbsp; 🆕 图文教程 2.0<br>
            如果觉得这个工具有用，可以请我喝一杯咖啡☕
          </p>
        </section>
      </div>
      <div class="qr-card">
        <img src="/static/qrcode.jpg" alt="AI 交流群二维码">
        <span>扫码加好友会拉你进群<br>人工添加所以会有延迟<br><strong>务必备注：yb</strong></span>
      </div>
    </header>

    <section class="parser-card card">
      <div class="search-form">
        <div class="input-wrapper">
          <input id="url" type="text" placeholder="粘贴腾讯元宝分享链接：https://yb.tencent.com/wx/ct/..." autocomplete="off">
          <button class="clear-btn" type="button" onclick="clearInput()">×</button>
        </div>
        <button id="parse" class="parse-btn" type="button">解析</button>
      </div>
      <div class="actions">
        <button class="secondary" id="copy" type="button">复制正文</button>
        <button class="secondary" id="copy-md" type="button">复制 Markdown</button>
        <button class="secondary" id="download" type="button">下载 MD</button>
        <button class="secondary" id="api" type="button">复制 API</button>
      </div>
      <p id="status" class="status">等待输入链接。</p>
      <div class="output-wrap">
        <pre id="output">示例：先把公众号文章、视频号或网页转发给元宝，让它总结、提炼 SRT、拆解文案结构，再把元宝分享链接粘贴到这里。</pre>
        <aside class="guide-card">
          <h3>推荐提示词</h3>
          <ul>
            <li>总结核心观点、项目地址、关键步骤和标签。</li>
            <li>提炼视频完整 SRT，必须带时间轴。</li>
            <li>拆解视频结构、文案逻辑和爆款卖点。</li>
            <li>整理成 Markdown 笔记，方便进入知识库。</li>
          </ul>
        </aside>
      </div>
    </section>

    <section class="extension-card card">
      <div class="extension-layout">
        <div>
          <h2>Chrome 插件下载</h2>
          <p>更推荐电脑端长期使用 Chrome 插件。开启后，浏览器打开元宝分享页会优先尝试直接解析和展示原版内容，并提供复制正文、收藏、单篇导出、批量导出、合并导出 Markdown。</p>
          <ol class="extension-steps">
            <li>下载压缩包并解压到本地文件夹。</li>
            <li>打开 Chrome 扩展程序页面：chrome://extensions/。</li>
            <li>打开右上角“开发者模式”，点击“加载已解压的扩展程序”。</li>
            <li>选择解压后的 extension 文件夹，勾选“接管元宝分享页”。</li>
          </ol>
        </div>
        <div class="download-box">
          <img src="/static/open-yb-logo.svg" alt="Open YB Chrome 插件">
          <a class="download-link" href="/static/open-yb-chrome-extension.zip" download>下载插件压缩包</a>
          <small>当前版本适合本地安装。Chrome 商店版本后续再考虑。</small>
        </div>
      </div>
    </section>

    <section class="info-card card">
      <div class="info-grid">
        <div class="info-item">
          <h3>原生微信素材</h3>
          <p>利用元宝读取公众号、视频号和网页内容，再把结果带回电脑。</p>
        </div>
        <div class="info-item">
          <h3>AI 笔记友好</h3>
          <p>导出 Markdown 后可放入 NotebookLM、Obsidian、Notion 或 Dify。</p>
        </div>
        <div class="info-item">
          <h3>后续可扩展</h3>
          <p>如需云端收藏夹、账号体系或批量任务，可以继续基于这个服务端扩展。</p>
        </div>
      </div>
    </section>

    <footer class="footer-card card">
      <div>Open YB · 运行域名：<a href="https://yb.topgpt.us/" target="_blank" rel="noreferrer">yb.topgpt.us</a></div>
      <div class="star">项目开源在 <a href="https://github.com/topgptus/open-yb" target="_blank" rel="noreferrer">github.com/topgptus/open-yb</a>，欢迎点击 Star 支持。</div>
    </footer>
  </div>

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
    $("api").addEventListener("click", async () => {
      const url = $("url").value.trim();
      if (!url) {
        status("请先粘贴元宝分享链接。");
        return;
      }
      await navigator.clipboard.writeText(`${location.origin}/api/parse?url=${encodeURIComponent(url)}`);
      status("已复制 API 地址。");
    });

    function clearInput() {
      $("url").value = "";
      $("output").textContent = "";
      current = null;
      status("等待输入链接。");
    }

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

    function toggleFloatingAd(event) {
      event.preventDefault();
      const ad = document.getElementById("floatingAd");
      if (ad.classList.contains("is-mini")) {
        ad.style.display = "none";
      } else {
        ad.classList.add("is-mini");
        const image = document.getElementById("floatingAdImage");
        if (image) image.src = "/static/bananaflowm.jpg";
      }
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
