import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const execFileAsync = promisify(execFile)

export type DisplayInfo = {
    id: string
    index: number
    name: string
    width: number
    height: number
    x: number
    y: number
    primary: boolean
    clip: string
}

export type DisplaySelection = 'all' | string

const RUNTIME_DIR = resolve(process.cwd(), '.runtime')
const CLIP_FILE = resolve(RUNTIME_DIR, 'vnc-clip')
const SELECTION_FILE = resolve(RUNTIME_DIR, 'vnc-selection')

function displayEnv(): NodeJS.ProcessEnv {
    return {
        ...process.env,
        DISPLAY: process.env.DISPLAY || ':0',
        XAUTHORITY: process.env.XAUTHORITY || `${process.env.HOME}/.Xauthority`
    }
}

export async function listDisplays(): Promise<DisplayInfo[]> {
    const { stdout } = await execFileAsync('xrandr', ['--listmonitors'], {
        env: displayEnv(),
        timeout: 5000
    })

    const displays: DisplayInfo[] = []
    const lines = stdout.split('\n')

    for (const line of lines) {
        //  0: +*DP-1 1920/476x1080/268+0+0  DP-1
        const match = line.match(
            /^\s*(\d+):\s+\+?(\*)?(\S+)\s+(\d+)\/\d+x(\d+)\/\d+\+(\d+)\+(\d+)\s+(\S+)/
        )
        if (!match) {
            continue
        }

        const index = Number(match[1])
        const primary = Boolean(match[2])
        const name = match[8] || match[3]
        const width = Number(match[4])
        const height = Number(match[5])
        const x = Number(match[6])
        const y = Number(match[7])

        displays.push({
            id: String(index),
            index,
            name,
            width,
            height,
            x,
            y,
            primary,
            clip: `${width}x${height}+${x}+${y}`
        })
    }

    return displays
}

export function getSelection(): DisplaySelection {
    if (!existsSync(SELECTION_FILE)) {
        return 'all'
    }

    const value = readFileSync(SELECTION_FILE, 'utf8').trim()
    return value || 'all'
}

export function getClipValue(): string {
    if (!existsSync(CLIP_FILE)) {
        return ''
    }

    return readFileSync(CLIP_FILE, 'utf8').trim()
}

export async function setDisplaySelection(selection: DisplaySelection): Promise<{
    selection: DisplaySelection
    clip: string
}> {
    mkdirSync(RUNTIME_DIR, { recursive: true, mode: 0o700 })

    let clip = ''
    if (selection !== 'all') {
        const displays = await listDisplays()
        const target = displays.find((item) => item.id === selection)
        if (!target) {
            throw new Error(`Display not found: ${selection}`)
        }
        clip = target.clip
    }

    writeFileSync(SELECTION_FILE, `${selection}\n`, { mode: 0o600 })
    writeFileSync(CLIP_FILE, clip ? `${clip}\n` : '', { mode: 0o600 })

    await restartX11vnc()

    return { selection, clip }
}

async function restartX11vnc(): Promise<void> {
    const script = resolve(process.cwd(), 'scripts/restart-x11vnc.sh')
    await execFileAsync('bash', [script], {
        env: displayEnv(),
        timeout: 15000,
        cwd: process.cwd()
    })
}
