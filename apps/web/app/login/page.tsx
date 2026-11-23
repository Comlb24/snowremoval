import { config, devLoginEnabled, listDevUsers } from '@snow/server';
import { btn, Card, input, Notice } from '@/components/ui';
import { devLoginAction, passwordLoginAction } from './actions';

export const dynamic = 'force-dynamic';

const ROLE_LABEL: Record<string, string> = { admin: 'Admin', driver: 'Driver', client: 'Client' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const dev = devLoginEnabled();
  const users = dev ? await listDevUsers() : [];
  return (
    <main className="mx-auto max-w-md px-4 py-12">
      <h1 className="mb-1 text-2xl font-semibold">Sign in</h1>
      <p className="mb-6 text-sm text-slate-600">{config().businessName}</p>
      {error && <div className="mb-4"><Notice tone="danger">{error}</Notice></div>}
      {dev ? (
        <Card title="Development sign-in">
          <p className="mb-3 text-sm text-slate-600">Pick a demo account. This screen is turned off in production.</p>
          <ul className="space-y-2">
            {users.map((u) => (
              <li key={u.id}>
                <form action={devLoginAction}>
                  <input type="hidden" name="userId" value={u.id} />
                  <button className={`${btn('secondary')} w-full justify-between`}>
                    <span>{u.full_name}</span>
                    <span className="text-xs text-slate-500">{ROLE_LABEL[u.role]}</span>
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <Card>
          <form action={passwordLoginAction} className="space-y-3">
            <input name="email" type="email" required placeholder="Email" className={input} autoComplete="email" />
            <input name="password" type="password" required placeholder="Password" className={input} autoComplete="current-password" />
            <button className={`${btn()} w-full`}>Sign in</button>
          </form>
        </Card>
      )}
    </main>
  );
}
