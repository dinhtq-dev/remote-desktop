/**
 * Adaptive VNC Bitrate & Quality Controller (YouTube ABR style).
 * Dynamically scales image quality and compression according to real-time bandwidth,
 * latency (RTT), frame rates, and socket backpressure to guarantee a smooth,
 * stutter-free remote desktop stream.
 */

export type QualityTier = 0 | 1 | 2 | 3 | 4

export type QualityTierDef = {
    tier: QualityTier
    name: string
    qualityLevel: number
    compressionLevel: number
    minBwKBps: number
    maxRttMs: number
}

export const QUALITY_TIERS: Record<QualityTier, QualityTierDef> = {
    4: { tier: 4, name: 'HD+', qualityLevel: 9, compressionLevel: 1, minBwKBps: 3200, maxRttMs: 50 },
    3: { tier: 3, name: 'HD', qualityLevel: 7, compressionLevel: 2, minBwKBps: 1300, maxRttMs: 85 },
    2: { tier: 2, name: 'SD', qualityLevel: 5, compressionLevel: 5, minBwKBps: 500, maxRttMs: 160 },
    1: { tier: 1, name: 'Mượt', qualityLevel: 3, compressionLevel: 7, minBwKBps: 180, maxRttMs: 260 },
    0: { tier: 0, name: 'Tiết kiệm', qualityLevel: 2, compressionLevel: 9, minBwKBps: 0, maxRttMs: 999 }
}

export type QualityControls = {
    qualityLevel: number
    compressionLevel: number
    tier: QualityTier
    tierName: string
    label: string
    tooltip: string
    speedKBps: number
    fps: number
    rttMs: number
}

export type AdaptiveQualityHandle = {
    dispose: () => void
    getLevels: () => QualityControls
    setTier: (tier: QualityTier | 'auto') => void
}

type AdaptiveTarget = {
    qualityLevel: number
    compressionLevel: number
    _display?: {
        flip: (...args: unknown[]) => unknown
    }
    _sock?: {
        _websocket?: WebSocket | null
    }
}

export type MetricsSnapshot = {
    currentTier: QualityTier
    speedKBps: number
    rttMs: number
    fps: number
    avgFrameIntervalMs: number
    bufferedAmount: number
    isIdle: boolean
    consecutiveGoodTicks: number
    consecutiveBadTicks: number
}

export type NextTierResult = {
    nextTier: QualityTier
    nextGoodTicks: number
    nextBadTicks: number
}

/**
 * Pure evaluation function for YouTube-style Adaptive Bitrate decision.
 * Decouples logic so it can be rigorously unit tested.
 */
