#!/usr/bin/env node
import { randomBytes } from 'node:crypto'
import { writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const envPath = resolve(root, '.env')

if (existsSync(envPath) && process.argv[2] !== '--force') {
    console.error('.env already exists. Pass --force to overwrite.')
    process.exit(1)
}

const password = process.argv[2] === '--force' ? process.argv[3] : process.argv[2]
const plain = password || `urw-${randomBytes(9).toString('base64url')}`
const secret = randomBytes(32).toString('hex')

const contents = `# ubuntu-remote-web — do not commit
PORT=3100
HOST=127.0.0.1

# Đổi mật khẩu login tại đây
AUTH_PASSWORD=${plain}

SESSION_SECRET=${secret}
SESSION_COOKIE_NAME=urw_session
SESSION_MAX_AGE_SECONDS=43200

VNC_HOST=127.0.0.1
VNC_PORT=5900
`

writeFileSync(envPath, contents, { mode: 0o600 })
console.log(`Wrote ${envPath}`)
console.log(`Login password: ${plain}`)
