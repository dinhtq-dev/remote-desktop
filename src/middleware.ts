import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'

const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'urw_session'

function getSecret(): Uint8Array | null {
    const secret = process.env.SESSION_SECRET
    if (!secret || secret.length < 16) {
        return null
    }

    return new TextEncoder().encode(secret)
}

async function isAuthed(request: NextRequest): Promise<boolean> {
    const secret = getSecret()
    if (!secret) {
        return false
    }

    const token = request.cookies.get(SESSION_COOKIE_NAME)?.value
    if (!token) {
        return false
    }

    try {
        await jwtVerify(token, secret)
        return true
    } catch {
        return false
    }
}

export async function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl
    const authed = await isAuthed(request)
    const host = request.headers.get('host') || request.nextUrl.host
    const protocol = request.headers.get('x-forwarded-proto') === 'https' ? 'https' : request.nextUrl.protocol.slice(0, -1)
    const origin = `${protocol}://${host}`

    if (pathname.startsWith('/desktop') && !authed) {
        const url = new URL('/login', origin)
        url.searchParams.set('next', pathname)
        return NextResponse.redirect(url)
    }

    if ((pathname === '/login' || pathname === '/') && authed) {
        return NextResponse.redirect(new URL('/desktop', origin))
    }

    return NextResponse.next()
}

export const config = {
    matcher: ['/', '/login', '/desktop/:path*']
}
