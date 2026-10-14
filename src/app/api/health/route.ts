import { NextResponse } from 'next/server'

export async function GET() {
    return NextResponse.json({
        ok: true,
        service: 'ubuntu-remote-web',
        time: new Date().toISOString()
    })
}
