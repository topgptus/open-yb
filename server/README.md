# Open YB Server

这是一个轻量服务器版本，适合部署到 VPS 后再用 Nginx、宝塔、Cloudflare Tunnel 或自己的反代入口转发。

特性：

- 只依赖 Python 3 标准库。
- 提供 Web UI。
- 提供 `GET /api/parse?url=...` JSON API。
- 提供 `GET /api/text?url=...` 纯文本 API。
- 只解析 `yb.tencent.com` 和 `yuanbao.tencent.com` 的 `/wx/ct/` 分享链接。

## 运行

把 `openyb_server.py` 和 `skills/open-yb/scripts/parse_yuanbao.py` 放在同一个目录，然后运行：

```bash
python3 openyb_server.py --host 0.0.0.0 --port 8765
```

访问：

```text
http://<server-ip>:8765/
```

健康检查：

```text
http://<server-ip>:8765/healthz
```
