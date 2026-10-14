import { NextResponse } from 'next/server'
import { SESSION_COOKIE_NAME } from '@/lib/auth'

export async function POST(request: Request) {
    const response = NextResponse.json({ ok: true })
    const forwarded = request.headers.get('x-forwarded-proto')
    const secure =
        process.env.COOKIE_SECURE === 'true' ||
        forwarded === 'https' ||
        (process.env.COOKIE_SECURE !== 'false' && new URL(request.url).protocol === 'https:')

    response.cookies.set({
        name: SESSION_COOKIE_NAME,
        value: '',
        httpOnly: true,
        sameSite: 'lax',
        secure,
        path: '/',
        maxAge: 0
    })

    return response
}
