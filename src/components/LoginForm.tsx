'use client'

import { useState } from 'react'
import type { FormEvent } from 'react'
import { useRouter } from 'next/navigation'

type LoginFormProps = {
    nextPath?: string
}

export function LoginForm({ nextPath = '/desktop' }: LoginFormProps) {
    const router = useRouter()
    const [password, setPassword] = useState('')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)

    async function onSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        setError('')
        setLoading(true)

        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password })
            })
            const data = (await response.json()) as { error?: string }

            if (!response.ok) {
                setError(data.error || 'Login failed')
                return
            }

            router.replace(nextPath.startsWith('/') ? nextPath : '/desktop')
            router.refresh()
        } catch {
            setError('Network error')
        } finally {
            setLoading(false)
        }
    }

    return (
        <form onSubmit={onSubmit} className="flex w-full max-w-sm flex-col gap-4">
            <label className="flex flex-col gap-2 text-sm text-zinc-300">
                Password
                <input
                    type="password"
                    name="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-base text-zinc-100 outline-none ring-emerald-500 focus:ring-2"
                />
            </label>
            {error ? <p className="text-sm text-red-400">{error}</p> : null}
            <button
                type="submit"
                disabled={loading}
                className="rounded-md bg-emerald-600 px-4 py-2 font-medium text-white transition hover:bg-emerald-500 disabled:opacity-60"
            >
                {loading ? 'Signing in…' : 'Sign in'}
            </button>
        </form>
    )
}
