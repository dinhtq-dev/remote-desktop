import { createHash, timingSafeEqual } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import bcrypt from 'bcryptjs'
import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'

export const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'urw_session'

const DEFAULT_MAX_AGE = 60 * 60 * 12

function safeEqualString(a: string, b: string): boolean {
    const left = createHash('sha256').update(a).digest()
    const right = createHash('sha256').update(b).digest()

    return timingSafeEqual(left, right)
}

function loadPasswordHash(): string | null {
    const fromEnv = process.env.AUTH_PASSWORD_HASH?.trim()
    if (fromEnv) {
        const normalized = fromEnv.includes('$$') ? fromEnv.split('$$').join('$') : fromEnv
        if (normalized.startsWith('$2')) {
            return normalized
        }
    }

    const fileFromEnv = process.env.AUTH_PASSWORD_HASH_FILE
    const candidates = [
        fileFromEnv,
        resolve(process.cwd(), '.runtime/auth-password.hash'),
        resolve(process.cwd(), 'auth-password.hash')
    ].filter(Boolean) as string[]

    for (const file of candidates) {
        if (existsSync(file)) {
            const value = readFileSync(file, 'utf8').trim()
            if (value.startsWith('$2')) {
                return value
            }
        }
    }

    return null
}

export function getSessionSecret(): Uint8Array {
    const secret = process.env.SESSION_SECRET
    if (!secret || secret.length < 16) {
        throw new Error('SESSION_SECRET must be set (min 16 chars) in .env')
    }

    return new TextEncoder().encode(secret)
}

export function getSessionMaxAge(): number {
    const raw = process.env.SESSION_MAX_AGE_SECONDS
    const parsed = raw ? Number(raw) : DEFAULT_MAX_AGE

    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_AGE
}

export async function verifyPassword(password: string): Promise<boolean> {
    const plain = process.env.AUTH_PASSWORD
    if (plain) {
        return safeEqualString(password, plain)
    }

    const hash = loadPasswordHash()
    if (!hash) {
        return false
    }

    return bcrypt.compare(password, hash)
}

export async function createSessionToken(): Promise<string> {
    const maxAge = getSessionMaxAge()

    return new SignJWT({ role: 'operator' })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime(`${maxAge}s`)
        .sign(getSessionSecret())
}

export async function verifySessionToken(token: string): Promise<boolean> {
    try {
        await jwtVerify(token, getSessionSecret())
        return true
    } catch {
        return false
    }
}

export async function getSessionFromCookies(): Promise<boolean> {
    const jar = await cookies()
    const token = jar.get(SESSION_COOKIE_NAME)?.value
    if (!token) {
        return false
    }

    return verifySessionToken(token)
}
