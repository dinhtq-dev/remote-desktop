'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { attachAdaptiveQuality, type AdaptiveQualityHandle } from '@/lib/adaptiveQuality'
import { keysymsForText, KEYSYMS } from '@/lib/remoteText'
import {
    attachLocalViewportZoom,
    baselineForViewMode,
    type LocalViewportZoomHandle,
    type PointerMode
} from '@/lib/localViewportZoom'

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
    sendKey: (keysym: number, code?: string, down?: boolean) => void
    scaleViewport: boolean
    resizeSession: boolean
    clipViewport: boolean
    dragViewport: boolean
    showDotCursor: boolean
    qualityLevel: number
    compressionLevel: number
    addEventListener: (type: string, listener: (...args: unknown[]) => void) => void
    removeEventListener: (type: string, listener: (...args: unknown[]) => void) => void
    _fbWidth?: number
    _fbHeight?: number
    _canvas?: HTMLCanvasElement
    _display?: {
        flip: (...args: unknown[]) => unknown
        scale: number
        absX: (x: number) => number
        absY: (y: number) => number
        viewportChangeSize: (w: number, h: number) => void
        viewportChangePos: (dx: number, dy: number) => void
        _viewportLoc?: { x: number; y: number; w: number; h: number }
    }
    _handleGesture?: (ev: Event) => void
    _eventHandlers?: { handleGesture: (ev: Event) => void }
}

const VIEW_MODES: { id: ViewMode; label: string; hint: string }[] = [
    { id: 'shrink', label: 'Shrink', hint: 'Downscale to fit screen without crop' },
    { id: 'fit', label: 'Fit', hint: 'Scale to window' },
    { id: 'stretch', label: 'Full', hint: 'Fill device screen (cover)' },
    { id: 'original', label: '1:1', hint: 'Native size · drag to pan' }
]

function isCoarsePointer() {
    return typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
}

function clearCanvasCss(canvas: HTMLCanvasElement | null) {
    if (!canvas) return
    // Keep width/height under noVNC control for correct pointer mapping.
    canvas.style.objectFit = ''
    canvas.style.maxWidth = ''
    canvas.style.maxHeight = ''
}

function applyViewMode(
    rfb: RfBInstance,
    mode: ViewMode,
    screenEl: HTMLElement,
    zoom?: LocalViewportZoomHandle | null
) {
    const canvas = screenEl.querySelector('canvas') as HTMLCanvasElement | null
    clearCanvasCss(canvas)

    screenEl.classList.toggle('remote-screen--cover', mode === 'stretch')

    const novncScreen = screenEl.querySelector(':scope > div') as HTMLElement | null
    if (novncScreen) {
        novncScreen.style.overflow = mode === 'original' && (!zoom || zoom.getZoom() <= 1) ? 'auto' : 'hidden'
    }

    // Local pinch-zoom owns scaling for cover/fit/native baselines.
    if (zoom) {
        zoom.setBaseline(baselineForViewMode(mode))
        return
    }

    if (mode === 'stretch' || mode === 'fit') {
        rfb.scaleViewport = mode === 'fit'
        rfb.clipViewport = false
        rfb.dragViewport = false
        if (mode === 'stretch' && rfb._display) {
            const fbW = rfb._fbWidth || canvas?.width || 0
            const fbH = rfb._fbHeight || canvas?.height || 0
            const cw = screenEl.clientWidth
            const ch = screenEl.clientHeight
            if (fbW && fbH && cw && ch) {
                rfb.scaleViewport = false
                rfb._display.scale = Math.max(cw / fbW, ch / fbH)
            }
        }
        return
    }

    if (mode === 'original') {
        rfb.scaleViewport = false
        rfb.clipViewport = true
        rfb.dragViewport = true
        return
    }

    const fbW = rfb._fbWidth || canvas?.width || 0
    const fbH = rfb._fbHeight || canvas?.height || 0
    const needsShrink = fbW > screenEl.clientWidth || fbH > screenEl.clientHeight

    rfb.scaleViewport = needsShrink
    rfb.clipViewport = !needsShrink
    rfb.dragViewport = !needsShrink
}

function ConnectionStatusIcon({ status }: { status: string }) {
    if (status === 'Connected') {
        return (
            <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-400/30"
                title="Đã kết nối (Connected)"
                aria-label="Đã kết nối"
            >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
            </div>
        )
    }

    if (status.includes('Switch') || status.includes('Connecting')) {
        return (
            <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-300 ring-1 ring-amber-400/30"
                title="Đang kết nối... (Connecting)"
                aria-label="Đang kết nối"
            >
                <svg className="animate-spin" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
            </div>
        )
    }

    return (
        <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-500/15 text-rose-400 ring-1 ring-rose-400/30"
            title={`Mất kết nối / Tắt (${status})`}
            aria-label="Mất kết nối"
        >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="2" y1="2" x2="22" y2="22" />
                <path d="M16.5 16.5 14 19a5 5 0 0 1-7.07-7.07l1.71-1.71" />
                <path d="M10 10 7.54 7.54a5 5 0 0 1 7.07-7.07l3 3a5 5 0 0 1 .54 7.54" />
            </svg>
        </div>
    )
}

