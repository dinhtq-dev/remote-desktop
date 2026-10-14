import { LoginForm } from '@/components/LoginForm'

type LoginPageProps = {
    searchParams: Promise<{ next?: string }>
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
    const params = await searchParams
    const nextPath = params.next && params.next.startsWith('/') ? params.next : '/desktop'

    return (
        <main className="flex min-h-dvh items-center justify-center bg-[radial-gradient(ellipse_at_top,_#14532d_0%,_#09090b_55%)] px-4">
            <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950/80 p-8 shadow-2xl backdrop-blur">
                <h1 className="mb-2 text-2xl font-semibold tracking-tight text-zinc-50">Ubuntu Remote</h1>
                <p className="mb-6 text-sm text-zinc-400">
                    Sign in to control this machine&apos;s desktop from the browser.
                </p>
                <LoginForm nextPath={nextPath} />
            </div>
        </main>
    )
}
