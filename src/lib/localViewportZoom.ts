/**
 * Local "magnifier" zoom & mobile touch controller:
 * - Dual pointer modes:
 *     1. 'trackpad' (Default on mobile):
 *        - Screen acts as a virtual touchpad (MacBook style)
 *        - Finger moves anywhere; cursor moves relatively with 1-pixel precision
 *        - Finger NEVER covers the mouse cursor or click target
 *        - Single tap anywhere = Left click at cursor position
 *        - Double tap anywhere = Double click at cursor position (100% reliable)
 *        - Long press or 2-finger tap = Right click at cursor position + haptic feedback
 *     2. 'direct':
 *        - Finger taps/moves directly on the canvas position
 * - Rich remote cursor support:
 *     - Displays real VNC server cursor shapes (I-beam in input, Arrow in desktop, Hand on link)
 *     - Ensures fallback software cursor is rendered visibly on mobile touchscreens
 * - 2-finger scroll: mouse wheel up/down on remote desktop (when zoom <= 1.05)
 * - 2-finger pan: pan local magnifier view (when zoom > 1.05)
 * - 2-finger pinch: local magnifier zoom on phone only (prevents Ctrl+wheel remote zoom)
 * - Drag mode / Text select: holds left mouse button down while moving
 */

const MIN_ZOOM = 1
const MAX_ZOOM = 6
const TEXT_SELECT_ARM_MS = 10_000
const SCROLL_THRESHOLD = 20

export type ZoomBaseline = 'cover' | 'fit' | 'native' | 'shrink'
export type PointerMode = 'trackpad' | 'direct'

export type ZoomableRfb = {
    scaleViewport: boolean
    clipViewport: boolean
    dragViewport: boolean
    _fbWidth?: number
    _fbHeight?: number
    _canvas?: HTMLCanvasElement
    _display?: {
        scale: number
        absX?: (x: number) => number
        absY?: (y: number) => number
    }
    _gestures?: {
        detach: () => void
        attach: (target: HTMLElement) => void
    }
    _cursor?: {
        _canvas?: HTMLCanvasElement
        _hotSpot?: { x: number; y: number }
        _position?: { x: number; y: number }
        _shouldShowCursor?: (target: unknown) => boolean
        _updateVisibility?: (target: unknown) => void
        _updatePosition?: () => void
        move?: (x: number, y: number) => void
        change?: (rgba: Uint8Array, hotx: number, hoty: number, w: number, h: number) => void
    }
    _cursorImage?: {
        w?: number
        h?: number
        hotx?: number
        hoty?: number
        rgbaPixels?: Uint8Array
    }
    _handleMouseMove?: (x: number, y: number) => void
    _handleMouseButton?: (x: number, y: number, mask: number) => void
    _handleGesture?: (ev: Event) => void
    _eventHandlers?: { handleGesture: (ev: Event) => void }
}

export type LocalViewportZoomHandle = {
    dispose: () => void
    getZoom: () => number
    reset: () => void
    setBaseline: (baseline: ZoomBaseline) => void
    reapply: () => void
    clearTextSelect: () => void
    setDragMode: (enabled: boolean) => void
    isDragMode: () => boolean
    setPointerMode: (mode: PointerMode) => void
    getPointerMode: () => PointerMode
}

export function drawDefaultArrow(
    canvas: { width: number; height: number; getContext: (type: string) => unknown },
    hotSpot?: { x: number; y: number }
) {
    canvas.width = 16
    canvas.height = 22
    if (hotSpot) {
        hotSpot.x = 0
        hotSpot.y = 0
    }
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null
    if (!ctx) return
    ctx.clearRect(0, 0, 16, 22)
    ctx.beginPath()
    ctx.moveTo(0.5, 0.5)
    ctx.lineTo(0.5, 17.5)
    ctx.lineTo(4.5, 13.5)
    ctx.lineTo(8.5, 21.5)
    ctx.lineTo(11.5, 20)
    ctx.lineTo(7.5, 12)
    ctx.lineTo(13.5, 12)
    ctx.closePath()
    ctx.fillStyle = '#ffffff'
    ctx.fill()
    ctx.strokeStyle = '#000000'
    ctx.lineWidth = 1.5
    ctx.stroke()
}