function NetworkSignalBars({
    tier = 3,
    tooltip
}: {
    tier: number
    tooltip: string
}) {
    const activeCount = tier >= 4 ? 4 : tier === 3 ? 3 : tier === 2 ? 2 : 1
    const colorClass =
        tier >= 3
            ? 'text-emerald-400'
            : tier === 2
              ? 'text-amber-400'
              : tier === 1
                ? 'text-orange-400'
                : 'text-rose-400'

    const bgClass =
        tier >= 3
            ? 'bg-emerald-500/15 border-emerald-500/30'
            : tier === 2
              ? 'bg-amber-500/15 border-amber-500/30'
              : 'bg-rose-500/15 border-rose-500/30'

    return (
        <div
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border select-none transition cursor-help ${bgClass}`}
            title={tooltip}
            aria-label={tooltip}
        >
            {/* Cột sóng WiFi / Di động (4 cột) */}
            <svg
                width="14"
                height="12"
                viewBox="0 0 16 14"
                fill="currentColor"
                className={`shrink-0 ${colorClass}`}
                aria-hidden="true"
            >
                <rect x="1" y="9" width="2.5" height="4" rx="0.8" opacity={activeCount >= 1 ? 1 : 0.25} />
                <rect x="5" y="6" width="2.5" height="7" rx="0.8" opacity={activeCount >= 2 ? 1 : 0.25} />
                <rect x="9" y="3" width="2.5" height="10" rx="0.8" opacity={activeCount >= 3 ? 1 : 0.25} />
                <rect x="13" y="0" width="2.5" height="13" rx="0.8" opacity={activeCount >= 4 ? 1 : 0.25} />
            </svg>
        </div>
    )
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
            className={`inline-flex h-9 w-9 shrink-0 touch-manipulation items-center justify-center rounded-lg border transition active:scale-95 ${
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
    const keyboardRef = useRef<HTMLInputElement | null>(null)
    const rfbRef = useRef<RfBInstance | null>(null)
    const adaptiveRef = useRef<AdaptiveQualityHandle | null>(null)
    const zoomRef = useRef<LocalViewportZoomHandle | null>(null)
    const viewModeRef = useRef<ViewMode>('shrink')
    const fsAttemptedRef = useRef(false)
    const [status, setStatus] = useState('Connecting…')
    const [error, setError] = useState('')
    const [viewMode, setViewMode] = useState<ViewMode>('shrink')
    const [pointerMode, setPointerMode] = useState<PointerMode>(() => (isCoarsePointer() ? 'trackpad' : 'direct'))
    const [isFullscreen, setIsFullscreen] = useState(false)
    const [displays, setDisplays] = useState<DisplayInfo[]>([])
    const [selection, setSelection] = useState('all')
    const [switching, setSwitching] = useState(false)
    const [reconnectToken, setReconnectToken] = useState(0)
    const [toolbarVisible, setToolbarVisible] = useState(true)
    const [showTouchHelp, setShowTouchHelp] = useState(false)
    const [keyboardVisible, setKeyboardVisible] = useState(false)
    const [keyboardText, setKeyboardText] = useState('')
    const [qualityTier, setQualityTier] = useState(3)
    const [qualityTooltip, setQualityTooltip] = useState('Tự động tối ưu theo băng thông')
    const [zoomLabel, setZoomLabel] = useState('1×')
    const [textSelectArmed, setTextSelectArmed] = useState(false)
    const [isLandscape, setIsLandscape] = useState(false)
    const [keyboardDockTop, setKeyboardDockTop] = useState(false)
    const [dismissRotateHint, setDismissRotateHint] = useState(false)
    const pointerModeRef = useRef<PointerMode>(pointerMode)

    viewModeRef.current = viewMode
    pointerModeRef.current = pointerMode

    useEffect(() => {
        zoomRef.current?.setPointerMode(pointerMode)
    }, [pointerMode])

    const lockLandscape = useCallback(async () => {
        try {
            const orientation = screen.orientation as ScreenOrientation & {
                lock?: (orientation: string) => Promise<void>
            }
            if (orientation?.lock) {
                await orientation.lock('landscape')
                return true
            }
        } catch {
            // Ignored if browser requires user gesture or doesn't support lock (e.g. iOS Safari)
        }
        return false
    }, [])

    const lockLandscapeRef = useRef(lockLandscape)
    lockLandscapeRef.current = lockLandscape

    useEffect(() => {
        function checkOrientation() {
            if (typeof window === 'undefined') return
            const landscape = window.innerWidth > window.innerHeight
            setIsLandscape(landscape)
            if (landscape) {
                setKeyboardDockTop(true)
            }
        }
        checkOrientation()
        window.addEventListener('resize', checkOrientation)
        window.addEventListener('orientationchange', checkOrientation)
        return () => {
            window.removeEventListener('resize', checkOrientation)
            window.removeEventListener('orientationchange', checkOrientation)
        }
    }, [])

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

    // Pin shell to the visible viewport (hides iOS browser chrome gaps).
    useEffect(() => {
        const shell = shellRef.current
        if (!shell) return

        const sync = () => {
            const vv = window.visualViewport
            const height = vv?.height ?? window.innerHeight
            const offsetTop = vv?.offsetTop ?? 0
            shell.style.height = `${Math.round(height)}px`
            shell.style.top = `${Math.round(offsetTop)}px`
        }

        sync()
        window.visualViewport?.addEventListener('resize', sync)
        window.visualViewport?.addEventListener('scroll', sync)
        window.addEventListener('resize', sync)
        window.addEventListener('orientationchange', sync)
        return () => {
            window.visualViewport?.removeEventListener('resize', sync)
            window.visualViewport?.removeEventListener('scroll', sync)
            window.removeEventListener('resize', sync)
            window.removeEventListener('orientationchange', sync)
        }
    }, [])

    // Stop the mobile browser from pinch-zooming the page (Safari/Chrome).
    useEffect(() => {
        const shell = shellRef.current
        if (!shell) return

        const opts: AddEventListenerOptions = { passive: false, capture: true }

        const blockTouch = (event: TouchEvent) => {
            const target = event.target as HTMLElement | null
            if (!target || !shell.contains(target)) return

            // Multi-touch pinch would zoom the browser page — always block.
            if (event.touches.length > 1) {
                event.preventDefault()
                return
            }

            // Keep toolbar / form controls clickable; block page zoom on the VNC surface.
            if (target.closest('.remote-toolbar, .remote-mobile-fab, .remote-keyboard, button, a, select, input, textarea')) return
            event.preventDefault()
        }

        const blockGesture = (event: Event) => {
            event.preventDefault()
        }

        shell.addEventListener('touchstart', blockTouch, opts)
        shell.addEventListener('touchmove', blockTouch, opts)
        // Safari legacy gesture events
        shell.addEventListener('gesturestart', blockGesture, opts)
        shell.addEventListener('gesturechange', blockGesture, opts)
        shell.addEventListener('gestureend', blockGesture, opts)
        document.addEventListener('gesturestart', blockGesture, opts)
        document.addEventListener('gesturechange', blockGesture, opts)

        return () => {
            shell.removeEventListener('touchstart', blockTouch, opts)
            shell.removeEventListener('touchmove', blockTouch, opts)
            shell.removeEventListener('gesturestart', blockGesture, opts)
            shell.removeEventListener('gesturechange', blockGesture, opts)
            shell.removeEventListener('gestureend', blockGesture, opts)
            document.removeEventListener('gesturestart', blockGesture, opts)
            document.removeEventListener('gesturechange', blockGesture, opts)
        }
    }, [])

    useEffect(() => {
        function onFsChange() {
            const active = Boolean(
                document.fullscreenElement ||
                    (document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement
            )
            setIsFullscreen(active)
        }

        document.addEventListener('fullscreenchange', onFsChange)
        document.addEventListener('webkitfullscreenchange', onFsChange as EventListener)
        return () => {
            document.removeEventListener('fullscreenchange', onFsChange)
            document.removeEventListener('webkitfullscreenchange', onFsChange as EventListener)
        }
    }, [])

    useEffect(() => {
        if (!toolbarVisible) return
        const timeout = window.setTimeout(() => setToolbarVisible(false), 10_000)
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
                // UltraVNC/x11vnc cursor handling: do not force 3x3 dot so rich cursor shapes (I-beam, pointer) render properly.
                rfb.showDotCursor = false
                rfb.qualityLevel = 7
                rfb.compressionLevel = 2
                rfb.resizeSession = false
                rfb.focus()

                rfb.addEventListener('connect', () => {
                    if (!cancelled && screenRef.current) {
                        setStatus('Connected')
                        setError('')
                        if (isCoarsePointer()) {
                            void lockLandscapeRef.current()
                        }
                        // Attach AFTER noVNC registers gesture listeners so we can replace them.
                        zoomRef.current?.dispose()
                        zoomRef.current = attachLocalViewportZoom(rfb, screenRef.current, {
                            baseline: baselineForViewMode(viewModeRef.current),
                            pointerMode: pointerModeRef.current,
                            onZoomChange: (z) =>
                                setZoomLabel(`${z.toFixed(z >= 2 || z === 1 ? 0 : 1)}×`),
                            onTextSelectArmed: setTextSelectArmed,
                            onPointerModeChange: setPointerMode,
                            onToggleKeyboard: () => toggleKeyboardRef.current(),
                            onOpenKeyboard: () => showKeyboardRef.current(),
                            onToggleFullscreen: () => void toggleFullscreenRef.current(),
                            onToggleToolbar: () => setToolbarVisible((v) => !v)
                        })
                        applyViewMode(rfb, viewModeRef.current, screenRef.current, zoomRef.current)
                        adaptiveRef.current?.dispose()
                        adaptiveRef.current = attachAdaptiveQuality(rfb, (levels) => {
                            setQualityTier(levels.tier)
                            setQualityTooltip(levels.tooltip)
                        })
                    }
                })
                rfb.addEventListener('disconnect', () => {
                    if (!cancelled) {
                        adaptiveRef.current?.dispose()
                        adaptiveRef.current = null
                        zoomRef.current?.dispose()
                        zoomRef.current = null
                        setZoomLabel('1×')
                        setTextSelectArmed(false)
                        setStatus('Disconnected')
                        setError('VNC connection closed. Is a VNC server running?')
                    }
                })
                rfb.addEventListener('desktopresize', () => {
                    if (!cancelled && screenRef.current) {
                        applyViewMode(rfb, viewModeRef.current, screenRef.current, zoomRef.current)
                    }
                })
                rfb.addEventListener('clipboard', (event: unknown) => {
                    const detail = (event as CustomEvent<{ text?: string }>).detail
                    const text = detail?.text
                    if (!text || !navigator.clipboard?.writeText) return
                    void navigator.clipboard.writeText(text).catch(() => {
                        // ignore permission errors
                    })
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
            adaptiveRef.current?.dispose()
            adaptiveRef.current = null
            zoomRef.current?.dispose()
            zoomRef.current = null
            if (rfbRef.current) {
                try {
                    rfbRef.current.disconnect()
                } catch {
                    // ignore
                }
                rfbRef.current = null
            }
        }
    }, [reconnectToken])

    useEffect(() => {
        const rfb = rfbRef.current
        const screen = screenRef.current
        if (!rfb || !screen) {
            return
        }

        const reapply = () => {
            if (!rfbRef.current || !screenRef.current) return
            // After noVNC's own resize handler (may reset scale to 1).
            requestAnimationFrame(() => {
                if (rfbRef.current && screenRef.current) {
                    applyViewMode(rfbRef.current, viewMode, screenRef.current, zoomRef.current)
                }
            })
        }

        applyViewMode(rfb, viewMode, screen, zoomRef.current)

        const observer = new ResizeObserver(reapply)
        observer.observe(screen)
        window.visualViewport?.addEventListener('resize', reapply)
        window.addEventListener('orientationchange', reapply)

        return () => {
            observer.disconnect()
            window.visualViewport?.removeEventListener('resize', reapply)
            window.removeEventListener('orientationchange', reapply)
        }
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
        const el = shellRef.current as
            | (HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void })
            | null
        if (!el) {
            return
        }

        const doc = document as Document & {
            webkitFullscreenElement?: Element
            webkitExitFullscreen?: () => Promise<void> | void
        }

        const isNative = Boolean(document.fullscreenElement || doc.webkitFullscreenElement)

        if (isNative || isFullscreen) {
            if (isNative) {
                try {
                    if (document.exitFullscreen) await document.exitFullscreen()
                    else doc.webkitExitFullscreen?.()
                } catch {
                    // ignore
                }
            }
            setIsFullscreen(false)
            return
        }

        try {
            if (isCoarsePointer()) {
                void lockLandscape()
            }
            if (el.requestFullscreen) {
                await el.requestFullscreen()
                setIsFullscreen(true)
                return
            }
            if (el.webkitRequestFullscreen) {
                el.webkitRequestFullscreen()
                setIsFullscreen(true)
                return
            }
        } catch {
            // iOS Safari blocks Fullscreen API on divs
        }

        // Fallback for iOS or environments where Fullscreen API is restricted
        setIsFullscreen(true)
    }

    const toggleFullscreenRef = useRef(toggleFullscreen)
    toggleFullscreenRef.current = toggleFullscreen

    async function sendText(text: string) {
        const rfb = rfbRef.current
        if (!rfb || !text) return

        // Keysyms reach the focused remote window. Clipboard Ctrl+V does not.
        for (const keysym of keysymsForText(text)) {
            if (rfbRef.current !== rfb) return
            rfb.sendKey(keysym, undefined, true)
            rfb.sendKey(keysym, undefined, false)
            await new Promise((resolve) => window.setTimeout(resolve, 8))
        }
    }

    const showKeyboard = useCallback(() => {
        setKeyboardVisible(true)
        requestAnimationFrame(() => {
            keyboardRef.current?.focus()
        })
    }, [])

    const toggleKeyboard = useCallback(() => {
        setKeyboardVisible((prev) => {
            const next = !prev
            if (next) {
                requestAnimationFrame(() => {
                    keyboardRef.current?.focus()
                })
            } else {
                keyboardRef.current?.blur()
            }
            return next
        })
    }, [])

    const hideKeyboard = useCallback(() => {
        setKeyboardVisible(false)
        keyboardRef.current?.blur()
    }, [])

    const toggleKeyboardRef = useRef(toggleKeyboard)
    toggleKeyboardRef.current = toggleKeyboard
    const showKeyboardRef = useRef(showKeyboard)
    showKeyboardRef.current = showKeyboard

    async function submitKeyboardText(withEnter = false) {
        const text = keyboardRef.current?.value ?? keyboardText
        if (text) {
            await sendText(text)
            setKeyboardText('')
            if (keyboardRef.current) {
                keyboardRef.current.value = ''
            }
        }
        if (withEnter || !text) {
            sendSpecialKey(KEYSYMS.Return, 'Enter')
        }
    }

    function sendSpecialKey(keysym: number, code?: string) {
        const rfb = rfbRef.current
        if (!rfb) return
        rfb.sendKey(keysym, code, true)
        rfb.sendKey(keysym, code, false)
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
            try {
                navigator.vibrate(25)
            } catch {
                // ignore
            }
        }
    }

    function sendCad() {
        const rfb = rfbRef.current
        if (!rfb) return
        // Ctrl + Alt + Delete (Windows secure attention)
        rfb.sendKey(0xffe3, 'ControlLeft', true)
        rfb.sendKey(0xffe9, 'AltLeft', true)
        rfb.sendKey(0xffff, 'Delete', true)
        rfb.sendKey(0xffff, 'Delete', false)
        rfb.sendKey(0xffe9, 'AltLeft', false)
        rfb.sendKey(0xffe3, 'ControlLeft', false)
    }

    /** Send Ctrl+key on the remote (for Copy / Select all on mobile). */
    function sendCtrlKey(keysym: number, code: string) {
        const rfb = rfbRef.current
        if (!rfb) return
        rfb.sendKey(0xffe3, 'ControlLeft', true)
        rfb.sendKey(keysym, code)
        rfb.sendKey(0xffe3, 'ControlLeft', false)
    }

    function copyOnRemote() {
        // After user drag-selects text on remote, tap this to Ctrl+C.
        sendCtrlKey(0x63, 'KeyC')
    }

    function selectAllOnRemote() {
        sendCtrlKey(0x61, 'KeyA')
    }

    async function pasteFromClipboard() {
        const rfb = rfbRef.current
        if (!rfb || !navigator.clipboard?.readText) return
        try {
            const text = await navigator.clipboard.readText()
            if (text) sendText(text)
        } catch {
            // ignore permission errors
        }
    }

    return (
        <div
            ref={shellRef}
            className={`remote-shell relative flex min-h-0 flex-col text-zinc-100 ${
                isFullscreen ? 'remote-shell--pseudo-fs' : ''
            }`}
        >
            <div
                className={`pointer-events-none absolute inset-x-0 top-0 z-20 bg-gradient-to-b from-black/60 to-transparent transition-opacity duration-300 ${
                    toolbarVisible ? 'h-14 opacity-100 sm:h-24' : 'h-0 opacity-0'
                }`}
            />

            <header
                className={`remote-toolbar absolute inset-x-0 top-0 z-30 mx-1.5 transition-all duration-300 sm:mx-3 ${
                    toolbarVisible ? 'translate-y-0 opacity-100' : 'pointer-events-none -translate-y-4 opacity-0'
                }`}
            >
                <div className="pointer-events-auto flex items-center gap-1.5 overflow-x-auto overscroll-x-contain rounded-xl border border-white/10 bg-[#12141a]/92 px-1.5 py-1 shadow-[0_8px_28px_rgba(0,0,0,0.4)] backdrop-blur-xl sm:gap-3 sm:rounded-2xl sm:px-3 sm:py-2.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {/* Compact Logo & Connection Status Icon */}
                    <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
                        <div
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 ring-1 ring-emerald-400/30 sm:h-9 sm:w-9 sm:rounded-xl"
                            title="Remote Desktop"
                            aria-label="Remote Desktop"
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-emerald-300">
                                <rect x="3" y="4" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="1.8" />
                                <path d="M8 20h8M12 16v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                            </svg>
                        </div>

                        <ConnectionStatusIcon status={status} />
                    </div>

                    <div className="h-6 w-px bg-white/10 sm:h-7" />

                    <div className="flex shrink-0 items-center gap-1 rounded-lg border border-white/10 bg-black/25 px-1.5 py-0.5 sm:gap-2 sm:px-2.5 sm:py-1.5">
                        <select
                            className="max-w-[7.5rem] cursor-pointer appearance-none rounded-md border-0 bg-transparent py-1 pr-4 text-xs text-zinc-100 outline-none sm:max-w-[200px] sm:text-sm"
                            value={selection}
                            disabled={switching}
                            aria-label="Screen"
                            onChange={(event) => void onDisplayChange(event.target.value)}
                            style={{
                                backgroundImage:
                                    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%71717a' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
                                backgroundRepeat: 'no-repeat',
                                backgroundPosition: 'right 0 center'
                            }}
                        >
                            <option value="all">All</option>
                            {displays.map((display) => (
                                <option key={display.id} value={display.id}>
                                    {display.primary ? '★ ' : ''}
                                    {display.name}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div
                        className="flex shrink-0 rounded-lg border border-white/10 bg-black/25 p-0.5"
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
                                    className={`touch-manipulation rounded-md px-2 py-1 text-[11px] font-medium transition active:scale-95 sm:px-2.5 sm:text-xs ${
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

                    <div className="ml-auto flex shrink-0 items-center gap-1">
                        {connected && zoomLabel !== '1×' ? (
                            <button
                                type="button"
                                title="Reset local zoom"
                                className="rounded-md border border-sky-500/30 bg-sky-500/10 px-1.5 py-1 text-[11px] text-sky-100"
                                onClick={() => zoomRef.current?.reset()}
                            >
                                {zoomLabel}
                            </button>
                        ) : null}

                        <IconButton
                            label="Copy (Ctrl+C)"
                            onClick={() => {
                                copyOnRemote()
                                zoomRef.current?.clearTextSelect()
                            }}
                        >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.8" />
                                <path d="M5 15V5a2 2 0 0 1 2-2h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                            </svg>
                        </IconButton>

                        <IconButton label="Paste" onClick={() => void pasteFromClipboard()}>
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                <path d="M9 5h6a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.8" />
                                <path d="M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2" stroke="currentColor" strokeWidth="1.8" />
                            </svg>
                        </IconButton>

                        <IconButton label="Keyboard" onClick={showKeyboard}>
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" />
                                <path d="M7 9h1m3 0h1m3 0h1M7 13h1m3 0h1m3 0h1M8 16h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                            </svg>
                        </IconButton>

                        <IconButton
                            label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                            onClick={() => void toggleFullscreen()}
                        >
                            {isFullscreen ? (
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                                    <path d="M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                            ) : (
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                                    <path d="M3 9V3h6M15 3h6v6M21 15v6h-6M9 21H3v-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                            )}
                        </IconButton>

                        <IconButton
                            label="Touch help"
                            onClick={() => setShowTouchHelp((value) => !value)}
                        >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                <path d="M8 11V7a2 2 0 1 1 4 0v4-1a2 2 0 1 1 4 0v2-1a2 2 0 1 1 4 0v4c0 4-2.7 7-7 7h-1c-2.4 0-4-1-5.4-2.8L3.4 15a2 2 0 0 1 3.1-2.5L8 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        </IconButton>

                        <NetworkSignalBars tier={qualityTier} tooltip={qualityTooltip} />

                        <span className="hidden sm:contents">
                            <IconButton label="Select all (Ctrl+A)" onClick={selectAllOnRemote}>
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                    <path d="M4 7h16M4 12h10M4 17h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                                </svg>
                            </IconButton>
                            <IconButton label="Ctrl+Alt+Del" onClick={sendCad}>
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                    <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.8" />
                                    <path d="M7 9h10M7 13h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                                </svg>
                            </IconButton>
                            {viewHint ? (
                                <span className="hidden text-[11px] text-zinc-500 xl:inline">{viewHint}</span>
                            ) : null}
                        </span>

                        <IconButton label="Reconnect" onClick={() => setReconnectToken((value) => value + 1)}>
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                                <path d="M21 12a9 9 0 1 1-2.6-6.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                                <path d="M21 3v6h-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        </IconButton>

                        <IconButton label="Logout" danger onClick={() => void logout()}>
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                                <path
                                    d="M10 17v1a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v1"
                                    stroke="currentColor"
                                    strokeWidth="1.8"
                                    strokeLinecap="round"
                                />
                                <path d="M15 12H3m0 0 3-3m-3 3 3 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        </IconButton>

                        <IconButton label="Thu gọn menu" onClick={() => setToolbarVisible(false)}>
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                <path d="m18 15-6-6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        </IconButton>
                    </div>
                </div>
            </header>

            {!toolbarVisible ? (
                <button
                    type="button"
                    className="remote-show-controls hidden sm:flex"
                    aria-label="Show controls"
                    title="Show controls"
                    onClick={() => setToolbarVisible(true)}
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path
                            d="M14 6 8 12l6 6"
                            stroke="currentColor"
                            strokeWidth="2.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                    </svg>
                </button>
            ) : null}

            {/* Floating Mobile Action Pill: always accessible without blocking desktop tabs/menus */}
            <div className="remote-mobile-fab fixed bottom-3 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-white/15 bg-[#12141a]/92 px-2 py-1.5 shadow-[0_8px_30px_rgba(0,0,0,0.5)] backdrop-blur-xl sm:hidden">
                <button
                    type="button"
                    onClick={() => {
                        const next = pointerMode === 'trackpad' ? 'direct' : 'trackpad'
                        setPointerMode(next)
                        zoomRef.current?.setPointerMode(next)
                    }}
                    title={
                        pointerMode === 'trackpad'
                            ? 'Chế độ Rê chuột (bấm để đổi sang Chạm)'
                            : 'Chế độ Chạm trực tiếp (bấm để đổi sang Rê chuột)'
                    }
                    className={`flex h-10 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition active:scale-95 ${
                        pointerMode === 'trackpad'
                            ? 'border border-emerald-400/40 bg-emerald-500/20 text-emerald-200'
                            : 'border border-white/10 bg-white/10 text-zinc-200 active:bg-white/20'
                    }`}
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        {pointerMode === 'trackpad' ? (
                            <>
                                <rect x="3" y="4" width="18" height="16" rx="3" stroke="currentColor" strokeWidth="1.8" />
                                <path d="M12 15v5M3 15h18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                            </>
                        ) : (
                            <path
                                d="M12 3a2 2 0 0 0-2 2v7.5l-1.5-1.5a2 2 0 1 0-2.8 2.8l4.5 4.5c2.3 2.3 6.8 2.3 9.1 0l.7-.7c.9-.9.9-2.3 0-3.2l-4-4a2 2 0 0 0-3.4 1.4V5a2 2 0 0 0-2-2z"
                                stroke="currentColor"
                                strokeWidth="1.6"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            />
                        )}
                    </svg>
                    <span>{pointerMode === 'trackpad' ? 'Rê chuột' : 'Chạm'}</span>
                </button>

                <button
                    type="button"
                    onClick={showKeyboard}
                    title="Mở bàn phím"
                    className="flex h-10 items-center gap-1.5 rounded-full bg-white/10 px-3 text-xs font-medium text-zinc-100 active:scale-95 active:bg-white/20"
                >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" />
                        <path d="M7 9h1m3 0h1m3 0h1M7 13h1m3 0h1m3 0h1M8 16h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    </svg>
                    <span>Phím</span>
                </button>

                <button
                    type="button"
                    onClick={() => {
                        const next = !textSelectArmed
                        setTextSelectArmed(next)
                        zoomRef.current?.setDragMode(next)
                    }}
                    title="Bôi đen / Kéo thả"
                    className={`flex h-10 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition active:scale-95 ${
                        textSelectArmed
                            ? 'bg-amber-500 text-amber-950 font-semibold shadow-sm'
                            : 'bg-white/10 text-zinc-200 active:bg-white/20'
                    }`}
                >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M4 7h16M4 12h10M4 17h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    </svg>
                    <span>{textSelectArmed ? 'Đang kéo' : 'Kéo thả'}</span>
                </button>

                {zoomLabel !== '1×' ? (
                    <button
                        type="button"
                        onClick={() => zoomRef.current?.reset()}
                        title="Reset zoom"
                        className="flex h-10 items-center rounded-full bg-sky-500/20 border border-sky-400/40 px-2.5 text-xs font-medium text-sky-200"
                    >
                        {zoomLabel}
                    </button>
                ) : null}

                <button
                    type="button"
                    onClick={() => void toggleFullscreen()}
                    title={isFullscreen ? 'Thu nhỏ màn hình' : 'Thu phóng toàn màn hình'}
                    className={`flex h-10 w-10 items-center justify-center rounded-full border border-white/10 active:scale-95 ${
                        isFullscreen ? 'bg-sky-500/25 text-sky-200 border-sky-400/40' : 'bg-white/10 text-zinc-200'
                    }`}
                    aria-label="Thu phóng toàn màn hình"
                >
                    {isFullscreen ? (
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                            <path d="M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    ) : (
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                            <path d="M3 9V3h6M15 3h6v6M21 15v6h-6M9 21H3v-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    )}
                </button>

                <button
                    type="button"
                    onClick={() => setShowTouchHelp(true)}
                    title="Xem hướng dẫn cử chỉ cảm ứng"
                    className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/10 text-zinc-200 active:scale-95 active:bg-white/20"
                    aria-label="Hướng dẫn cảm ứng"
                >
                    <span className="text-sm">📖</span>
                </button>

                <button
                    type="button"
                    onClick={() => setToolbarVisible((v) => !v)}
                    title={toolbarVisible ? 'Thu gọn menu' : 'Mở menu điều khiển'}
                    className={`flex h-10 w-10 items-center justify-center rounded-full border border-white/10 active:scale-95 ${
                        toolbarVisible ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/10 text-zinc-200'
                    }`}
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        {toolbarVisible ? (
                            <path d="m18 15-6-6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        ) : (
                            <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        )}
                    </svg>
                </button>
            </div>

            {textSelectArmed ? (
                <div
                    className="remote-text-select-hint pointer-events-none absolute inset-x-0 bottom-16 z-30 flex justify-center px-3"
                    role="status"
                >
                    <div className="rounded-full border border-amber-400/50 bg-amber-950/85 px-3 py-1.5 text-xs text-amber-100 shadow-lg backdrop-blur">
                        Chạm &amp; kéo để bôi đen/di chuyển · Chạm nút &quot;Kéo thả&quot; để nhả
                    </div>
                </div>
            ) : null}

            {showTouchHelp ? (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 backdrop-blur-md"
                    onClick={() => setShowTouchHelp(false)}
                >
                    <div
                        className="relative flex max-h-[calc(100dvh-2.5rem)] w-full max-w-lg flex-col rounded-2xl border border-white/20 bg-[#12141a]/98 text-zinc-100 shadow-[0_25px_60px_rgba(0,0,0,0.85)] backdrop-blur-2xl"
                        role="dialog"
                        aria-modal="true"
                        aria-label="Hướng dẫn cử chỉ cảm ứng"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-3">
                            <div className="flex items-center gap-2">
                                <span className="text-lg">📖</span>
                                <div>
                                    <h3 className="text-sm font-bold text-white">Hướng dẫn điều khiển cảm ứng</h3>
                                    <p className="text-[11px] text-zinc-400">Cử chỉ vuốt chạm chuẩn remote desktop</p>
                                </div>
                            </div>
                            <button
                                type="button"
                                className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-xs font-bold text-zinc-300 hover:text-white active:bg-white/20"
                                onClick={() => setShowTouchHelp(false)}
                                aria-label="Đóng"
                            >
                                ✕
                            </button>
                        </div>

                        {/* Scrollable Content */}
                        <div className="flex-1 overflow-y-auto overscroll-contain p-4 space-y-4 text-xs text-zinc-300 [-webkit-overflow-scrolling:touch]">
                            {/* 1 Ngón */}
                            <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-2">
                                <div className="flex items-center gap-2 font-semibold text-emerald-300 text-[13px]">
                                    <span>👆</span>
                                    <span>Chạm 1 ngón tay (Chuột cơ bản &amp; Kéo thả)</span>
                                </div>
                                <ul className="space-y-1.5 pl-1">
                                    <li>• <strong className="text-zinc-100">Click chuột trái:</strong> Chạm nhẹ 1 ngón để click (chọn file/thư mục, bấm link hoặc nút).</li>
                                    <li>• <strong className="text-zinc-100">Double Click:</strong> Chạm 2 lần nhanh liên tiếp để mở file, thư mục hoặc ứng dụng.</li>
                                    <li>• <strong className="text-zinc-100">Chuột phải (File/Thư mục):</strong> Nhấn giữ ngón tay tại chỗ (~450ms) không di chuyển để mở menu ngữ cảnh gốc của file/thư mục đó.</li>
                                    <li>• <strong className="text-zinc-100">Kéo thả / Quét vùng chọn / Bôi đen:</strong> Nhấn giữ ~250ms rồi kéo tay để di chuyển cửa sổ/file, kéo khung quét chọn nhiều file, hoặc bôi đen đoạn văn bản. Nhấc tay ra là kết thúc kéo.</li>
                                    <li>• <strong className="text-zinc-100">Chế độ Rê chuột (Trackpad):</strong> Vuốt ngón tay ở bất kỳ đâu để di chuyển con trỏ chuột tương đối, ngón tay không bị che khuất tầm nhìn.</li>
                                </ul>
                            </div>

                            {/* 2 Ngón */}
                            <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-2">
                                <div className="flex items-center gap-2 font-semibold text-emerald-300 text-[13px]">
                                    <span>✌️</span>
                                    <span>Chạm 2 ngón tay (Chuột phải, Cuộn, Thu phóng)</span>
                                </div>
                                <ul className="space-y-1.5 pl-1">
                                    <li>• <strong className="text-zinc-100">Chuột phải tức thì:</strong> Chạm nhẹ 2 ngón tay cùng lúc lên màn hình để mở ngay menu chuột phải.</li>
                                    <li>• <strong className="text-zinc-100">Cuộn trang (Mouse Wheel):</strong> Đặt 2 ngón tay vuốt lên hoặc xuống cùng lúc để cuộn văn bản/trang web.</li>
                                    <li>• <strong className="text-zinc-100">Thu phóng màn hình (Zoom):</strong> Dùng 2 ngón tay chụm lại hoặc mở rộng (Pinch) để phóng to/thu nhỏ vùng cần xem. Khi phóng to, nút reset zoom (ví dụ 1.5×, 2×) sẽ xuất hiện để bấm về 1×.</li>
                                </ul>
                            </div>

                            {/* 3 Ngón */}
                            <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-2">
                                <div className="flex items-center gap-2 font-semibold text-emerald-300 text-[13px]">
                                    <span>🖐️</span>
                                    <span>Chạm 3 ngón tay (Bàn phím &amp; Soạn thảo)</span>
                                </div>
                                <ul className="space-y-1.5 pl-1">
                                    <li>• <strong className="text-zinc-100">Bật / Tắt Bàn phím nhanh:</strong> Chạm nhẹ 3 ngón tay cùng lúc lên màn hình để mở ngay bàn phím ảo kèm thanh soạn thảo tiếng Việt.</li>
                                </ul>
                            </div>

                            {/* 4 Ngón & 5 Ngón */}
                            <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-2">
                                <div className="flex items-center gap-2 font-semibold text-emerald-300 text-[13px]">
                                    <span>🖐️</span>
                                    <span>Chạm 4 ngón &amp; 5 ngón tay (Cử chỉ nâng cao)</span>
                                </div>
                                <ul className="space-y-1.5 pl-1">
                                    <li>• <strong className="text-zinc-100">Chạm 4 ngón tay:</strong> Bật / tắt chế độ toàn màn hình (Ô vuông thu phóng Fullscreen).</li>
                                    <li>• <strong className="text-zinc-100">Chạm 5 ngón tay:</strong> Thu gọn hoặc hiển thị lại thanh công cụ menu phía trên.</li>
                                </ul>
                            </div>

                            {/* Các nút trên thanh điều khiển */}
                            <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-2">
                                <div className="flex items-center gap-2 font-semibold text-emerald-300 text-[13px]">
                                    <span>⚙️</span>
                                    <span>Thanh điều khiển nhanh dưới đáy (Floating Pill)</span>
                                </div>
                                <ul className="space-y-1.5 pl-1">
                                    <li>• <strong className="text-zinc-100">Nút [Rê chuột / Chạm]:</strong> Chuyển đổi qua lại giữa bàn rê chuột ảo (Trackpad) và chạm trực tiếp (Direct Touch).</li>
                                    <li>• <strong className="text-zinc-100">Nút [Phím]:</strong> Bật bàn phím ảo và thanh nhập liệu tiếng Việt trực tiếp (nhấn Enter hoặc bấm [Gửi ⏎] để thực thi lệnh).</li>
                                    <li>• <strong className="text-zinc-100">Nút [Kéo thả]:</strong> Khóa giữ chuột trái liên tục để kéo thả nhiều mục mà không lo trượt tay.</li>
                                    <li>• <strong className="text-zinc-100">Nút [⛶ Ô vuông thu phóng]:</strong> Phóng to toàn màn hình tràn viền (hỗ trợ cả iPhone, iPad và Android).</li>
                                    <li>• <strong className="text-zinc-100">Nút [📖 Hướng dẫn]:</strong> Mở bảng hướng dẫn này.</li>
                                    <li>• <strong className="text-zinc-100">Nút [☰ Menu]:</strong> Mở thanh menu trên cùng chứa các tùy chọn màn hình, chất lượng, sao chép, dán, đăng xuất.</li>
                                </ul>
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="shrink-0 border-t border-white/10 p-3 bg-black/20">
                            <button
                                type="button"
                                className="w-full rounded-xl bg-emerald-500 py-2.5 text-xs font-bold text-emerald-950 active:bg-emerald-400"
                                onClick={() => setShowTouchHelp(false)}
                            >
                                Đã hiểu &amp; Đóng ✕
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}

            {/* Suggest Landscape Mode on Mobile Portrait */}
            {!isLandscape && isCoarsePointer() && connected && !dismissRotateHint ? (
                <div className="fixed top-14 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 rounded-full border border-sky-400/40 bg-[#12141a]/95 px-3 py-1.5 text-xs text-sky-200 shadow-xl backdrop-blur-xl animate-fade-in">
                    <span>🔄</span>
                    <span className="text-[11px] font-medium">Xoay ngang để xem trọn vẹn màn hình</span>
                    <button
                        type="button"
                        className="rounded-full bg-sky-500/25 px-2.5 py-0.5 text-[11px] font-bold text-sky-200 active:scale-95"
                        onClick={() => {
                            void lockLandscape()
                            void toggleFullscreen()
                        }}
                    >
                        Xoay ngay
                    </button>
                    <button
                        type="button"
                        className="ml-1 text-xs text-zinc-400 hover:text-white"
                        onClick={() => setDismissRotateHint(true)}
                        aria-label="Đóng gợi ý xoay"
                    >
                        ✕
                    </button>
                </div>
            ) : null}

            {keyboardVisible ? (
                <div
                    className={`remote-keyboard fixed inset-x-0 z-50 flex flex-col gap-1.5 bg-[#12141a]/98 px-2 shadow-2xl backdrop-blur-2xl transition-all ${
                        keyboardDockTop
                            ? 'top-0 border-b border-white/15 pt-[max(0.4rem,env(safe-area-inset-top))] pb-1.5'
                            : 'bottom-0 border-t border-white/15 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1.5'
                    }`}
                >
                    {isLandscape ? (
                        /* Landscape Mode: Single-Row Ultra-Slim (cao ~36px, không che nội dung máy tính) */
                        <div className="flex items-center gap-1.5 w-full">
                            {/* Input + Gửi */}
                            <div className="flex items-center gap-1 flex-1 max-w-[320px] sm:max-w-[420px]">
                                <input
                                    ref={keyboardRef}
                                    type="text"
                                    className="h-8 flex-1 rounded-lg border border-white/10 bg-black/50 px-2.5 text-xs text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-emerald-400/60"
                                    aria-label="Thanh soạn thảo văn bản"
                                    autoCapitalize="none"
                                    autoComplete="off"
                                    autoCorrect="off"
                                    inputMode="text"
                                    placeholder="Nhập lệnh hoặc gõ văn bản…"
                                    spellCheck={false}
                                    value={keyboardText}
                                    onChange={(event) => setKeyboardText(event.target.value)}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter') {
                                            event.preventDefault()
                                            void submitKeyboardText(true)
                                        }
                                    }}
                                />
                                <button
                                    type="button"
                                    className="h-8 shrink-0 rounded-lg bg-emerald-500 px-2.5 text-xs font-semibold text-emerald-950 active:bg-emerald-400 disabled:opacity-40"
                                    disabled={!keyboardText}
                                    onClick={() => void submitKeyboardText(true)}
                                    title="Gửi nội dung và nhấn Enter"
                                >
                                    Gửi ⏎
                                </button>
                            </div>

                            {/* Accessory keys cuộn ngang */}
                            <div className="flex items-center gap-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                                <button
                                    type="button"
                                    className="h-8 shrink-0 rounded-lg border border-white/10 bg-white/5 px-2 text-xs font-semibold text-zinc-200 active:bg-white/20"
                                    onClick={() => sendSpecialKey(KEYSYMS.Escape, 'Escape')}
                                >
                                    Esc
                                </button>
                                <button
                                    type="button"
                                    className="h-8 shrink-0 rounded-lg border border-white/10 bg-white/5 px-2 text-xs font-semibold text-zinc-200 active:bg-white/20"
                                    onClick={() => sendSpecialKey(KEYSYMS.Tab, 'Tab')}
                                >
                                    Tab
                                </button>
                                <button
                                    type="button"
                                    className="h-8 shrink-0 rounded-lg border border-white/10 bg-white/5 px-2 text-xs font-semibold text-zinc-200 active:bg-white/20"
                                    onClick={() => sendSpecialKey(KEYSYMS.Backspace, 'Backspace')}
                                >
                                    ⌫
                                </button>
                                <button
                                    type="button"
                                    className="h-8 shrink-0 rounded-lg border border-emerald-500/40 bg-emerald-500/20 px-2 text-xs font-semibold text-emerald-300 active:bg-emerald-500/40"
                                    onClick={() => sendSpecialKey(KEYSYMS.Return, 'Enter')}
                                >
                                    Enter ⏎
                                </button>
                                <button
                                    type="button"
                                    className="h-8 shrink-0 rounded-lg border border-white/10 bg-white/5 px-2 text-xs text-zinc-300 active:bg-white/20"
                                    onClick={() => sendSpecialKey(KEYSYMS.Up, 'ArrowUp')}
                                >
                                    ↑
                                </button>
                                <button
                                    type="button"
                                    className="h-8 shrink-0 rounded-lg border border-white/10 bg-white/5 px-2 text-xs text-zinc-300 active:bg-white/20"
                                    onClick={() => sendSpecialKey(KEYSYMS.Down, 'ArrowDown')}
                                >
                                    ↓
                                </button>
                                <button
                                    type="button"
                                    className="h-8 shrink-0 rounded-lg border border-white/10 bg-white/5 px-2 text-xs text-zinc-300 active:bg-white/20"
                                    onClick={() => sendSpecialKey(KEYSYMS.Left, 'ArrowLeft')}
                                >
                                    ←
                                </button>
                                <button
                                    type="button"
                                    className="h-8 shrink-0 rounded-lg border border-white/10 bg-white/5 px-2 text-xs text-zinc-300 active:bg-white/20"
                                    onClick={() => sendSpecialKey(KEYSYMS.Right, 'ArrowRight')}
                                >
                                    →
                                </button>
                                <button
                                    type="button"
                                    className="h-8 shrink-0 rounded-lg border border-white/10 bg-white/5 px-2 text-xs text-zinc-300 active:bg-white/20"
                                    onClick={copyOnRemote}
                                >
                                    Ctrl+C
                                </button>
                                <button
                                    type="button"
                                    className="h-8 shrink-0 rounded-lg border border-white/10 bg-white/5 px-2 text-xs text-zinc-300 active:bg-white/20"
                                    onClick={() => void pasteFromClipboard()}
                                >
                                    Ctrl+V
                                </button>
                                <button
                                    type="button"
                                    className="h-8 shrink-0 rounded-lg border border-white/10 bg-white/5 px-2 text-xs text-zinc-300 active:bg-white/20"
                                    onClick={selectAllOnRemote}
                                >
                                    Ctrl+A
                                </button>
                            </div>

                            {/* Dock Position Switcher & Close */}
                            <div className="ml-auto flex shrink-0 items-center gap-1 pl-1">
                                <button
                                    type="button"
                                    title={keyboardDockTop ? 'Chuyển thanh nhập xuống đáy' : 'Chuyển thanh nhập lên đỉnh'}
                                    className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-xs font-bold text-zinc-300 active:bg-white/20"
                                    onClick={() => setKeyboardDockTop((prev) => !prev)}
                                    aria-label="Đổi vị trí thanh nhập"
                                >
                                    {keyboardDockTop ? '⬇' : '⬆'}
                                </button>
                                <button
                                    type="button"
                                    aria-label="Đóng bàn phím"
                                    className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-xs font-bold text-zinc-300 active:bg-white/20"
                                    onClick={hideKeyboard}
                                >
                                    ✕
                                </button>
                            </div>
                        </div>
                    ) : (
                        /* Portrait Mode: 2 hàng đầy đủ */
                        <>
                            {/* Row 1: Function Keys */}
                            <div className="flex items-center gap-1.5 overflow-x-auto px-1 py-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                                <button
                                    type="button"
                                    className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-zinc-200 active:bg-white/20"
                                    onClick={() => sendSpecialKey(KEYSYMS.Escape, 'Escape')}
                                >
                                    Esc
                                </button>
                                <button
                                    type="button"
                                    className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-zinc-200 active:bg-white/20"
                                    onClick={() => sendSpecialKey(KEYSYMS.Tab, 'Tab')}
                                >
                                    Tab
                                </button>
                                <button
                                    type="button"
                                    className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-zinc-200 active:bg-white/20"
                                    onClick={() => sendSpecialKey(KEYSYMS.Backspace, 'Backspace')}
                                >
                                    ⌫ Xóa
                                </button>
                                <button
                                    type="button"
                                    className="shrink-0 rounded-lg border border-emerald-500/40 bg-emerald-500/20 px-2.5 py-1 text-xs font-semibold text-emerald-300 active:bg-emerald-500/40"
                                    onClick={() => sendSpecialKey(KEYSYMS.Return, 'Enter')}
                                >
                                    Enter ⏎
                                </button>
                                <button
                                    type="button"
                                    className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-zinc-300 active:bg-white/20"
                                    onClick={() => sendSpecialKey(KEYSYMS.Up, 'ArrowUp')}
                                >
                                    ↑
                                </button>
                                <button
                                    type="button"
                                    className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-zinc-300 active:bg-white/20"
                                    onClick={() => sendSpecialKey(KEYSYMS.Down, 'ArrowDown')}
                                >
                                    ↓
                                </button>
                                <button
                                    type="button"
                                    className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-zinc-300 active:bg-white/20"
                                    onClick={() => sendSpecialKey(KEYSYMS.Left, 'ArrowLeft')}
                                >
                                    ←
                                </button>
                                <button
                                    type="button"
                                    className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-zinc-300 active:bg-white/20"
                                    onClick={() => sendSpecialKey(KEYSYMS.Right, 'ArrowRight')}
                                >
                                    →
                                </button>
                                <button
                                    type="button"
                                    className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-zinc-300 active:bg-white/20"
                                    onClick={copyOnRemote}
                                >
                                    Ctrl+C
                                </button>
                                <button
                                    type="button"
                                    className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-zinc-300 active:bg-white/20"
                                    onClick={() => void pasteFromClipboard()}
                                >
                                    Ctrl+V
                                </button>
                                <button
                                    type="button"
                                    className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-zinc-300 active:bg-white/20"
                                    onClick={selectAllOnRemote}
                                >
                                    Ctrl+A
                                </button>

                                <div className="ml-auto flex shrink-0 items-center gap-1 pl-1">
                                    <button
                                        type="button"
                                        title={keyboardDockTop ? 'Chuyển thanh nhập xuống đáy' : 'Chuyển thanh nhập lên đỉnh'}
                                        className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 text-xs font-bold text-zinc-300 active:bg-white/20"
                                        onClick={() => setKeyboardDockTop((prev) => !prev)}
                                        aria-label="Đổi vị trí thanh nhập"
                                    >
                                        {keyboardDockTop ? '⬇' : '⬆'}
                                    </button>
                                    <button
                                        type="button"
                                        aria-label="Đóng bàn phím"
                                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/10 text-xs font-bold text-zinc-300 active:bg-white/20"
                                        onClick={hideKeyboard}
                                    >
                                        ✕
                                    </button>
                                </div>
                            </div>

                            {/* Row 2: Thanh soạn thảo văn bản */}
                            <div className="flex items-center gap-1.5 pt-1">
                                <input
                                    ref={keyboardRef}
                                    type="text"
                                    className="h-10 flex-1 rounded-xl border border-white/10 bg-black/40 px-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-emerald-400/60"
                                    aria-label="Thanh soạn thảo văn bản"
                                    autoCapitalize="none"
                                    autoComplete="off"
                                    autoCorrect="off"
                                    inputMode="text"
                                    placeholder="Nhập lệnh hoặc gõ văn bản…"
                                    spellCheck={false}
                                    value={keyboardText}
                                    onChange={(event) => setKeyboardText(event.target.value)}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter') {
                                            event.preventDefault()
                                            void submitKeyboardText(true)
                                        }
                                    }}
                                />
                                <button
                                    type="button"
                                    className="h-10 shrink-0 rounded-xl bg-emerald-500 px-3.5 text-xs font-semibold text-emerald-950 active:bg-emerald-400 disabled:opacity-40"
                                    disabled={!keyboardText}
                                    onClick={() => void submitKeyboardText(true)}
                                    title="Gửi nội dung và nhấn Enter"
                                >
                                    Gửi ⏎
                                </button>
                                <button
                                    type="button"
                                    className="h-10 shrink-0 rounded-xl border border-white/10 bg-white/10 px-3 text-xs font-medium text-zinc-200 active:bg-white/20"
                                    onClick={() => sendSpecialKey(KEYSYMS.Return, 'Enter')}
                                    title="Nhấn phím Enter độc lập"
                                >
                                    Enter
                                </button>
                            </div>
                        </>
                    )}
                </div>
            ) : null}

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
                className={`remote-screen bg-black ${
                    viewMode === 'stretch' ? 'remote-screen--cover' : ''
                } ${viewMode === 'original' ? 'overflow-auto' : 'overflow-hidden'}`}
                onPointerDown={() => {
                    // One-shot: enter browser fullscreen on first touch (Android).
                    if (
                        isCoarsePointer() &&
                        !fsAttemptedRef.current &&
                        !document.fullscreenElement
                    ) {
                        fsAttemptedRef.current = true
                        void toggleFullscreen()
                    }
                }}
                onClick={() => {
                    rfbRef.current?.focus()
                }}
            />
        </div>
    )
}
