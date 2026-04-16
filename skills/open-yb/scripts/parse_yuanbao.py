#!/usr/bin/env python3
"""Parse Tencent Yuanbao share links into text, Markdown, or JSON.

This script intentionally uses only Python standard library modules so it can run
inside Codex, Claude Code, OpenClaw, cron jobs, and simple local automations.
"""

from __future__ import annotations

import argparse
import html
import json
import re
import shutil
import ssl
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any


WX_USER_AGENT = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 "
    "MicroMessenger/8.0.49(0x1800312c) NetType/WIFI Language/zh_CN"
)

ALLOWED_HOSTS = {"yb.tencent.com", "yuanbao.tencent.com"}


class ParseError(RuntimeError):
    pass


def main() -> int:
    parser = argparse.ArgumentParser(description="Parse Tencent Yuanbao share URLs.")
    parser.add_argument("url", help="Yuanbao share URL, e.g. https://yb.tencent.com/wx/ct/...")
    parser.add_argument(
        "--format",
        choices=("markdown", "json", "text"),
        default="markdown",
        help="Output format. Default: markdown.",
    )
    parser.add_argument("--output", "-o", help="Optional output file path.")
    parser.add_argument("--timeout", type=int, default=25, help="HTTP timeout in seconds.")
    parser.add_argument(
        "--fetch-engine",
        choices=("auto", "urllib", "curl"),
        default="auto",
        help="HTML fetch engine. auto tries urllib first and falls back to curl on Python SSL certificate failures.",
    )
    args = parser.parse_args()

    try:
        result = parse_yuanbao_share(args.url, timeout=args.timeout, fetch_engine=args.fetch_engine)
        output = format_result(result, args.format)
    except Exception as exc:
        print(f"open-yb parse failed: {exc}", file=sys.stderr)
        return 1

    if args.output:
        path = Path(args.output)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(output, encoding="utf-8")
    else:
        print(output, end="" if output.endswith("\n") else "\n")

    return 0


def parse_yuanbao_share(input_url: str, timeout: int = 25, fetch_engine: str = "auto") -> dict[str, Any]:
    share_url = normalize_share_url(input_url)
    page_html, used_fetch_engine = fetch_html(share_url, timeout=timeout, fetch_engine=fetch_engine)
    next_data = read_next_data(page_html)
    page_props = dig(next_data, "props", "pageProps") or {}
    page_data = page_props.get("data")

    if not isinstance(page_data, dict):
        raise ParseError("Yuanbao response did not include page data")

    err_code = page_data.get("err_code")
    if err_code == "notInWX":
        raise ParseError(
            "Yuanbao returned notInWX, meaning the request was not recognized as a WeChat WebView. "
            "Retry with --fetch-engine curl, or check that the request still includes WeChat-style headers."
        )
    if err_code not in (None, 0):
        raise ParseError(str(page_data.get("err_msg") or f"Yuanbao returned err_code={err_code}"))

    info = page_data.get("conversation_info") or {}
    conversations = extract_conversations(info)
    messages = [message for message in (to_message(conv) for conv in conversations) if message.get("text")]
    answer = next((message for message in reversed(messages) if message.get("speaker") == "ai"), {})
    question = next((message for message in messages if message.get("speaker") == "human"), {})
    share_card = (
        info.get("shareCardInfo")
        or dig(info, "shareExtraDetailObj", "chatInfo", 0, "shareCardInfo")
        or {}
    )

    return {
        "sourceUrl": share_url,
        "shareId": page_props.get("shareId") or basename(urllib.parse.urlparse(share_url).path),
        "title": share_card.get("title") or info.get("title") or answer.get("title") or "",
        "description": share_card.get("description") or "",
        "answerTime": share_card.get("answerTime") or "",
        "questionText": question.get("text") or "",
        "answerText": answer.get("text") or "",
        "messages": messages,
        "images": extract_images(conversations),
        "meta": {
            "errCode": err_code,
            "expireTime": info.get("expireTime"),
            "backendTraceId": page_props.get("backendTraceId") or "",
            "parsedAt": datetime.now().isoformat(timespec="seconds"),
            "fetchEngine": used_fetch_engine,
        },
    }


def normalize_share_url(input_url: str) -> str:
    parsed = urllib.parse.urlparse(input_url.strip())
    if parsed.scheme not in {"http", "https"}:
        raise ParseError("Invalid URL scheme")
    if parsed.hostname not in ALLOWED_HOSTS:
        raise ParseError("Only yb.tencent.com and yuanbao.tencent.com share URLs are supported")
    if not parsed.path.startswith("/wx/ct/"):
        raise ParseError("Only /wx/ct/ share URLs are supported")
    return urllib.parse.urlunparse(parsed._replace(scheme="https"))


def fetch_html(url: str, timeout: int, fetch_engine: str) -> tuple[str, str]:
    if fetch_engine == "urllib":
        return fetch_with_urllib(url, timeout), "urllib"
    if fetch_engine == "curl":
        return fetch_with_curl(url, timeout), "curl"

    try:
        return fetch_with_urllib(url, timeout), "urllib"
    except ParseError as exc:
        if not is_certificate_error(exc):
            raise
        return fetch_with_curl(url, timeout), "curl"


