#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

const WX_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) ' +
  'AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 ' +
  'MicroMessenger/8.0.49(0x1800312c) NetType/WIFI Language/zh_CN';

const DEFAULT_HEADERS = {
  'user-agent': WX_UA,
  accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'upgrade-insecure-requests': '1',
};

function usage() {
  console.log(`Usage:
  node open-yb.mjs <yb.tencent.com share url> [output.html]

Example:
  node open-yb.mjs https://yb.tencent.com/wx/ct/YFJCmiMxnhFCZJ
  open snapshots/YFJCmiMxnhFCZJ.html`);
}

function getShareId(url) {
  const parsed = new URL(url);
  const id = basename(parsed.pathname);
  return id || 'yuanbao-share';
}

function readNextData(html) {
  const match = html.match(
    /<script id="__NEXT_DATA__" type="application\/json"[^>]*>([\s\S]*?)<\/script>/,
  );
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function makeStandalone(html, sourceUrl) {
  const fetchedAt = new Date().toISOString();
  const notice = `
<div style="position:sticky;top:0;z-index:99999;padding:10px 14px;background:#fffbe6;border-bottom:1px solid #e5d28b;color:#262626;font:14px/1.5 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif">
  Local snapshot fetched with a WeChat WebView User-Agent from
  <a href="${sourceUrl}" target="_blank" rel="noreferrer">${sourceUrl}</a>
  at ${fetchedAt}.
</div>`;

  return html
    .replace(/<head>/i, `<head><base href="https://yb.tencent.com/">`)
    .replace(/<body>/i, `<body>${notice}`);
}

async function main() {
  const [, , inputUrl, outputArg] = process.argv;
  if (!inputUrl || inputUrl === '-h' || inputUrl === '--help') {
    usage();
    return;
  }

  const url = new URL(inputUrl);
  if (!/(^|\.)yb\.tencent\.com$/.test(url.hostname)) {
    throw new Error(`Only yb.tencent.com URLs are supported: ${url.hostname}`);
  }

  const response = await fetch(url, {
    redirect: 'follow',
    headers: DEFAULT_HEADERS,
  });

  if (!response.ok) {
    throw new Error(`Fetch failed: HTTP ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const nextData = readNextData(html);
  const errCode = nextData?.props?.pageProps?.data?.err_code;
  if (errCode === 'notInWX') {
    throw new Error(
      'The server still returned err_code=notInWX. Tencent may have changed the checks.',
    );
  }

  const shareId = getShareId(url);
  const output = outputArg || join('snapshots', `${shareId}.html`);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, makeStandalone(html, url.toString()), 'utf8');

  const title =
    nextData?.props?.pageProps?.data?.conversation_info?.title ||
    html.match(/<div class="yuanfang__hd">([^<]+)/)?.[1] ||
    shareId;

  console.log(`Saved: ${output}`);
  console.log(`Title: ${title}`);
  console.log('Open it with:');
  console.log(`  open ${JSON.stringify(output)}`);
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
