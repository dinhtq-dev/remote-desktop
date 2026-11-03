import test from 'node:test'
import assert from 'node:assert/strict'
import { keysymForCodepoint, keysymsForText, KEYSYMS } from '../src/lib/remoteText.ts'

test('keysymForCodepoint maps ascii control and printable', () => {
    assert.equal(keysymForCodepoint(0x09), 0xff09) // Tab
    assert.equal(keysymForCodepoint(0x0a), 0xff0d) // Return
    assert.equal(keysymForCodepoint(0x0d), 0xff0d) // Return
    assert.equal(keysymForCodepoint(0x20), 0x20) // Space
    assert.equal(keysymForCodepoint(0x61), 0x61) // 'a'
})

test('keysymForCodepoint maps unicode characters (Vietnamese)', () => {
    // 'Đ' is U+0110
    assert.equal(keysymForCodepoint(0x0110), 0x01000110)
    // 'ị' is U+1ECB
    assert.equal(keysymForCodepoint(0x1ecb), 0x01001ecb)
})

test('keysymsForText converts full string including unicode', () => {
    const text = 'Định 123'
    const syms = keysymsForText(text)
    assert.equal(syms.length, 8)
    assert.equal(syms[0], 0x01000110) // 'Đ'
    assert.equal(syms[1], 0x01001ecb) // 'ị'
    assert.equal(syms[2], 0x6e) // 'n'
    assert.equal(syms[3], 0x68) // 'h'
    assert.equal(syms[4], 0x20) // ' '
})

test('KEYSYMS includes common remote control keys', () => {
    assert.equal(KEYSYMS.Escape, 0xff1b)
    assert.equal(KEYSYMS.Tab, 0xff09)
    assert.equal(KEYSYMS.Return, 0xff0d)
    assert.equal(KEYSYMS.Backspace, 0xff08)
    assert.equal(KEYSYMS.Up, 0xff52)
    assert.equal(KEYSYMS.Down, 0xff54)
    assert.equal(KEYSYMS.Left, 0xff51)
    assert.equal(KEYSYMS.Right, 0xff53)
})
