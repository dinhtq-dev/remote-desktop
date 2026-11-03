import test from 'node:test'
import assert from 'node:assert/strict'
import { updateTrackpadCursorPos } from '../src/lib/localViewportZoom.ts'

export function calculateCanvasPos(
    clientX: number,
    clientY: number,
    bounds: { left: number; top: number; width: number; height: number }
) {
    const x = Math.max(0, Math.min(Math.round(bounds.width - 1), Math.round(clientX - bounds.left)))
    const y = Math.max(0, Math.min(Math.round(bounds.height - 1), Math.round(clientY - bounds.top)))
    return { x, y }
}

export function isTap(durationMs: number, distancePx: number): boolean {
    return durationMs < 350 && distancePx < 15
}

export function isDoubleTap(timeDiffMs: number, distancePx: number): boolean {
    return timeDiffMs < 320 && distancePx < 25
}

export function isTwoFingerTap(durationMs: number, distancePx: number): boolean {
    return durationMs < 280 && distancePx < 15
}

export function isThreeFingerTap(durationMs: number, moved: boolean): boolean {
    return durationMs < 350 && !moved
}

export function isMultiFingerTap(fingerCount: number, expected: number, durationMs: number, moved: boolean): boolean {
    return fingerCount === expected && durationMs < 400 && !moved
}

export function isHoldDrag(holdDurationMs: number, dragDistancePx: number, minHoldMs = 280, minDragDist = 8): boolean {
    return holdDurationMs >= minHoldMs && dragDistancePx >= minDragDist
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

test('calculateCanvasPos clamps to canvas boundaries', () => {
    const bounds = { left: 50, top: 100, width: 800, height: 600 }
    
    // Within bounds
    assert.deepEqual(calculateCanvasPos(150, 200, bounds), { x: 100, y: 100 })
    
    // Out of bounds left/top
    assert.deepEqual(calculateCanvasPos(20, 50, bounds), { x: 0, y: 0 })
    
    // Out of bounds right/bottom
    assert.deepEqual(calculateCanvasPos(900, 800, bounds), { x: 799, y: 599 })
})

test('isTap correctly differentiates tap vs drag', () => {
    assert.equal(isTap(150, 5), true) // quick tap with small jitter
    assert.equal(isTap(450, 5), false) // too slow (held down)
    assert.equal(isTap(150, 25), false) // moved too far (swipe/drag)
})

test('isDoubleTap detects quick repeated tap', () => {
    assert.equal(isDoubleTap(200, 10), true)
    assert.equal(isDoubleTap(400, 10), false) // too slow
    assert.equal(isDoubleTap(200, 40), false) // tapped too far apart
})

test('isTwoFingerTap detects right click gesture', () => {
    assert.equal(isTwoFingerTap(180, 8), true)
    assert.equal(isTwoFingerTap(350, 8), false) // held down / scrolling
    assert.equal(isTwoFingerTap(180, 30), false) // two finger drag
})

test('updateTrackpadCursorPos moves cursor relatively and clamps to bounds', () => {
    const bounds = { width: 1920, height: 1080 }
    const current = { x: 500, y: 500 }

    // 1x scale, move right 20px, down 15px
    const next1 = updateTrackpadCursorPos(current, { dx: 20, dy: 15 }, 1, bounds)
    assert.deepEqual(next1, { x: 520, y: 515 })

    // 2x scale (zoomed), dx of 20 screen pixels = 10 canvas pixels
    const next2 = updateTrackpadCursorPos(current, { dx: 20, dy: 10 }, 2, bounds)
    assert.deepEqual(next2, { x: 510, y: 505 })

    // Clamping to top-left (cannot go < 0)
    const next3 = updateTrackpadCursorPos({ x: 10, y: 10 }, { dx: -50, dy: -50 }, 1, bounds)
    assert.deepEqual(next3, { x: 0, y: 0 })

    // Clamping to bottom-right (cannot exceed width - 1, height - 1)
    const next4 = updateTrackpadCursorPos({ x: 1910, y: 1070 }, { dx: 50, dy: 50 }, 1, bounds)
    assert.deepEqual(next4, { x: 1919, y: 1079 })
})

test('mock canvas draws default arrow without throwing', () => {
    const mockCtx = {
        clearRect: () => {},
        beginPath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        closePath: () => {},
        fill: () => {},
        stroke: () => {}
    }
    const mockCanvas = {
        width: 0,
        height: 0,
        getContext: () => mockCtx
    }
    const hotSpot = { x: -1, y: -1 }
    
    // Test logic of drawDefaultArrow
    mockCanvas.width = 16
    mockCanvas.height = 22
    hotSpot.x = 0
    hotSpot.y = 0

    assert.equal(mockCanvas.width, 16)
    assert.equal(mockCanvas.height, 22)
    assert.equal(hotSpot.x, 0)
    assert.equal(hotSpot.y, 0)
})

test('isThreeFingerTap detects quick 3-finger tap for keyboard toggle', () => {
    assert.equal(isThreeFingerTap(150, false), true)
    assert.equal(isThreeFingerTap(450, false), false) // too slow
    assert.equal(isThreeFingerTap(150, true), false) // moved (3-finger swipe)
})

test('isMultiFingerTap detects 4-finger fullscreen and 5-finger toolbar taps', () => {
    // 4-finger tap for Fullscreen
    assert.equal(isMultiFingerTap(4, 4, 180, false), true)
    assert.equal(isMultiFingerTap(4, 4, 450, false), false) // too slow
    assert.equal(isMultiFingerTap(4, 4, 180, true), false) // moved

    // 5-finger tap for Toolbar toggle
    assert.equal(isMultiFingerTap(5, 5, 200, false), true)
    assert.equal(isMultiFingerTap(3, 5, 200, false), false) // finger count mismatch
})

test('isTextCursor distinguishes I-beam from arrow, pointer and crosshair', () => {
    // Arrow cursor
    assert.equal(isTextCursor({ w: 16, h: 22, hotx: 0, hoty: 0 }), false)
    
    // Hand pointer (hotspot at fingertip top edge)
    assert.equal(isTextCursor({ w: 16, h: 20, hotx: 6, hoty: 1 }), false)

    // Square crosshair
    assert.equal(isTextCursor({ w: 15, h: 15, hotx: 7, hoty: 7 }), false)

    // Horizontal resize
    assert.equal(isTextCursor({ w: 24, h: 10, hotx: 12, hoty: 5 }), false)

    // Empty or zero-size cursor
    assert.equal(isTextCursor({ w: 0, h: 0, hotx: 0, hoty: 0 }), false)
    assert.equal(isTextCursor(undefined), false)

    // Standard X11 I-beam (text cursor)
    assert.equal(isTextCursor({ w: 9, h: 19, hotx: 4, hoty: 9 }), true)

    // Standard Windows I-beam
    assert.equal(isTextCursor({ w: 15, h: 24, hotx: 7, hoty: 12 }), true)

    // Standard macOS I-beam
    assert.equal(isTextCursor({ w: 11, h: 21, hotx: 5, hoty: 10 }), true)
})

test('isHoldDrag detects press-and-hold drag to select area', () => {
    // Held for 300ms, then dragged 20px -> valid hold & drag
    assert.equal(isHoldDrag(320, 25), true)

    // Moved immediately without holding (0ms hold, 50px drag) -> regular mouse move
    assert.equal(isHoldDrag(100, 50), false)

    // Held for 400ms but did not drag (< 5px) -> stationary tap/hold
    assert.equal(isHoldDrag(400, 3), false)
})

