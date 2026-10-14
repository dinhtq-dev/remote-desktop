declare module '@novnc/novnc' {
    export default class RFB {
        constructor(target: HTMLElement, url: string, options?: Record<string, unknown>)
        disconnect(): void
        focus(): void
        blur(): void
        scaleViewport: boolean
        resizeSession: boolean
        clipViewport: boolean
        dragViewport: boolean
        qualityLevel: number
        _fbWidth?: number
        _fbHeight?: number
        addEventListener(type: string, listener: (...args: unknown[]) => void): void
        removeEventListener(type: string, listener: (...args: unknown[]) => void): void
    }
}
