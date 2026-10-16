'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useRouter } from 'next/navigation'

type ViewMode = 'fit' | 'original' | 'stretch' | 'shrink'

type DisplayInfo = {
    id: string
    name: string
    width: number
    height: number
    primary: boolean
    clip: string
}

type RfBInstance = {
    disconnect: () => void
    focus: () => void
    clipboardPasteFrom: (text: string) => void
    sendKey: (keysym: number, code: string, down?: boolean) => void
    scaleViewport: boolean
    resizeSession: boolean
    clipViewport: boolean
    dragViewport: boolean
    qualityLevel: number
    addEventListener: (type: string, listener: (...args: unknown[]) => void) => void
    removeEventListener: (type: string, listener: (...args: unknown[]) => void) => void
    _fbWidth?: number
    _fbHeight?: number
}

const VIEW_MODES: { id: ViewMode; label: string; hint: string }[] = [
    { id: 'fit', label: 'Fit', hint: 'Scale to window' },
    { id: 'original', label: '1:1', hint: 'Native size' },
    { id: 'stretch', label: 'Stretch', hint: 'Fill window' },
    { id: 'shrink', label: 'Shrink', hint: 'Downscale only' }
]

function applyViewMode(rfb: RfBInstance, mode: ViewMode, screenEl: HTMLElement) {
    const canvas = screenEl.querySelector('canvas') as HTMLCanvasElement | null

    if (mode === 'fit') {
        rfb.scaleViewport = true
        rfb.clipViewport = false
        rfb.dragViewport = false
        if (canvas) {
            canvas.style.width = ''
            canvas.style.height = ''
            canvas.style.objectFit = ''
        }
        return
    }

    if (mode === 'stretch') {
        rfb.scaleViewport = false
        rfb.clipViewport = false
        rfb.dragViewport = false
        if (canvas) {
            canvas.style.width = '100%'
            canvas.style.height = '100%'
            canvas.style.objectFit = 'fill'
        }
        return
    }

    if (mode === 'original') {
        rfb.scaleViewport = false
        rfb.clipViewport = true
        rfb.dragViewport = false
        if (canvas) {
            canvas.style.width = ''
            canvas.style.height = ''
            canvas.style.objectFit = ''
        }
        return
    }

    const fbW = rfb._fbWidth || canvas?.width || 0
    const fbH = rfb._fbHeight || canvas?.height || 0
    const needsShrink = fbW > screenEl.clientWidth || fbH > screenEl.clientHeight

    rfb.scaleViewport = needsShrink
    rfb.clipViewport = !needsShrink
    rfb.dragViewport = false

    if (canvas) {
        canvas.style.width = ''
        canvas.style.height = ''
        canvas.style.objectFit = ''
    }
}

function StatusDot({ status }: { status: string }) {
    const tone =
        status === 'Connected'
            ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]'
            : status.includes('Switch') || status.includes('Connecting')
              ? 'bg-amber-400 animate-pulse'
              : status === 'Disconnected' || status === 'Failed' || status === 'Error'
                ? 'bg-rose-400'
                : 'bg-zinc-500'

    return <span className={`inline-block h-2 w-2 rounded-full ${tone}`} aria-hidden />
}

function IconButton({
    label,
    onClick,
    danger = false,
    children
}: {
    label: string
    onClick: () => void
    danger?: boolean
    children: ReactNode
}) {
    return (
        <button
            type="button"
            title={label}
            aria-label={label}
            onClick={onClick}
            className={`inline-flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-xl border transition active:scale-95 sm:h-9 sm:w-9 sm:rounded-lg ${
                danger
                    ? 'border-rose-900/60 bg-rose-950/40 text-rose-200 hover:bg-rose-900/50'
                    : 'border-white/10 bg-white/5 text-zinc-200 hover:border-white/20 hover:bg-white/10'
            }`}
        >
            {children}
        </button>
    )
}

