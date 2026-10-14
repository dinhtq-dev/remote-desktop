import 'dotenv/config'
import http from 'node:http'
import { parse as parseUrl } from 'node:url'
import next from 'next'
import httpProxy from 'http-proxy'
import { jwtVerify } from 'jose'

const dev = process.env.NODE_ENV !== 'production'
const host = process.env.HOST || '127.0.0.1'
const port = Number(process.env.PORT || 3100)
const websockifyHost = process.env.WEBSOCKIFY_HOST || '127.0.0.1'
const websockifyPort = Number(process.env.WEBSOCKIFY_PORT || 6080)
const cookieName = process.env.SESSION_COOKIE_NAME || 'urw_session'

const app = next({ dev, hostname: host, port })
const handle = app.getRequestHandler()
const proxy = httpProxy.createProxyServer({
    target: `http://${websockifyHost}:${websockifyPort}`,
    ws: true,
    changeOrigin: true,
    xfwd: true
})

proxy.on('error', (err, _req, res) => {
    console.error('[proxy]', err.message)
    if (res && !res.headersSent && typeof res.writeHead === 'function') {
        res.writeHead(502, { 'Content-Type': 'text/plain' })
        res.end('Bad gateway: websockify unavailable')
    }
})

function getCookie(req, name) {
    const header = req.headers.cookie
    if (!header) {
        return null
    }

    const parts = header.split(';')
    for (const part of parts) {
        const [rawKey, ...rest] = part.trim().split('=')
        if (rawKey === name) {
            return decodeURIComponent(rest.join('='))
        }
    }

    return null
}

async function isAuthed(req) {
    const secret = process.env.SESSION_SECRET
    if (!secret || secret.length < 16) {
        return false
    }

    const token = getCookie(req, cookieName)
    if (!token) {
        return false
    }

    try {
        await jwtVerify(token, new TextEncoder().encode(secret))
        return true
    } catch {
        return false
    }
}

await app.prepare()

const server = http.createServer(async (req, res) => {
    try {
        const parsedUrl = parseUrl(req.url, true)
        await handle(req, res, parsedUrl)
    } catch (err) {
        console.error('[next]', err)
        res.statusCode = 500
        res.end('Internal Server Error')
    }
})

server.on('upgrade', async (req, socket, head) => {
    const { pathname } = parseUrl(req.url)
    if (pathname !== '/vnc-ws' && !pathname?.startsWith('/vnc-ws/')) {
        socket.destroy()
        return
    }

    const ok = await isAuthed(req)
    if (!ok) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
        socket.destroy()
        return
    }

    // websockify expects path / or /websockify — strip our prefix
    req.url = '/'
    proxy.ws(req, socket, head)
})

server.listen(port, host, () => {
    console.log(`[ubuntu-remote-web] http://${host}:${port}`)
    console.log(
        `[ubuntu-remote-web] proxy /vnc-ws -> ws://${websockifyHost}:${websockifyPort} (auth required)`
    )
})