export function updateTrackpadCursorPos(
    currentPos: { x: number; y: number },
    deltaTouch: { dx: number; dy: number },
    scale: number,
    bounds: { width: number; height: number },
    sensitivity = 1.0
) {
    const effectiveScale = scale > 0 ? scale : 1
    const deltaX = (deltaTouch.dx / effectiveScale) * sensitivity
    const deltaY = (deltaTouch.dy / effectiveScale) * sensitivity
    const nextX = Math.max(0, Math.min(Math.round(bounds.width - 1), Math.round(currentPos.x + deltaX)))
    const nextY = Math.max(0, Math.min(Math.round(bounds.height - 1), Math.round(currentPos.y + deltaY)))
    return { x: nextX, y: nextY }
}

export function isTextCursor(cursorImage?: {
    w?: number
    h?: number
    hotx?: number
    hoty?: number
}): boolean {
    if (!cursorImage) return false
    const { w = 0, h = 0, hotx = 0, hoty = 0 } = cursorImage
    if (w <= 0 || h <= 0) return false

    // I-beam text cursors are vertically oriented: height is taller than width
    if (h < w * 1.1) return false

    // Hotspot is centered horizontally inside the stem
    const centerX = (w - 1) / 2
    if (Math.abs(hotx - centerX) > 3) return false

    // Hotspot is centered vertically inside the stem (not near top like arrow or pointer)
    const centerY = (h - 1) / 2
    if (Math.abs(hoty - centerY) > 6) return false

    return true
}

function baseScaleFor(
    baseline: ZoomBaseline,
    screenEl: HTMLElement,
    fbW: number,
    fbH: number
) {
    if (baseline === 'native') return 1
    const cw = screenEl.clientWidth
    const ch = screenEl.clientHeight
    if (!fbW || !fbH || !cw || !ch) return 1
    if (baseline === 'cover') return Math.max(cw / fbW, ch / fbH)
    if (baseline === 'shrink') return Math.min(1, Math.min(cw / fbW, ch / fbH))
    return Math.min(cw / fbW, ch / fbH)
}

function clampPan(panX: number, panY: number, contentW: number, contentH: number, cw: number, ch: number) {
    let minX: number
    let maxX: number
    let minY: number
    let maxY: number

    if (contentW <= cw) {
        minX = maxX = (cw - contentW) / 2
    } else {
        minX = cw - contentW
        maxX = 0
    }

    if (contentH <= ch) {
        minY = maxY = (ch - contentH) / 2
    } else {
        minY = ch - contentH
        maxY = 0
    }

    return {
        x: Math.min(maxX, Math.max(minX, panX)),
        y: Math.min(maxY, Math.max(minY, panY))
    }
}

