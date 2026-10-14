# Ubuntu Remote Web

Secure browser remote desktop for **this Ubuntu machine**. Next.js UI + noVNC streams the live `DISPLAY=:0` session via localhost-only `x11vnc` / `websockify`, optionally exposed with Cloudflare Tunnel.

**Not for Vercel.** The desktop stream must run on this host.

## Architecture

```text
Browser → Cloudflare Tunnel (HTTPS) → Next.js :3100 (login + noVNC)
                                         └─ /vnc-ws (auth cookie) → websockify :6080 → x11vnc :5900 → DISPLAY=:0
```

VNC and websockify bind to `127.0.0.1` only.

## Requirements

- Ubuntu desktop session logged in (`DISPLAY=:0`)
- Node.js 20+
- Packages: `x11vnc`, `websockify`
- Optional: `cloudflared` (already common on this machine)

## Quick start

```bash
cd ~/Documents/source/ubuntu-remote-web

# 1) System packages (once)
sudo apt-get update
sudo apt-get install -y x11vnc websockify

# 2) Env — sửa AUTH_PASSWORD trong .env
ppnpm install
pnpm gen-env          # hoặc copy .env.example → .env rồi sửa tay

# 3) Build + chạy web
pnpm build
pnpm start            # = NODE_ENV=production node server.mjs
```

Open `http://127.0.0.1:3100/login`, sign in, open Desktop.

### Viewer controls (AnyDesk-like)

Toolbar on `/desktop`:

- **Screen** — `All monitors` or one output (restarts x11vnc with `-clip WxH+X+Y`)
- **View**
  - `Fit` — scale giữ tỉ lệ cho vừa cửa sổ
  - `1:1` — kích thước gốc, kéo/scroll nếu lớn hơn
  - `Stretch` — kéo đầy khung (không giữ tỉ lệ)
  - `Shrink` — chỉ thu nhỏ khi remote lớn hơn viewport
- **Fullscreen** — fullscreen trình duyệt
- **Reconnect** — nối lại VNC

Đổi mật khẩu: sửa `AUTH_PASSWORD` trong `.env`, rồi:

```bash
# nếu chạy bằng pnpm
# Ctrl+C rồi:
pnpm start

# nếu dùng systemd
systemctl --user restart urw-web
```


## systemd (user)

```bash
mkdir -p ~/.config/systemd/user
cp systemd/*.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now urw-x11vnc.service urw-websockify.service urw-web.service
systemctl --user status urw-x11vnc urw-websockify urw-web
```

Logs: `journalctl --user -u urw-web -f` and `.runtime/x11vnc.log`.

## Cloudflare Tunnel

This machine already has `cloudflared` and tunnels (e.g. `rdp`). Point a hostname to the web UI:

1. Edit `~/.cloudflared/config.yml` ingress to include:
   ```yaml
   - hostname: remote.yourdomain.com
     service: http://127.0.0.1:3100
   ```
   See also [`cloudflared/config.example.yml`](cloudflared/config.example.yml).
2. Prefer **Cloudflare Access** (email OTP) on that hostname, plus the app password.
3. Do **not** publish ports `5900` / `6080`.
4. Behind HTTPS, cookies become `Secure` automatically via `x-forwarded-proto`.

```bash
cloudflared tunnel run rdp   # or your tunnel name
# optional systemd: cloudflared.service
```

## Security notes

- App password is bcrypt-hashed in `.env` (mode `600`).
- Session cookie is HttpOnly JWT (`SESSION_SECRET`).
- `/vnc-ws` upgrades are rejected without a valid session cookie.
- Still treat the tunnel URL as sensitive; enable Cloudflare Access for defense in depth.
- Full desktop control = full user privileges of the logged-in session.

## Scripts

| Command | Purpose |
|---|---|
| `pnpm start` | Custom server (Next + WS proxy) |
| `npm run hash-password` | Print bcrypt hash for `.env` |
| `node scripts/gen-env.mjs` | Create `.env` with random password |
| `./scripts/start-x11vnc.sh` | Localhost x11vnc on `:0` |
| `./scripts/start-websockify.sh` | WS ↔ VNC bridge |
