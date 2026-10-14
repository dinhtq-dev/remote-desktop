import { NextResponse } from 'next/server'

export async function GET() {
    return NextResponse.json({
        ok: true,
        service: 'remote-desktop',
        time: new Date().toISOString()
    })
}
