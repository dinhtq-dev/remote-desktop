#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import bcrypt from 'bcryptjs'

const password = process.argv[2]
if (!password) {
    console.error('Usage: npm run hash-password -- "your-strong-password"')
    console.error('       npm run hash-password -- "your-strong-password" --write')
    process.exit(1)
}

const write = process.argv.includes('--write')
const hash = await bcrypt.hash(password, 12)

if (write) {
    const runtimeDir = resolve(import.meta.dirname, '../.runtime')
    const hashPath = resolve(runtimeDir, 'auth-password.hash')
    mkdirSync(runtimeDir, { mode: 0o700, recursive: true })
    writeFileSync(hashPath, `${hash}\n`, { mode: 0o600 })
    console.log(`Wrote ${hashPath}`)
    console.log('Restart: systemctl --user restart urw-web.service')
} else {
    console.log(hash)
    console.log('# Or write directly: npm run hash-password -- "..." --write')
}
