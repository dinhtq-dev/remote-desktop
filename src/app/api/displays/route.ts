import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { SESSION_COOKIE_NAME, verifySessionToken } from '@/lib/auth'
import { getClipValue, getSelection, listDisplays, setDisplaySelection } from '@/lib/displays'

async function requireAuth(): Promise<boolean> {
    const jar = await cookies()
    const token = jar.get(SESSION_COOKIE_NAME)?.value
    if (!token) {
        return false
    }

    return verifySessionToken(token)
}

export async function GET() {
    if (!(await requireAuth())) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    try {
        const displays = await listDisplays()
        return NextResponse.json({
            selection: getSelection(),
            clip: getClipValue(),
            displays
        })
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Failed to list displays' },
            { status: 500 }
        )
    }
}

export async function POST(request: Request) {
    if (!(await requireAuth())) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let selection = 'all'
    try {
        const body = (await request.json()) as { selection?: string }
        selection = typeof body.selection === 'string' ? body.selection : 'all'
    } catch {
        return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    }

    try {
        const result = await setDisplaySelection(selection === 'all' ? 'all' : selection)
        const displays = await listDisplays()
        return NextResponse.json({
            ok: true,
            ...result,
            displays
        })
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Failed to switch display' },
            { status: 500 }
        )
    }
}