def fetch_with_urllib(url: str, timeout: int) -> str:
    request = urllib.request.Request(
        url,
        headers=request_headers(),
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            charset = response.headers.get_content_charset() or "utf-8"
            return response.read().decode(charset, errors="replace")
    except urllib.error.HTTPError as exc:
        raise ParseError(f"Yuanbao fetch failed: HTTP {exc.code}") from exc
    except urllib.error.URLError as exc:
        raise ParseError(f"Yuanbao fetch failed: {exc.reason}") from exc


def fetch_with_curl(url: str, timeout: int) -> str:
    if not shutil.which("curl"):
        raise ParseError("curl fallback requested, but curl was not found on this machine")

    command = [
        "curl",
        "-L",
        "--fail",
        "--silent",
        "--show-error",
        "--max-time",
        str(timeout),
    ]
    for name, value in request_headers().items():
        command.extend(["-H", f"{name}: {value}"])
    command.append(url)

    completed = subprocess.run(command, capture_output=True, text=True, check=False)
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout or "").strip()
        raise ParseError(f"Yuanbao fetch with curl failed: {detail or f'curl exit {completed.returncode}'}")
    return completed.stdout


def request_headers() -> dict[str, str]:
    return {
        "User-Agent": WX_USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Upgrade-Insecure-Requests": "1",
    }


def is_certificate_error(error: Exception) -> bool:
    text = str(error)
    current: BaseException | None = error
    while current:
        if isinstance(current, ssl.SSLCertVerificationError):
            return True
        reason = getattr(current, "reason", None)
        if isinstance(reason, ssl.SSLCertVerificationError):
            return True
        if reason and "CERTIFICATE_VERIFY_FAILED" in str(reason):
            return True
        current = current.__cause__ or current.__context__
    return "CERTIFICATE_VERIFY_FAILED" in text or "certificate verify failed" in text.lower()


def read_next_data(page_html: str) -> dict[str, Any]:
    match = re.search(
        r'<script id="__NEXT_DATA__" type="application/json"[^>]*>(.*?)</script>',
        page_html,
        re.DOTALL,
    )
    if not match:
        raise ParseError("Could not find __NEXT_DATA__ in Yuanbao page")
    try:
        return json.loads(html.unescape(match.group(1)))
    except json.JSONDecodeError as exc:
        raise ParseError("Could not parse __NEXT_DATA__ JSON") from exc


def extract_conversations(info: dict[str, Any]) -> list[dict[str, Any]]:
    candidates = [
        dig(info, "shareExtraDetailObj", "chatInfo"),
        info.get("chatInfo"),
        dig(info, "dataObj", "chatInfo"),
    ]
    for chat_info in candidates:
        if not isinstance(chat_info, list):
            continue
        convs: list[dict[str, Any]] = []
        for chat in chat_info:
            if isinstance(chat, dict) and isinstance(chat.get("convs"), list):
                convs.extend(item for item in chat["convs"] if isinstance(item, dict))
        if convs:
            return convs
    return []


def to_message(conv: dict[str, Any]) -> dict[str, Any]:
    return {
        "speaker": conv.get("speaker") or "",
        "text": extract_text(conv),
        "title": conv.get("title") or "",
        "index": conv.get("index"),
        "id": conv.get("id") or "",
    }


def extract_text(conv: dict[str, Any]) -> str:
    speech = conv.get("speech")
    if isinstance(speech, str) and speech.strip():
        return speech.strip()

    speeches_v2 = conv.get("speechesV2")
    if not isinstance(speeches_v2, list):
        return ""

    parts: list[str] = []
    for speech_item in speeches_v2:
        if not isinstance(speech_item, dict):
            continue
        content = speech_item.get("content")
        if not isinstance(content, list):
            continue
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text" and item.get("msg"):
                parts.append(str(item["msg"]))
    return "\n".join(parts).strip()


def extract_images(conversations: list[dict[str, Any]]) -> list[str]:
    images: list[str] = []
    for conv in conversations:
        speeches_v2 = conv.get("speechesV2")
        if not isinstance(speeches_v2, list):
            continue
        for speech_item in speeches_v2:
            content = speech_item.get("content") if isinstance(speech_item, dict) else None
            if not isinstance(content, list):
                continue
            for item in content:
                if not isinstance(item, dict):
                    continue
                if (item.get("type") == "image" or item.get("docType") == "image") and item.get("url"):
                    images.append(str(item["url"]))
    return sorted(set(images))


def format_result(result: dict[str, Any], output_format: str) -> str:
    if output_format == "json":
        return json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if output_format == "text":
        return (result.get("answerText") or "") + "\n"
    return to_markdown(result)


def to_markdown(result: dict[str, Any]) -> str:
    lines = [
        f"# {result.get('title') or '元宝分享内容'}",
        "",
        f"来源：{result.get('sourceUrl') or ''}",
    ]
    if result.get("answerTime"):
        lines.append(f"时间：{result['answerTime']}")
    if result.get("description"):
        lines.extend(["", "## 摘要", "", str(result["description"])])
    if result.get("questionText"):
        lines.extend(["", "## 问题", "", str(result["questionText"])])
    if result.get("answerText"):
        lines.extend(["", "## 回答", "", str(result["answerText"])])
    return "\n".join(lines).strip() + "\n"


def dig(value: Any, *keys: Any) -> Any:
    current = value
    for key in keys:
        if isinstance(key, int) and isinstance(current, list):
            if key < 0 or key >= len(current):
                return None
            current = current[key]
        elif isinstance(current, dict):
            current = current.get(key)
        else:
            return None
    return current


def basename(path: str) -> str:
    parts = [part for part in path.split("/") if part]
    return parts[-1] if parts else ""


if __name__ == "__main__":
    raise SystemExit(main())
