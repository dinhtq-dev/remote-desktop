import test from 'node:test'
import assert from 'node:assert/strict'
import {
    evaluateNextTier,
    QUALITY_TIERS,
    type MetricsSnapshot
} from '../src/lib/adaptiveQuality.ts'

test('QUALITY_TIERS covers all 5 tiers from 0 to 4', () => {
    assert.equal(QUALITY_TIERS[4].name, 'HD+')
    assert.equal(QUALITY_TIERS[4].qualityLevel, 9)
    assert.equal(QUALITY_TIERS[3].name, 'HD')
    assert.equal(QUALITY_TIERS[3].qualityLevel, 7)
    assert.equal(QUALITY_TIERS[2].name, 'SD')
    assert.equal(QUALITY_TIERS[2].qualityLevel, 5)
    assert.equal(QUALITY_TIERS[1].name, 'Mượt')
    assert.equal(QUALITY_TIERS[1].qualityLevel, 3)
    assert.equal(QUALITY_TIERS[0].name, 'Tiết kiệm')
    assert.equal(QUALITY_TIERS[0].qualityLevel, 2)
})

test('evaluateNextTier never downgrades when desktop is stationary (isIdle)', () => {
    const idleMetrics: MetricsSnapshot = {
        currentTier: 3,
        speedKBps: 5,
        rttMs: 35,
        fps: 0,
        avgFrameIntervalMs: 999,
        bufferedAmount: 0,
        isIdle: true,
        consecutiveGoodTicks: 0,
        consecutiveBadTicks: 0
    }

    const res = evaluateNextTier(idleMetrics)
    assert.equal(res.nextTier, 3, 'Should retain HD tier on idle desktop')
})

test('evaluateNextTier triggers Fast-Downgrade on severe congestion or high RTT', () => {
    // Socket buffer congested
    const congestedMetrics: MetricsSnapshot = {
        currentTier: 3,
        speedKBps: 400,
        rttMs: 120,
        fps: 5,
        avgFrameIntervalMs: 150,
        bufferedAmount: 80000, // > 65536
        isIdle: false,
        consecutiveGoodTicks: 0,
        consecutiveBadTicks: 0
    }

    const res1 = evaluateNextTier(congestedMetrics)
    assert.ok(res1.nextTier < 3, 'Should drop tier immediately on socket buffer congestion')

    // Severe RTT spike (> 350ms)
    const lagMetrics: MetricsSnapshot = {
        currentTier: 3,
        speedKBps: 100,
        rttMs: 380,
        fps: 4,
        avgFrameIntervalMs: 200,
        bufferedAmount: 150000,
        isIdle: false,
        consecutiveGoodTicks: 0,
        consecutiveBadTicks: 0
    }

    const res2 = evaluateNextTier(lagMetrics)
    assert.equal(res2.nextTier, 1, 'Should drop 2 tiers on emergency congestion')
})

test('evaluateNextTier requires 3 consecutive good ticks to upgrade (Hysteresis)', () => {
    const fastMetrics: MetricsSnapshot = {
        currentTier: 2, // SD
        speedKBps: 2000, // Sustains HD (1300 KB/s required)
        rttMs: 40,
        fps: 25,
        avgFrameIntervalMs: 40,
        bufferedAmount: 0,
        isIdle: false,
        consecutiveGoodTicks: 0,
        consecutiveBadTicks: 0
    }

    // Tick 1
    const tick1 = evaluateNextTier(fastMetrics)
    assert.equal(tick1.nextTier, 2, 'Should not upgrade on tick 1')
    assert.equal(tick1.nextGoodTicks, 1)

    // Tick 2
    const tick2 = evaluateNextTier({ ...fastMetrics, consecutiveGoodTicks: tick1.nextGoodTicks })
    assert.equal(tick2.nextTier, 2, 'Should not upgrade on tick 2')
    assert.equal(tick2.nextGoodTicks, 2)

    // Tick 3
    const tick3 = evaluateNextTier({ ...fastMetrics, consecutiveGoodTicks: tick2.nextGoodTicks })
    assert.equal(tick3.nextTier, 3, 'Should upgrade to Tier 3 (HD) after 3 consistent ticks')
    assert.equal(tick3.nextGoodTicks, 0)
})
