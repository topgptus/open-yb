---
name: open-yb
description: Parse Tencent Yuanbao (yb.tencent.com / yuanbao.tencent.com) WeChat share links into text, Markdown, or JSON for agent workflows. Use when a user provides a Yuanbao share URL, asks to summarize or save Yuanbao output, or wants to feed Yuanbao-generated content into Codex, Claude Code, OpenClaw, NotebookLM, a knowledge base, or an automation pipeline.
---

# Open YB

Use this skill to turn Tencent Yuanbao share links into local text artifacts.

Supported URLs:

```text
https://yb.tencent.com/wx/ct/...
https://yb.tencent.com/wx/ct/f/...
https://yuanbao.tencent.com/wx/ct/...
```

## Core workflow

1. When the user gives a Yuanbao share URL, run the bundled parser script.
2. Prefer Markdown when the output will be saved to notes, knowledge bases, NotebookLM, Obsidian, Notion, or RAG datasets.
3. Prefer JSON when another program or automation will consume title, question, answer, messages, images, and metadata.
4. Prefer plain text when the user only wants the answer body.

## Script

Run from this skill directory or pass the script path directly:

```bash
python3 scripts/parse_yuanbao.py "https://yb.tencent.com/wx/ct/..." --format markdown
```

Formats:

```bash
python3 scripts/parse_yuanbao.py "<url>" --format markdown
python3 scripts/parse_yuanbao.py "<url>" --format text
python3 scripts/parse_yuanbao.py "<url>" --format json
```

Save output:

```bash
python3 scripts/parse_yuanbao.py "<url>" --format markdown --output yuanbao-note.md
```

Fetch engine diagnostics:

```bash
python3 scripts/parse_yuanbao.py "<url>" --fetch-engine auto
python3 scripts/parse_yuanbao.py "<url>" --fetch-engine urllib
python3 scripts/parse_yuanbao.py "<url>" --fetch-engine curl
```

## Behavior

The script requests the share page with a WeChat WebView User-Agent, extracts the Next.js `__NEXT_DATA__` JSON, and returns the Yuanbao conversation content. It does not require the Cloudflare Worker.

Default fetch mode is `--fetch-engine auto`: try Python `urllib` first, then fall back to `curl` when Python's local SSL certificate chain fails. Use `--fetch-engine curl` directly on macOS/Linux machines where Python HTTPS verification is broken.

This skill is for local agent workflows and does not depend on any hosted service.

## Output guidance

When returning results to the user:

- Include the title, source URL, and answer text.
- If saving a file, mention the saved path.
- If parsing fails, report the exact error and suggest checking that the URL is a public Yuanbao share link.
- For `CERTIFICATE_VERIFY_FAILED`, retry with `--fetch-engine curl`.
- For `notInWX`, explain that Yuanbao did not recognize the request as WeChat WebView and the WeChat-style headers should be checked.

## Limitations

This skill focuses on text extraction. It does not fetch Yuanbao native voice playback.
