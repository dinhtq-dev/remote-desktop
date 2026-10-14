# Remote Desktop Web

Browser-based desktop access for Linux, Windows, and macOS. Next.js serves login and noVNC; authenticated WebSocket connections bridge directly to a local VNC server. Run this app **on the machine being controlled**. Not suitable for Vercel.

## Requirements

- Node.js 20+ and npm or pnpm.
- A VNC server listening on `127.0.0.1:5900` (or configure `VNC_HOST` and `VNC_PORT` in `.env`).
- Linux X11: `x11vnc` can be started with `./start.sh`. Wayland is not supported by x11vnc.
- Windows: install and start a VNC server, configure its own VNC password and restrict it to localhost. Windows Remote Desktop (RDP) alone is not a VNC server.
- macOS: enable Screen Sharing in System Settings > General > Sharing; enable VNC viewer access with a VNC password if needed. Grant Screen Recording/Accessibility permissions when macOS requests them. Check where the server binds; restrict access with firewall rules if it cannot bind to localhost.

## Run on Windows

1. Install Node.js 20+ and a VNC server on this computer. Start VNC server, configure its VNC password and bind it to localhost (see your VNC server's settings). RDP does not work here.
2. Double-click `start.cmd` (do not double-click `start.ps1`), or run `./start.ps1` from an already open PowerShell window. First run creates `.env` and prints the login password; save it. `start.cmd` always waits for a key before closing.
4. Open `http://127.0.0.1:3100/login`. Enter web password; VNC may also ask for its own password.

## Run on macOS

1. Install Node.js 20+. Enable Screen Sharing in System Settings > General > Sharing and configure a VNC password. Limit external access to the VNC port with macOS firewall/network rules.
2. Run `npm run gen-env` once, then `bash ./start-macos.sh`.
3. Open `http://127.0.0.1:3100/login`. Grant macOS screen-control permissions if requested.

Launchers check VNC connectivity and install/build web dependencies, but cannot install or configure a VNC server automatically.

## Manual run

```sh
npm install
npm run gen-env
npm run build
npm start
```

`gen-env` prints a random login password and creates `.env`. Open `http://127.0.0.1:3100/login`. Set `VNC_HOST` and `VNC_PORT` in `.env` if your VNC server uses different settings. On Windows/macOS start the VNC server separately before opening the viewer. noVNC may prompt for the VNC server's separate password.

On Linux X11, install `x11vnc` and use `./start.sh` instead of `npm start` to launch both the VNC server and web app. Linux systemd units under `systemd/` are legacy; use `start.sh` for the integrated bridge.

Monitor selection uses `xrandr` and restarts `x11vnc` on Linux X11. Windows/macOS currently show the full VNC desktop; select displays using your VNC server's own settings. View scaling, fullscreen, and reconnect work on all platforms.

## Security

Web login controls `/vnc-ws`; VNC traffic is not exposed through a separate WebSocket port. Keep `HOST=127.0.0.1` and restrict VNC to localhost wherever possible. Do not expose VNC port 5900 to the internet. Use HTTPS and an additional access layer (for example Cloudflare Access) for remote connections. Desktop access grants privileges of the logged-in OS user. Change `AUTH_PASSWORD` and `SESSION_SECRET` in `.env` if compromised.