export function attachLocalViewportZoom(
    rfb: ZoomableRfb,
    screenEl: HTMLElement,
    options?: {
        baseline?: ZoomBaseline
        pointerMode?: PointerMode
        onZoomChange?: (zoom: number) => void
        onTextSelectArmed?: (armed: boolean) => void
        onPointerModeChange?: (mode: PointerMode) => void
        onToggleKeyboard?: () => void
        onOpenKeyboard?: () => void
        onToggleFullscreen?: () => void
        onToggleToolbar?: () => void
    }
): LocalViewportZoomHandle {
    let baseline: ZoomBaseline = options?.baseline ?? 'shrink'
    let pointerMode: PointerMode = options?.pointerMode ?? 'trackpad'
    let zoom = 1
    let panX = 0
    let panY = 0
    let disposed = false

    // Trackpad virtual cursor coordinates (relative to canvas bounding box)
    let trackpadCursorX = -1
    let trackpadCursorY = -1

    // State for single-finger touch
    let touchStartTime = 0
    let touchStartX = 0
    let touchStartY = 0
    let lastTouchX = 0
    let lastTouchY = 0
    let isLongPress = false
    let isMouseDown = false
    let longPressTimer: number | null = null
    let holdDragTimer: number | null = null
    let isHoldDragArmed = false
    let isHoldDragging = false
    let lastTapTime = 0
    let lastTapX = 0
    let lastTapY = 0

    // State for two-finger gestures
    let initialPinchDist = 0
    let twoTouchStartTime = 0
    let twoTouchStartX = 0
    let twoTouchStartY = 0
    let lastTwoX = 0
    let lastTwoY = 0
    let twoTouchMoved = false
    let accumulatedScrollY = 0

    // State for multi-finger gestures (3: keyboard, 4: fullscreen, 5: toolbar)
    let multiTouchCount = 0
    let multiTouchStartTime = 0
    let multiTouchMoved = false

    // Drag / Text selection mode
    let textSelectArmed = false
    let armTimer: number | null = null

    function setTextSelectArmed(armed: boolean) {
        textSelectArmed = armed
        if (armTimer != null) {
            window.clearTimeout(armTimer)
            armTimer = null
        }
        if (armed) {
            armTimer = window.setTimeout(() => {
                textSelectArmed = false
                armTimer = null
                options?.onTextSelectArmed?.(false)
            }, TEXT_SELECT_ARM_MS)
        }
        options?.onTextSelectArmed?.(armed)
    }

    const canvas = rfb._canvas ?? (screenEl.querySelector('canvas') as HTMLCanvasElement | null)

    // ===== SOFTWARE CURSOR HANDLING (CRITICAL FOR MOBILE TOUCH / TRACKPAD) =====
    const cursor = rfb._cursor
    let cursorCanvas: HTMLCanvasElement | null = cursor?._canvas ?? null
    let origCursorChange:
        | ((rgba: Uint8Array, hotx: number, hoty: number, w: number, h: number) => void)
        | null = null
    let isFallbackDrawn = false

    if (cursor) {
        cursorCanvas = cursor._canvas as HTMLCanvasElement
        if (cursorCanvas) {
            cursorCanvas.style.position = 'fixed'
            cursorCanvas.style.zIndex = '99999'
            cursorCanvas.style.pointerEvents = 'none'
            cursorCanvas.style.userSelect = 'none'
            cursorCanvas.style.visibility = 'visible'
            cursorCanvas.style.display = 'block'
            cursorCanvas.style.filter = 'drop-shadow(0 1.5px 3px rgba(0,0,0,0.85))'

            if (cursorCanvas.width === 0 || cursorCanvas.height === 0) {
                drawDefaultArrow(cursorCanvas, cursor._hotSpot)
                isFallbackDrawn = true
            }
        }

        // Prevent noVNC's internal _updateVisibility from hiding the software cursor canvas on mobile
        cursor._shouldShowCursor = () => true
        cursor._updateVisibility = () => {
            if (cursorCanvas) cursorCanvas.style.visibility = 'visible'
        }

        if (cursor.change) {
            origCursorChange = cursor.change.bind(cursor)
            cursor.change = (rgba: Uint8Array, hotx: number, hoty: number, w: number, h: number) => {
                if (w === 0 || h === 0) {
                    if (cursorCanvas && !isFallbackDrawn) {
                        drawDefaultArrow(cursorCanvas, cursor._hotSpot)
                        isFallbackDrawn = true
                        cursorCanvas.style.visibility = 'visible'
                    }
                    return
                }
                isFallbackDrawn = false
                origCursorChange?.(rgba, hotx, hoty, w, h)
                if (cursorCanvas) {
                    cursorCanvas.style.visibility = 'visible'
                }
            }
        }
    }

    function updateSoftwareCursorPosition(screenX: number, screenY: number) {
        if (!cursorCanvas) return
        const hotx = cursor?._hotSpot?.x || 0
        const hoty = cursor?._hotSpot?.y || 0
        cursorCanvas.style.left = `${Math.round(screenX - hotx)}px`
        cursorCanvas.style.top = `${Math.round(screenY - hoty)}px`
        cursorCanvas.style.visibility = 'visible'
    }

    function ensureTrackpadCursor() {
        const el = rfb._canvas ?? (screenEl.querySelector('canvas') as HTMLCanvasElement | null)
        if (!el) return
        const bounds = el.getBoundingClientRect()
        if (trackpadCursorX < 0 || trackpadCursorY < 0) {
            trackpadCursorX = Math.round(bounds.width / 2)
            trackpadCursorY = Math.round(bounds.height / 2)
        } else {
            trackpadCursorX = Math.max(0, Math.min(Math.round(bounds.width - 1), trackpadCursorX))
            trackpadCursorY = Math.max(0, Math.min(Math.round(bounds.height - 1), trackpadCursorY))
        }
    }

    function paint(focusClientX?: number, focusClientY?: number, prevScale?: number) {
        const display = rfb._display
        const el = rfb._canvas ?? (screenEl.querySelector('canvas') as HTMLCanvasElement | null)
        const novncScreen = screenEl.querySelector(':scope > div') as HTMLElement | null
        const fbW = rfb._fbWidth || 0
        const fbH = rfb._fbHeight || 0
        if (!display || !el || !fbW || !fbH) return

        const cw = screenEl.clientWidth
        const ch = screenEl.clientHeight
        const base = baseScaleFor(baseline, screenEl, fbW, fbH)
        const scale = base * zoom

        rfb.scaleViewport = false
        rfb.clipViewport = false
        rfb.dragViewport = false

        if (novncScreen) {
            novncScreen.style.overflow = 'hidden'
            novncScreen.style.width = '100%'
            novncScreen.style.height = '100%'
            novncScreen.style.position = 'relative'
            novncScreen.style.display = 'block'
            novncScreen.style.touchAction = 'none'
        }

        display.scale = scale

        el.style.margin = '0'
        el.style.position = 'absolute'
        el.style.left = '0'
        el.style.top = '0'
        el.style.transformOrigin = '0 0'
        el.style.touchAction = 'none'

        const contentW = fbW * scale
        const contentH = fbH * scale

        if (
            focusClientX != null &&
            focusClientY != null &&
            prevScale != null &&
            prevScale > 0 &&
            Math.abs(prevScale - scale) > 0.0001
        ) {
            const parentLeft = screenEl.getBoundingClientRect().left
            const parentTop = screenEl.getBoundingClientRect().top
            const fx = focusClientX - parentLeft
            const fy = focusClientY - parentTop
            const contentX = (fx - panX) / prevScale
            const contentY = (fy - panY) / prevScale
            panX = fx - contentX * scale
            panY = fy - contentY * scale
        }

        if (zoom <= 1.001) {
            zoom = 1
            panX = (cw - contentW) / 2
            panY = (ch - contentH) / 2
        } else {
            const clamped = clampPan(panX, panY, contentW, contentH, cw, ch)
            panX = clamped.x
            panY = clamped.y
        }

        el.style.transform = `translate(${panX}px, ${panY}px)`
        options?.onZoomChange?.(zoom)

        ensureTrackpadCursor()
        const bounds = el.getBoundingClientRect()
        updateSoftwareCursorPosition(bounds.left + trackpadCursorX, bounds.top + trackpadCursorY)
    }

    function setZoomAt(nextZoom: number, clientX: number, clientY: number) {
        const fbW = rfb._fbWidth || 0
        const fbH = rfb._fbHeight || 0
        const base = baseScaleFor(baseline, screenEl, fbW, fbH)
        const prevScale = base * zoom
        zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom))
        paint(clientX, clientY, prevScale)
    }

    function panBy(dx: number, dy: number) {
        panX += dx
        panY += dy
        paint()
    }

    function getCanvasPos(clientX: number, clientY: number) {
        const target = rfb._canvas ?? (screenEl.querySelector('canvas') as HTMLCanvasElement | null)
        if (!target) return { x: 0, y: 0 }
        const bounds = target.getBoundingClientRect()
        const x = Math.max(0, Math.min(bounds.width - 1, clientX - bounds.left))
        const y = Math.max(0, Math.min(bounds.height - 1, clientY - bounds.top))
        return { x, y }
    }

    function sendCanvasClick(canvasX: number, canvasY: number, buttonMask: number = 0x1) {
        const el = rfb._canvas ?? (screenEl.querySelector('canvas') as HTMLCanvasElement | null)
        const bounds = el ? el.getBoundingClientRect() : { left: 0, top: 0 }
        rfb._handleMouseMove?.(canvasX, canvasY)
        updateSoftwareCursorPosition(bounds.left + canvasX, bounds.top + canvasY)
        rfb._handleMouseButton?.(canvasX, canvasY, buttonMask)
        rfb._handleMouseButton?.(canvasX, canvasY, 0x0)
    }

    function sendDirectMouseMove(clientX: number, clientY: number) {
        const pos = getCanvasPos(clientX, clientY)
        rfb._handleMouseMove?.(pos.x, pos.y)
        updateSoftwareCursorPosition(clientX, clientY)
    }

    function sendDirectMouseClick(clientX: number, clientY: number, buttonMask: number = 0x1) {
        const pos = getCanvasPos(clientX, clientY)
        rfb._handleMouseMove?.(pos.x, pos.y)
        updateSoftwareCursorPosition(clientX, clientY)
        rfb._handleMouseButton?.(pos.x, pos.y, buttonMask)
        rfb._handleMouseButton?.(pos.x, pos.y, 0x0)
    }

    // Touch handlers that replace noVNC's gesture handler
    function onTouchStart(e: TouchEvent) {
        if (disposed) return
        e.preventDefault()

        if (e.touches.length === 1) {
            const t = e.touches[0]
            touchStartTime = Date.now()
            touchStartX = t.clientX
            touchStartY = t.clientY
            lastTouchX = t.clientX
            lastTouchY = t.clientY
            isLongPress = false

            if (pointerMode === 'trackpad') {
                ensureTrackpadCursor()
                const el = rfb._canvas ?? (screenEl.querySelector('canvas') as HTMLCanvasElement | null)
                if (el) {
                    const bounds = el.getBoundingClientRect()
                    rfb._handleMouseMove?.(trackpadCursorX, trackpadCursorY)
                    updateSoftwareCursorPosition(bounds.left + trackpadCursorX, bounds.top + trackpadCursorY)
                }

                if (textSelectArmed) {
                    isMouseDown = true
                    rfb._handleMouseButton?.(trackpadCursorX, trackpadCursorY, 0x1)
                } else {
                    if (longPressTimer != null) window.clearTimeout(longPressTimer)
                    longPressTimer = window.setTimeout(() => {
                        longPressTimer = null
                        isLongPress = true
                        sendCanvasClick(trackpadCursorX, trackpadCursorY, 0x4) // Right click
                        if (typeof navigator !== 'undefined' && navigator.vibrate) {
                            try {
                                navigator.vibrate(40)
                            } catch {
                                // ignore
                            }
                        }
                    }, 500)

                    // Arm hold-and-drag timer (260ms): hold then drag to select area/text
                    if (holdDragTimer != null) window.clearTimeout(holdDragTimer)
                    holdDragTimer = window.setTimeout(() => {
                        holdDragTimer = null
                        isHoldDragArmed = true
                        isHoldDragging = true
                        isMouseDown = true
                        rfb._handleMouseButton?.(trackpadCursorX, trackpadCursorY, 0x1)
                        if (typeof navigator !== 'undefined' && navigator.vibrate) {
                            try {
                                navigator.vibrate(30)
                            } catch {
                                // ignore
                            }
                        }
                    }, 260)
                }
                } else {
                // Direct Touch mode: pointer snaps directly to touch
                sendDirectMouseMove(t.clientX, t.clientY)

                if (textSelectArmed) {
                    const pos = getCanvasPos(t.clientX, t.clientY)
                    isMouseDown = true
                    rfb._handleMouseButton?.(pos.x, pos.y, 0x1)
                } else {
                    if (longPressTimer != null) window.clearTimeout(longPressTimer)
                    longPressTimer = window.setTimeout(() => {
                        longPressTimer = null
                        isLongPress = true
                        sendDirectMouseClick(lastTouchX, lastTouchY, 0x4) // Right click
                        if (typeof navigator !== 'undefined' && navigator.vibrate) {
                            try {
                                navigator.vibrate(40)
                            } catch {
                                // ignore
                            }
                        }
                    }, 500)

                    // Arm hold-and-drag timer (260ms)
                    if (holdDragTimer != null) window.clearTimeout(holdDragTimer)
                    holdDragTimer = window.setTimeout(() => {
                        holdDragTimer = null
                        const pos = getCanvasPos(lastTouchX, lastTouchY)
                        isHoldDragArmed = true
                        isHoldDragging = true
                        isMouseDown = true
                        rfb._handleMouseButton?.(pos.x, pos.y, 0x1)
                        if (typeof navigator !== 'undefined' && navigator.vibrate) {
                            try {
                                navigator.vibrate(30)
                            } catch {
                                // ignore
                            }
                        }
                    }, 260)
                }
                }
        } else if (e.touches.length === 2) {
            // Cancel single touch timers
            if (longPressTimer != null) {
                window.clearTimeout(longPressTimer)
                longPressTimer = null
            }
            if (isMouseDown) {
                const pos =
                    pointerMode === 'trackpad'
                        ? { x: trackpadCursorX, y: trackpadCursorY }
                        : getCanvasPos(lastTouchX, lastTouchY)
                rfb._handleMouseButton?.(pos.x, pos.y, 0x0)
                isMouseDown = false
            }

            const t1 = e.touches[0]
            const t2 = e.touches[1]
            twoTouchStartTime = Date.now()
            twoTouchStartX = (t1.clientX + t2.clientX) / 2
            twoTouchStartY = (t1.clientY + t2.clientY) / 2
            lastTwoX = twoTouchStartX
            lastTwoY = twoTouchStartY
            twoTouchMoved = false
            accumulatedScrollY = 0

            initialPinchDist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY)
        } else if (e.touches.length >= 3) {
            multiTouchCount = e.touches.length
            multiTouchStartTime = Date.now()
            multiTouchMoved = false
        }
    }

    function onTouchMove(e: TouchEvent) {
        if (disposed) return
        e.preventDefault()

        if (e.touches.length === 1) {
            const t = e.touches[0]
            const deltaX = t.clientX - lastTouchX
            const deltaY = t.clientY - lastTouchY
            lastTouchX = t.clientX
            lastTouchY = t.clientY

            const dist = Math.hypot(t.clientX - touchStartX, t.clientY - touchStartY)
            if (dist > 8) {
                if (longPressTimer != null) {
                    window.clearTimeout(longPressTimer)
                    longPressTimer = null
                }
                if (!isHoldDragArmed && holdDragTimer != null) {
                    window.clearTimeout(holdDragTimer)
                    holdDragTimer = null
                }
            }

            if (pointerMode === 'trackpad') {
                ensureTrackpadCursor()
                const el = rfb._canvas ?? (screenEl.querySelector('canvas') as HTMLCanvasElement | null)
                if (el) {
                    const bounds = el.getBoundingClientRect()
                    const next = updateTrackpadCursorPos(
                        { x: trackpadCursorX, y: trackpadCursorY },
                        { dx: deltaX, dy: deltaY },
                        1,
                        bounds,
                        1.0
                    )
                    trackpadCursorX = next.x
                    trackpadCursorY = next.y

                    rfb._handleMouseMove?.(trackpadCursorX, trackpadCursorY)
                    updateSoftwareCursorPosition(bounds.left + trackpadCursorX, bounds.top + trackpadCursorY)
                }
            } else {
                sendDirectMouseMove(t.clientX, t.clientY)
            }
        } else if (e.touches.length === 2) {
            const t1 = e.touches[0]
            const t2 = e.touches[1]
            const currentDist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY)
            const midX = (t1.clientX + t2.clientX) / 2
            const midY = (t1.clientY + t2.clientY) / 2
            const deltaX = midX - lastTwoX
            const deltaY = midY - lastTwoY
            lastTwoX = midX
            lastTwoY = midY

            if (
                Math.hypot(midX - twoTouchStartX, midY - twoTouchStartY) > 8 ||
                Math.abs(currentDist - initialPinchDist) > 12
            ) {
                twoTouchMoved = true
            }

            // Distinguish pinch zoom vs 2-finger scroll/pan
            const pinchDiff = Math.abs(currentDist - initialPinchDist)
            if (pinchDiff > 16 && initialPinchDist > 10) {
                const ratio = currentDist / initialPinchDist
                initialPinchDist = currentDist
                setZoomAt(zoom * ratio, midX, midY)
            } else {
                if (zoom > 1.05) {
                    panBy(deltaX, deltaY)
                } else {
                    accumulatedScrollY += deltaY
                    const pos =
                        pointerMode === 'trackpad'
                            ? { x: trackpadCursorX, y: trackpadCursorY }
                            : getCanvasPos(midX, midY)
                    while (accumulatedScrollY > SCROLL_THRESHOLD) {
                        // Scroll up (wheel up = 0x8)
                        rfb._handleMouseButton?.(pos.x, pos.y, 0x8)
                        rfb._handleMouseButton?.(pos.x, pos.y, 0x0)
                        accumulatedScrollY -= SCROLL_THRESHOLD
                    }
                    while (accumulatedScrollY < -SCROLL_THRESHOLD) {
                        // Scroll down (wheel down = 0x10)
                        rfb._handleMouseButton?.(pos.x, pos.y, 0x10)
                        rfb._handleMouseButton?.(pos.x, pos.y, 0x0)
                        accumulatedScrollY += SCROLL_THRESHOLD
                    }
                }
            }
        } else if (e.touches.length >= 3) {
            multiTouchMoved = true
        }
    }

    function onTouchEnd(e: TouchEvent) {
        if (disposed) return
        e.preventDefault()

        if (longPressTimer != null) {
            window.clearTimeout(longPressTimer)
            longPressTimer = null
        }
        if (holdDragTimer != null) {
            window.clearTimeout(holdDragTimer)
            holdDragTimer = null
        }

        // Check multi-finger tap (3: keyboard, 4: fullscreen, 5: toolbar)
        if (multiTouchStartTime > 0 && e.touches.length === 0) {
            const dt = Date.now() - multiTouchStartTime
            if (!multiTouchMoved && dt < 400) {
                if (multiTouchCount === 3) {
                    options?.onToggleKeyboard?.()
                } else if (multiTouchCount === 4) {
                    options?.onToggleFullscreen?.()
                } else if (multiTouchCount >= 5) {
                    options?.onToggleToolbar?.()
                }
                if (typeof navigator !== 'undefined' && navigator.vibrate) {
                    try {
                        navigator.vibrate(35)
                    } catch {
                        // ignore
                    }
                }
            }
            multiTouchStartTime = 0
            multiTouchCount = 0
            return
        }

        if (e.touches.length === 0) {
            // All fingers lifted
            if (isHoldDragging) {
                const pos =
                    pointerMode === 'trackpad'
                        ? { x: trackpadCursorX, y: trackpadCursorY }
                        : getCanvasPos(lastTouchX, lastTouchY)

                rfb._handleMouseButton?.(pos.x, pos.y, 0x0)
                isMouseDown = false
                isHoldDragging = false
                isHoldDragArmed = false
                return
            }
            // All fingers lifted
            if (isMouseDown) {
                const pos =
                    pointerMode === 'trackpad'
                        ? { x: trackpadCursorX, y: trackpadCursorY }
                        : getCanvasPos(lastTouchX, lastTouchY)
                rfb._handleMouseButton?.(pos.x, pos.y, 0x0)
                isMouseDown = false
                if (textSelectArmed) {
                    setTextSelectArmed(false)
                }
            } else if (!isLongPress) {
                const duration = Date.now() - touchStartTime
                const dist = Math.hypot(lastTouchX - touchStartX, lastTouchY - touchStartY)
                if (duration < 350 && dist < 15) {
                    const now = Date.now()
                    const tapDt = now - lastTapTime
                    const tapDist = Math.hypot(lastTouchX - lastTapX, lastTouchY - lastTapY)
                    lastTapTime = now
                    lastTapX = lastTouchX
                    lastTapY = lastTouchY

                    if (pointerMode === 'trackpad') {
                        ensureTrackpadCursor()
                        if (tapDt < 320 && tapDist < 25) {
                            // Double tap -> double click at trackpad cursor
                            sendCanvasClick(trackpadCursorX, trackpadCursorY, 0x1)
                            window.setTimeout(() => sendCanvasClick(trackpadCursorX, trackpadCursorY, 0x1), 40)
                            if (isTextCursor(rfb._cursorImage)) {
                                options?.onOpenKeyboard?.()
                            }
                        } else {
                            // Single tap -> single click at trackpad cursor
                            sendCanvasClick(trackpadCursorX, trackpadCursorY, 0x1)
                        }
                    } else {
                        if (tapDt < 320 && tapDist < 25) {
                            sendDirectMouseClick(lastTouchX, lastTouchY, 0x1)
                            window.setTimeout(() => sendDirectMouseClick(lastTouchX, lastTouchY, 0x1), 40)
                            if (isTextCursor(rfb._cursorImage)) {
                                options?.onOpenKeyboard?.()
                            }
                        } else {
                            sendDirectMouseClick(lastTouchX, lastTouchY, 0x1)
                        }
                    }
                }
            }
        } else if (e.touches.length === 1 && e.changedTouches.length === 1) {
            // Two-finger tap -> Right click
            const duration = Date.now() - twoTouchStartTime
            if (!twoTouchMoved && duration < 280) {
                if (pointerMode === 'trackpad') {
                    ensureTrackpadCursor()
                    sendCanvasClick(trackpadCursorX, trackpadCursorY, 0x4)
                } else {
                    sendDirectMouseClick(twoTouchStartX, twoTouchStartY, 0x4)
                }
                if (typeof navigator !== 'undefined' && navigator.vibrate) {
                    try {
                        navigator.vibrate(40)
                    } catch {
                        // ignore
                    }
                }
            }
        }
    }

    function onTouchCancel() {
        if (disposed) return
        if (longPressTimer != null) {
            window.clearTimeout(longPressTimer)
            longPressTimer = null
        }
        if (holdDragTimer != null) {
            window.clearTimeout(holdDragTimer)
            holdDragTimer = null
        }
        isHoldDragArmed = false
        isHoldDragging = false
        if (isMouseDown) {
            const pos =
                pointerMode === 'trackpad'
                    ? { x: trackpadCursorX, y: trackpadCursorY }
                    : getCanvasPos(lastTouchX, lastTouchY)
            rfb._handleMouseButton?.(pos.x, pos.y, 0x0)
            isMouseDown = false
        }
    }

    // Detach noVNC's default GestureHandler to eliminate 50px deadzone & accidental drags
    try {
        rfb._gestures?.detach()
    } catch {
        // ignore
    }

    // Attach our responsive touch handlers
    const touchTarget = canvas ?? screenEl
    touchTarget.addEventListener('touchstart', onTouchStart, { passive: false })
    touchTarget.addEventListener('touchmove', onTouchMove, { passive: false })
    touchTarget.addEventListener('touchend', onTouchEnd, { passive: false })
    touchTarget.addEventListener('touchcancel', onTouchCancel, { passive: false })

    paint()

    return {
        dispose() {
            disposed = true
            if (armTimer != null) window.clearTimeout(armTimer)
            if (longPressTimer != null) window.clearTimeout(longPressTimer)
            if (holdDragTimer != null) window.clearTimeout(holdDragTimer)

            touchTarget.removeEventListener('touchstart', onTouchStart)
            touchTarget.removeEventListener('touchmove', onTouchMove)
            touchTarget.removeEventListener('touchend', onTouchEnd)
            touchTarget.removeEventListener('touchcancel', onTouchCancel)

            if (cursor && origCursorChange) {
                cursor.change = origCursorChange
            }

            const el = rfb._canvas ?? (screenEl.querySelector('canvas') as HTMLCanvasElement | null)
            if (el) {
                el.style.transform = ''
                el.style.position = ''
                el.style.left = ''
                el.style.top = ''
                el.style.margin = ''
                el.style.transformOrigin = ''
                try {
                    rfb._gestures?.attach(el)
                } catch {
                    // ignore
                }
            }
        },
        getZoom: () => zoom,
        reset() {
            zoom = 1
            paint()
        },
        setBaseline(next) {
            baseline = next
            paint()
        },
        reapply() {
            paint()
        },
        clearTextSelect() {
            setTextSelectArmed(false)
        },
        setDragMode(enabled: boolean) {
            setTextSelectArmed(enabled)
        },
        isDragMode: () => textSelectArmed,
        setPointerMode(next: PointerMode) {
            pointerMode = next
            ensureTrackpadCursor()
            options?.onPointerModeChange?.(next)
        },
        getPointerMode: () => pointerMode
    }
}

export function baselineForViewMode(mode: string): ZoomBaseline {
    if (mode === 'stretch') return 'cover'
    if (mode === 'original') return 'native'
    if (mode === 'shrink') return 'shrink'
    return 'fit'
}
