import { NextResponse } from 'next/server'
import {
    SESSION_COOKIE_NAME,
    createSessionToken,
    getSessionMaxAge,
    verifyPassword
} from '@/lib/auth'

export async function POST(request: Request) {
    let password = ''

    try {
        const body = (await request.json()) as { password?: string }
        password = typeof body.password === 'string' ? body.password : ''
    } catch {
        return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    if (!password) {
        return NextResponse.json({ error: 'Password required' }, { status: 400 })
    }

    const ok = await verifyPassword(password)
    if (!ok) {
        return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
    }

    const token = await createSessionToken()
    const response = NextResponse.json({ ok: true })
    const forwarded = request.headers.get('x-forwarded-proto')
    const secure =
        process.env.COOKIE_SECURE === 'true' ||
        forwarded === 'https' ||
        (process.env.COOKIE_SECURE !== 'false' && new URL(request.url).protocol === 'https:')

    response.cookies.set({
        name: SESSION_COOKIE_NAME,
        value: token,
        httpOnly: true,
        sameSite: 'lax',
        secure,
        path: '/',
        maxAge: getSessionMaxAge()
    })

    return response
}
