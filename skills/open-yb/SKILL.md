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
python scripts/parse_yuanbao.py "https://yb.tencent.com/wx/ct/..." --format markdown
```

Formats:

```bash
python scripts/parse_yuanbao.py "<url>" --format markdown
python scripts/parse_yuanbao.py "<url>" --format text
python scripts/parse_yuanbao.py "<url>" --format json
```

Save output:

```bash
python scripts/parse_yuanbao.py "<url>" --format markdown --output yuanbao-note.md
```

## Behavior

The script requests the share page with a WeChat WebView User-Agent, extracts the Next.js `__NEXT_DATA__` JSON, and returns the Yuanbao conversation content. It does not require the Cloudflare Worker.

The Cloudflare Worker remains useful for browser plugins and HTTP APIs. This skill is for local agent workflows.

## Output guidance

When returning results to the user:

- Include the title, source URL, and answer text.
- If saving a file, mention the saved path.
- If parsing fails, report the exact error and suggest checking that the URL is a public Yuanbao share link.

## Limitations

This skill focuses on text extraction. It does not fetch Yuanbao native voice playback.
