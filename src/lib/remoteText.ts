const XK_TAB = 0xff09
const XK_RETURN = 0xff0d

export const KEYSYMS = {
    Backspace: 0xff08,
    Tab: 0xff09,
    Return: 0xff0d,
    Escape: 0xff1b,
    Delete: 0xffff,
    Home: 0xff50,
    Left: 0xff51,
    Up: 0xff52,
    Right: 0xff53,
    Down: 0xff54,
    PageUp: 0xff55,
    PageDown: 0xff56,
    End: 0xff57,
    ControlLeft: 0xffe3,
    AltLeft: 0xffe9,
    SuperLeft: 0xffeb
} as const

/**
 * X keysym for one Unicode scalar.
 * Latin-1 matches the RFB keysym. U+0100 and above use the Unicode keysym
 * (0x01000000 | code point), which x11vnc installs with -add_keysyms.
 */
export function keysymForCodepoint(codePoint: number): number | null {
    if (codePoint === 0x09) return XK_TAB
    if (codePoint === 0x0a || codePoint === 0x0d) return XK_RETURN
    if (codePoint < 0x20 || codePoint === 0x7f) return null
    if (codePoint <= 0xff) return codePoint
    return 0x01000000 | codePoint
}

/** Keysyms to type `text` on the remote, in order. CRLF is one Return. */
export function keysymsForText(text: string): number[] {
    const out: number[] = []
    for (let i = 0; i < text.length; ) {
        const codePoint = text.codePointAt(i)
        if (codePoint === undefined) break
        i += codePoint > 0xffff ? 2 : 1
        if (codePoint === 0x0d && text.codePointAt(i) === 0x0a) i += 1
        const keysym = keysymForCodepoint(codePoint)
        if (keysym !== null) out.push(keysym)
    }
    return out
}