export function evaluateNextTier(metrics: MetricsSnapshot): NextTierResult {
    const {
        currentTier,
        speedKBps,
        rttMs,
        fps,
        avgFrameIntervalMs,
        bufferedAmount,
        isIdle,
        consecutiveGoodTicks,
        consecutiveBadTicks
    } = metrics

    // Rule 1: When screen is stationary (idle desktop), NEVER drop quality.
    // Retaining high quality on an idle screen prevents text blurring while reading.
    if (isIdle) {
        return {
            nextTier: currentTier,
            nextGoodTicks: 0,
            nextBadTicks: 0
        }
    }

    // Rule 2: Fast-Downgrade on Severe Congestion or High Latency (Zero Lag Guarantee)
    // If socket is congested or latency spiked or frames are dragging, drop immediately.
    const isSevereCongestion =
        bufferedAmount > 65536 ||
        rttMs > 280 ||
        (fps < 8 && avgFrameIntervalMs > 130 && speedKBps > 30)

    if (isSevereCongestion) {
        // Drop up to 2 tiers on emergency congestion
        const droppedTier = Math.max(0, currentTier - (bufferedAmount > 131072 || rttMs > 350 ? 2 : 1)) as QualityTier
        return {
            nextTier: droppedTier,
            nextGoodTicks: 0,
            nextBadTicks: consecutiveBadTicks + 1
        }
    }

    // Rule 3: Regular Downgrade if throughput cannot sustain current tier
    const curDef = QUALITY_TIERS[currentTier]
    const isUnderperforming =
        (speedKBps > 0 && speedKBps < curDef.minBwKBps * 0.65) ||
        rttMs > curDef.maxRttMs * 1.3 ||
        (fps < 12 && avgFrameIntervalMs > 90)

    if (isUnderperforming && currentTier > 0) {
        const nextBad = consecutiveBadTicks + 1
        // Trigger drop if conditions remain bad for 2 ticks or immediate if latency is high
        if (nextBad >= 2 || rttMs > curDef.maxRttMs * 1.5) {
            return {
                nextTier: Math.max(0, currentTier - 1) as QualityTier,
                nextGoodTicks: 0,
                nextBadTicks: 0
            }
        }
        return {
            nextTier: currentTier,
            nextGoodTicks: 0,
            nextBadTicks: nextBad
        }
    }

    // Rule 4: Gradual Upgrade (Smooth Ramp-up / Hysteresis like YouTube)
    // Only upgrade if next tier's requirements are met consistently for >= 3 ticks (3 seconds)
    if (currentTier < 4) {
        const higherTier = (currentTier + 1) as QualityTier
        const highDef = QUALITY_TIERS[higherTier]

        const qualifiesForHigher =
            speedKBps >= highDef.minBwKBps &&
            rttMs <= highDef.maxRttMs &&
            fps >= 14 &&
            bufferedAmount === 0

        if (qualifiesForHigher) {
            const nextGood = consecutiveGoodTicks + 1
            if (nextGood >= 3) {
                return {
                    nextTier: higherTier,
                    nextGoodTicks: 0,
                    nextBadTicks: 0
                }
            }
            return {
                nextTier: currentTier,
                nextGoodTicks: nextGood,
                nextBadTicks: 0
            }
        }
    }

    // Stable state
    return {
        nextTier: currentTier,
        nextGoodTicks: Math.max(0, consecutiveGoodTicks - 1),
        nextBadTicks: 0
    }
}

/**
 * Reads browser Network Information API when available.
 */
function getNetworkInfo(): { downlinkMbps: number; rttMs: number; isSaveData: boolean } {
    if (typeof navigator === 'undefined') {
        return { downlinkMbps: 10, rttMs: 40, isSaveData: false }
    }
    const nav = navigator as Navigator & {
        connection?: {
            downlink?: number
            rtt?: number
            saveData?: boolean
        }
    }
    const conn = nav.connection
    return {
        downlinkMbps: typeof conn?.downlink === 'number' && conn.downlink > 0 ? conn.downlink : 10,
        rttMs: typeof conn?.rtt === 'number' && conn.rtt > 0 ? conn.rtt : 40,
        isSaveData: Boolean(conn?.saveData)
    }
}

const TICK_INTERVAL_MS = 1000

