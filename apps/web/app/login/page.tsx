import Link from 'next/link';
import { devLoginEnabled, listDevUsers } from '@snow/server';
import { AuthShell, GlassNotice } from '@/components/auth-shell';
import { glassInput, glassLabel, glassLink } from '@/components/glass';
import { devLoginAction, passwordLoginAction } from './actions';
import { SubmitButton } from './submit-button';

export const dynamic = 'force-dynamic';

const ROLE_LABEL: Record<string, string> = { admin: 'Admin', driver: 'Driver', client: 'Client' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; reset?: string }> }) {
  const { error, reset } = await searchParams;
  const dev = devLoginEnabled();
  const users = dev ? await listDevUsers() : [];
  return (
    <AuthShell title="Welcome back" subtitle="Sign in to see your routes, visits and updates.">
      {error && <GlassNotice tone="danger">{error}</GlassNotice>}
      {reset && <GlassNotice tone="success">Your password is updated. Sign in with the new one.</GlassNotice>}

      <form action={passwordLoginAction} className="space-y-4">
        <label className="block">
          <span className={glassLabel}>Email</span>
          <input name="email" type="email" required placeholder="you@example.com" className={glassInput} autoComplete="email" />
        </label>
        <label className="block">
          <span className="mb-1.5 flex items-baseline justify-between">
            <span className="text-sm font-medium text-white/85">Password</span>
            <Link href="/forgot-password" className={`text-sm ${glassLink}`}>
              Forgot password?
            </Link>
          </span>
          <input name="password" type="password" required placeholder="••••••••" className={glassInput} autoComplete="current-password" />
        </label>
        <div className="pt-1">
          <SubmitButton label="Sign in" pendingLabel="Signing in…" />
        </div>
      </form>

      {dev && (
        <div className="mt-7">
          <div className="mb-3 flex items-center gap-3 text-xs font-medium uppercase tracking-wider text-white/60">
            <span className="h-px flex-1 bg-white/20" />
            Demo accounts
            <span className="h-px flex-1 bg-white/20" />
          </div>
          <ul className="space-y-2">
            {users.map((u) => (
              <li key={u.id}>
                <form action={devLoginAction}>
                  <input type="hidden" name="userId" value={u.id} />
                  <button className="flex w-full items-center justify-between rounded-xl border border-white/20 bg-white/[0.08] px-3.5 py-2.5 text-left text-sm text-white transition hover:border-white/35 hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60">
                    <span className="font-medium">{u.full_name}</span>
                    <span className="rounded-full border border-white/25 bg-white/10 px-2 py-0.5 text-xs text-white/80">{ROLE_LABEL[u.role] ?? u.role}</span>
                  </button>
                </form>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-center text-xs text-white/60">Demo accounts are turned off on the live site.</p>
        </div>
      )}
    </AuthShell>
  );
}
