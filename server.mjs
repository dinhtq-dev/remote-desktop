import 'dotenv/config'
import http from 'node:http'
import net from 'node:net'
import { parse as parseUrl } from 'node:url'
import { WebSocketServer, createWebSocketStream } from 'ws'
import { jwtVerify } from 'jose'

if (process.argv.includes('--production')) process.env.NODE_ENV = 'production'
const { default: next } = await import('next')
const dev = process.env.NODE_ENV !== 'production'
const host = process.env.HOST || '127.0.0.1'
const port = Number(process.env.PORT || 3100)
const vncHost = process.env.VNC_HOST || '127.0.0.1'
const vncPort = Number(process.env.VNC_PORT || 5900)
const cookieName = process.env.SESSION_COOKIE_NAME || 'urw_session'

const app = next({ dev, hostname: host, port })
const handle = app.getRequestHandler()
const wss = new WebSocketServer({ noServer: true })
wss.on('connection', (ws) => {
    const vnc = net.connect(vncPort, vncHost)
    const stream = createWebSocketStream(ws)
    vnc.pipe(stream).pipe(vnc)
    vnc.on('error', (err) => console.error('[vnc]', err.message))
    stream.on('error', (err) => console.error('[websocket]', err.message))
    vnc.on('close', () => stream.destroy())
    stream.on('close', () => vnc.destroy())
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
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
})

server.listen(port, host, () => {
    console.log(`[ubuntu-remote-web] http://${host}:${port}`)
    console.log(`[remote-web] /vnc-ws -> ${vncHost}:${vncPort} (auth required)`)
})