export function attachAdaptiveQuality(
    rfb: AdaptiveTarget,
    onChange?: (levels: QualityControls) => void
): AdaptiveQualityHandle {
    // Initial tier assessment based on connection
    const net = getNetworkInfo()
    let currentTier: QualityTier = 3 // Default HD
    if (net.isSaveData || net.downlinkMbps < 1 || net.rttMs > 250) {
        currentTier = 1 // Mượt
    } else if (net.downlinkMbps < 3 || net.rttMs > 130) {
        currentTier = 2 // SD
    } else if (net.downlinkMbps >= 10 && net.rttMs <= 40) {
        currentTier = 4 // HD+
    }

    let manualTier: QualityTier | 'auto' = 'auto'
    let consecutiveGoodTicks = 0
    let consecutiveBadTicks = 0
    let framesInTick = 0
    let sumIntervalMs = 0
    let lastFlipTime = performance.now()
    let bytesInTick = 0
    let lastCalculatedSpeedKBps = 0
    let disposed = false

    // Attach to underlying WebSocket to measure exact throughput (Bytes/s)
    let wsHooked: WebSocket | null = null
    const onSocketMessage = (e: MessageEvent) => {
        if (e.data instanceof ArrayBuffer) {
            bytesInTick += e.data.byteLength
        } else if (typeof e.data?.size === 'number') {
            bytesInTick += e.data.size
        } else if (typeof e.data?.length === 'number') {
            bytesInTick += e.data.length
        }
    }

    function checkHookWebSocket() {
        const ws = rfb._sock?._websocket
        if (ws && ws !== wsHooked) {
            wsHooked = ws
            try {
                ws.addEventListener('message', onSocketMessage, { passive: true })
            } catch {
                // ignore
            }
        }
    }
    checkHookWebSocket()

    // Hook display.flip to measure real frame interval and render latency
    const display = rfb._display
    const originalFlip = display?.flip?.bind(display)

    if (display && originalFlip) {
        display.flip = (...args: unknown[]) => {
            const now = performance.now()
            const dt = now - lastFlipTime
            if (dt > 0 && dt < 2000) {
                framesInTick += 1
                sumIntervalMs += dt
            }
            lastFlipTime = now
            return originalFlip(...args)
        }
    }

    function emitCurrentState() {
        const activeTier = manualTier !== 'auto' ? manualTier : currentTier
        const def = QUALITY_TIERS[activeTier]

        if (rfb.qualityLevel !== def.qualityLevel) {
            rfb.qualityLevel = def.qualityLevel
        }
        if (rfb.compressionLevel !== def.compressionLevel) {
            rfb.compressionLevel = def.compressionLevel
        }

        const netInfo = getNetworkInfo()
        const speedDisplay =
            lastCalculatedSpeedKBps >= 1024
                ? `${(lastCalculatedSpeedKBps / 1024).toFixed(1)} MB/s`
                : `${Math.round(lastCalculatedSpeedKBps)} KB/s`

        const label = `Auto (${def.name})`
        const tooltip = `Chất lượng thích ứng: ${def.name} (Q${def.qualityLevel}/C${def.compressionLevel}) · ${speedDisplay} · Ping ~${Math.round(netInfo.rttMs)}ms`

        onChange?.({
            qualityLevel: def.qualityLevel,
            compressionLevel: def.compressionLevel,
            tier: activeTier,
            tierName: def.name,
            label,
            tooltip,
            speedKBps: lastCalculatedSpeedKBps,
            fps: framesInTick,
            rttMs: netInfo.rttMs
        })
    }

    // Apply initial settings immediately
    emitCurrentState()

    const timer = window.setInterval(() => {
        if (disposed) return
        checkHookWebSocket()

        const speedKBps = bytesInTick / 1024
        lastCalculatedSpeedKBps = speedKBps
        const fps = framesInTick
        const avgFrameIntervalMs = framesInTick > 0 ? sumIntervalMs / framesInTick : 999
        const ws = rfb._sock?._websocket
        const bufferedAmount = ws?.bufferedAmount || 0
        const netInfo = getNetworkInfo()

        // Reset tick accumulators
        bytesInTick = 0
        framesInTick = 0
        sumIntervalMs = 0

        // Determine if desktop is stationary (idle)
        const isIdle = speedKBps < 40 && fps <= 2

        if (manualTier === 'auto') {
            const decision = evaluateNextTier({
                currentTier,
                speedKBps,
                rttMs: netInfo.rttMs,
                fps,
                avgFrameIntervalMs,
                bufferedAmount,
                isIdle,
                consecutiveGoodTicks,
                consecutiveBadTicks
            })

            consecutiveGoodTicks = decision.nextGoodTicks
            consecutiveBadTicks = decision.nextBadTicks

            if (decision.nextTier !== currentTier) {
                currentTier = decision.nextTier
            }
        }

        emitCurrentState()
    }, TICK_INTERVAL_MS)

    return {
        dispose() {
            disposed = true
            window.clearInterval(timer)
            if (wsHooked) {
                try {
                    wsHooked.removeEventListener('message', onSocketMessage)
                } catch {
                    // ignore
                }
                wsHooked = null
            }
            if (display && originalFlip) {
                display.flip = originalFlip
            }
        },
        getLevels() {
            const activeTier = manualTier !== 'auto' ? manualTier : currentTier
            const def = QUALITY_TIERS[activeTier]
            const netInfo = getNetworkInfo()
            return {
                qualityLevel: def.qualityLevel,
                compressionLevel: def.compressionLevel,
                tier: activeTier,
                tierName: def.name,
                label: `Auto (${def.name})`,
                tooltip: `Chất lượng: ${def.name} · Q${def.qualityLevel}/C${def.compressionLevel}`,
                speedKBps: lastCalculatedSpeedKBps,
                fps: framesInTick,
                rttMs: netInfo.rttMs
            }
        },
        setTier(next) {
            manualTier = next
            emitCurrentState()
        }
    }
}