export function DesktopViewer() {
    const router = useRouter()
    const screenRef = useRef<HTMLDivElement | null>(null)
    const shellRef = useRef<HTMLDivElement | null>(null)
    const keyboardRef = useRef<HTMLTextAreaElement | null>(null)
    const composingRef = useRef(false)
    const rfbRef = useRef<RfBInstance | null>(null)
    const [status, setStatus] = useState('Connecting…')
    const [error, setError] = useState('')
    const [viewMode, setViewMode] = useState<ViewMode>('fit')
    const [isFullscreen, setIsFullscreen] = useState(false)
    const [displays, setDisplays] = useState<DisplayInfo[]>([])
    const [selection, setSelection] = useState('all')
    const [switching, setSwitching] = useState(false)
    const [reconnectToken, setReconnectToken] = useState(0)
    const [toolbarVisible, setToolbarVisible] = useState(true)
    const [showTouchHelp, setShowTouchHelp] = useState(false)

    const connected = status === 'Connected'
    const viewHint = VIEW_MODES.find((mode) => mode.id === viewMode)?.hint

    const loadDisplays = useCallback(async () => {
        try {
            const response = await fetch('/api/displays')
            if (!response.ok) {
                return
            }
            const data = (await response.json()) as {
                selection: string
                displays: DisplayInfo[]
            }
            setDisplays(data.displays || [])
            setSelection(data.selection || 'all')
        } catch {
            // ignore
        }
    }, [])

    useEffect(() => {
        void loadDisplays()
    }, [loadDisplays])

    useEffect(() => {
        function onFsChange() {
            const active = Boolean(document.fullscreenElement)
            setIsFullscreen(active)
        }

        document.addEventListener('fullscreenchange', onFsChange)
        return () => document.removeEventListener('fullscreenchange', onFsChange)
    }, [])

    useEffect(() => {
        if (!toolbarVisible) return
        if (window.matchMedia('(pointer: coarse)').matches) return
        const timeout = window.setTimeout(() => setToolbarVisible(false), 4000)
        return () => window.clearTimeout(timeout)
    }, [toolbarVisible])

    useEffect(() => {
        let cancelled = false

        async function connect() {
            if (!screenRef.current) {
                return
            }

            try {
                const mod = await import('@novnc/novnc')
                const RFB = (
                    mod as unknown as {
                        default: new (target: HTMLElement, url: string, options?: object) => RfBInstance
                    }
                ).default

                if (cancelled || !screenRef.current) {
                    return
                }

                const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
                const url = `${protocol}//${window.location.host}/vnc-ws`

                const rfb = new RFB(screenRef.current, url, {
                    wsProtocols: ['binary']
                })
                rfb.qualityLevel = 9
                rfb.resizeSession = false
                applyViewMode(rfb, viewMode, screenRef.current)
                rfb.focus()

                rfb.addEventListener('connect', () => {
                    if (!cancelled && screenRef.current) {
                        setStatus('Connected')
                        setError('')
                        applyViewMode(rfb, viewMode, screenRef.current)
                    }
                })
                rfb.addEventListener('disconnect', () => {
                    if (!cancelled) {
                        setStatus('Disconnected')
                        setError('VNC connection closed. Is a VNC server running?')
                    }
                })
                rfb.addEventListener('desktopresize', () => {
                    if (!cancelled && screenRef.current) {
                        applyViewMode(rfb, viewMode, screenRef.current)
                    }
                })

                rfbRef.current = rfb
            } catch (err) {
                if (!cancelled) {
                    setStatus('Failed')
                    setError(err instanceof Error ? err.message : 'Failed to load noVNC')
                }
            }
        }

        void connect()

        return () => {
            cancelled = true
            if (rfbRef.current) {
                try {
                    rfbRef.current.disconnect()
                } catch {
                    // ignore
                }
                rfbRef.current = null
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [reconnectToken])

    useEffect(() => {
        const rfb = rfbRef.current
        const screen = screenRef.current
        if (!rfb || !screen) {
            return
        }

        applyViewMode(rfb, viewMode, screen)

        const observer = new ResizeObserver(() => {
            if (rfbRef.current && screenRef.current) {
                applyViewMode(rfbRef.current, viewMode, screenRef.current)
            }
        })
        observer.observe(screen)

        return () => observer.disconnect()
    }, [viewMode, status, reconnectToken])

    async function logout() {
        await fetch('/api/logout', { method: 'POST' })
        router.replace('/login')
        router.refresh()
    }

    async function onDisplayChange(next: string) {
        if (next === selection) {
            return
        }

        setSwitching(true)
        setError('')
        setStatus('Switching display…')

        try {
            if (rfbRef.current) {
                try {
                    rfbRef.current.disconnect()
                } catch {
                    // ignore
                }
                rfbRef.current = null
            }

            const response = await fetch('/api/displays', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ selection: next })
            })
            const data = (await response.json()) as { error?: string; selection?: string }
            if (!response.ok) {
                throw new Error(data.error || 'Switch failed')
            }

            setSelection(data.selection || next)
            await loadDisplays()
            await new Promise((resolve) => setTimeout(resolve, 700))
            setReconnectToken((value) => value + 1)
        } catch (err) {
            setStatus('Error')
            setError(err instanceof Error ? err.message : 'Failed to switch display')
        } finally {
            setSwitching(false)
        }
    }

    async function toggleFullscreen() {
        const el = shellRef.current
        if (!el) {
            return
        }

        if (document.fullscreenElement) {
            await document.exitFullscreen()
        } else {
            await el.requestFullscreen()
        }
    }

    function sendText(text: string) {
        const rfb = rfbRef.current
        if (!rfb || !text) return

        rfb.clipboardPasteFrom(text)
        window.setTimeout(() => {
            rfb.sendKey(0xffe3, 'ControlLeft', true)
            rfb.sendKey(0x76, 'KeyV')
            rfb.sendKey(0xffe3, 'ControlLeft', false)
        }, 20)
    }

    function showKeyboard() {
        keyboardRef.current?.focus({ preventScroll: true })
    }

    return (
        <div
            ref={shellRef}
            className="relative flex h-dvh min-h-0 flex-col overflow-hidden bg-[#07080a] text-zinc-100"
        >
            <div
                className={`pointer-events-none absolute inset-x-0 top-0 z-20 bg-gradient-to-b from-black/70 to-transparent transition-opacity duration-300 ${
                    toolbarVisible ? 'h-28 opacity-100' : 'h-0 opacity-0'
                }`}
            />

            <header
                className={`remote-toolbar absolute inset-x-0 top-0 z-30 mx-2 transition-all duration-300 sm:mx-3 ${
                    toolbarVisible ? 'translate-y-0 opacity-100' : 'pointer-events-none -translate-y-4 opacity-0'
                }`}
            >
                <div className="pointer-events-auto flex max-h-[calc(100dvh-1rem)] flex-wrap items-center gap-2 overflow-y-auto rounded-2xl border border-white/10 bg-[#12141a]/90 px-2 py-2 shadow-[0_12px_40px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:gap-3 sm:px-3 sm:py-2.5">
                    <div className="mr-1 hidden min-w-[140px] items-center gap-2.5 sm:flex">
                        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/15 ring-1 ring-emerald-400/30">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-emerald-300">
                                <rect x="3" y="4" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="1.8" />
                                <path d="M8 20h8M12 16v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                            </svg>
                        </div>
                        <div className="leading-tight">
                            <div className="text-sm font-semibold tracking-wide">Remote Desktop</div>
                            <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                                <StatusDot status={status} />
                                <span>{status}</span>
                            </div>
                        </div>
                    </div>

                    <div className="hidden h-7 w-px bg-white/10 sm:block" />

                    <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
                        <div className="flex h-11 shrink-0 items-center gap-2 rounded-xl border border-white/10 bg-black/25 px-2.5 sm:h-auto sm:py-1.5">
                            <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-500">
                                Screen
                            </span>
                            <select
                                className="max-w-[200px] cursor-pointer appearance-none rounded-lg border-0 bg-transparent py-1 pr-5 text-sm text-zinc-100 outline-none"
                                value={selection}
                                disabled={switching}
                                onChange={(event) => void onDisplayChange(event.target.value)}
                                style={{
                                    backgroundImage:
                                        "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%71717a' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
                                    backgroundRepeat: 'no-repeat',
                                    backgroundPosition: 'right 0 center'
                                }}
                            >
                                <option value="all">All monitors</option>
                                {displays.map((display) => (
                                    <option key={display.id} value={display.id}>
                                        {display.primary ? '★ ' : ''}
                                        {display.name} · {display.width}×{display.height}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div
                            className="flex h-11 shrink-0 rounded-xl border border-white/10 bg-black/25 p-1 sm:h-auto"
                            role="group"
                            aria-label="View mode"
                        >
                            {VIEW_MODES.map((mode) => {
                                const active = viewMode === mode.id
                                return (
                                    <button
                                        key={mode.id}
                                        type="button"
                                        title={mode.hint}
                                        onClick={() => setViewMode(mode.id)}
                                        aria-pressed={active}
                                        className={`min-w-11 touch-manipulation rounded-lg px-2.5 py-1.5 text-xs font-medium transition active:scale-95 ${
                                            active
                                                ? 'bg-emerald-500 text-emerald-950 shadow-sm'
                                                : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-100'
                                        }`}
                                    >
                                        {mode.label}
                                    </button>
                                )
                            })}
                        </div>
                    </div>

                    <div className="ml-auto flex items-center gap-2 sm:gap-1.5">
                        {viewHint ? (
                            <span className="mr-1 hidden text-[11px] text-zinc-500 lg:inline">{viewHint}</span>
                        ) : null}

                        <IconButton label="Touch controls help" onClick={() => setShowTouchHelp((value) => !value)}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                <path d="M8 11V7a2 2 0 1 1 4 0v4-1a2 2 0 1 1 4 0v2-1a2 2 0 1 1 4 0v4c0 4-2.7 7-7 7h-1c-2.4 0-4-1-5.4-2.8L3.4 15a2 2 0 0 1 3.1-2.5L8 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        </IconButton>

                        <IconButton label="Show phone keyboard" onClick={showKeyboard}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" />
                                <path d="M7 9h1m3 0h1m3 0h1M7 13h1m3 0h1m3 0h1M8 16h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                            </svg>
                        </IconButton>

                        <IconButton label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'} onClick={() => void toggleFullscreen()}>
                            {isFullscreen ? (
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                                    <path d="M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                            ) : (
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                                    <path d="M3 9V3h6M15 3h6v6M21 15v6h-6M9 21H3v-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                            )}
                        </IconButton>

                        <IconButton label="Reconnect" onClick={() => setReconnectToken((value) => value + 1)}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                                <path
                                    d="M21 12a9 9 0 1 1-2.6-6.3"
                                    stroke="currentColor"
                                    strokeWidth="1.8"
                                    strokeLinecap="round"
                                />
                                <path d="M21 3v6h-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        </IconButton>

                        <IconButton label="Logout" danger onClick={() => void logout()}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                                <path
                                    d="M10 17v1a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v1"
                                    stroke="currentColor"
                                    strokeWidth="1.8"
                                    strokeLinecap="round"
                                />
                                <path d="M15 12H3m0 0 3-3m-3 3 3 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        </IconButton>
                    </div>
                </div>
            </header>

            {!toolbarVisible ? (
                <button
                    type="button"
                    className="remote-toolbar absolute left-1/2 z-30 min-h-11 -translate-x-1/2 touch-manipulation rounded-full border border-white/10 bg-black/60 px-4 py-2 text-xs text-zinc-200 backdrop-blur"
                    onClick={() => setToolbarVisible(true)}
                >
                    Show controls
                </button>
            ) : null}

            {showTouchHelp ? (
                <div className="remote-touch-help absolute inset-x-2 z-20 mx-auto max-w-sm rounded-2xl border border-white/10 bg-black/80 p-4 text-sm text-zinc-200 shadow-2xl backdrop-blur-xl" role="status">
                    <div className="mb-2 flex items-center justify-between gap-4">
                        <strong>Touch controls</strong>
                        <button type="button" className="min-h-11 rounded-lg px-3 text-zinc-300 active:bg-white/10" onClick={() => setShowTouchHelp(false)}>Close</button>
                    </div>
                    <ul className="space-y-1.5 text-zinc-300">
                        <li>Tap: left click</li>
                        <li>Two-finger tap: right click</li>
                        <li>One-finger drag: drag pointer</li>
                        <li>Two-finger drag: scroll</li>
                        <li>Pinch: zoom remote app</li>
                        <li>Keyboard button: type from phone</li>
                    </ul>
                </div>
            ) : null}

            <textarea
                ref={keyboardRef}
                className="fixed bottom-0 left-0 h-px w-px resize-none opacity-0"
                aria-label="Remote keyboard input"
                autoCapitalize="none"
                autoComplete="off"
                autoCorrect="off"
                inputMode="text"
                spellCheck={false}
                onCompositionStart={() => {
                    composingRef.current = true
                }}
                onCompositionEnd={(event) => {
                    composingRef.current = false
                    sendText(event.currentTarget.value)
                    event.currentTarget.value = ''
                }}
                onInput={(event) => {
                    if (composingRef.current) return
                    sendText(event.currentTarget.value)
                    event.currentTarget.value = ''
                }}
                onKeyDown={(event) => {
                    const rfb = rfbRef.current
                    if (!rfb) return

                    const keys: Record<string, [number, string]> = {
                        Backspace: [0xff08, 'Backspace'],
                        Enter: [0xff0d, 'Enter'],
                        Tab: [0xff09, 'Tab'],
                        Escape: [0xff1b, 'Escape'],
                        ArrowLeft: [0xff51, 'ArrowLeft'],
                        ArrowUp: [0xff52, 'ArrowUp'],
                        ArrowRight: [0xff53, 'ArrowRight'],
                        ArrowDown: [0xff54, 'ArrowDown']
                    }
                    const key = keys[event.key]
                    if (!key) return

                    event.preventDefault()
                    rfb.sendKey(key[0], key[1])
                }}
            />

            {error ? (
                <div className="relative z-20 mx-3 mt-2 rounded-xl border border-amber-500/30 bg-amber-950/70 px-4 py-2 text-sm text-amber-100 backdrop-blur">
                    {error}
                </div>
            ) : null}

            {!connected && !error ? (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
                    <div className="rounded-2xl border border-white/10 bg-black/50 px-5 py-4 text-sm text-zinc-300 backdrop-blur">
                        {switching ? 'Switching display…' : 'Connecting to desktop…'}
                    </div>
                </div>
            ) : null}

            <div
                ref={screenRef}
                className={`remote-screen relative min-h-0 flex-1 bg-black ${
                    viewMode === 'original' ? 'overflow-auto' : 'overflow-hidden'
                }`}
                onClick={() => {
                    if (!toolbarVisible) setToolbarVisible(true)
                    rfbRef.current?.focus()
                }}
            />
        </div>
    )
}
