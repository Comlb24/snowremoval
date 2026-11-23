import { config } from '@snow/server';
import { requirePageRole } from '@/lib/session';
import { AdminNav } from './nav';
import { logoutAction } from '../login/actions';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const u = await requirePageRole('admin');
  const c = config();
  const notes = [
    c.messagingMode !== 'live' && 'Messages are simulated — nothing is sent until Twilio is connected',
    c.routingMode === 'mock' && 'Travel times are simulated — not real road times until Mapbox is connected',
  ].filter(Boolean);
  return (
    <div className="min-h-screen">
      {c.appEnv === 'production' && notes.length > 0 && (
        <div role="status" className="bg-amber-100 px-4 py-1.5 text-center text-xs font-medium text-amber-950">
          {notes.join(' · ')}
        </div>
      )}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <span className="font-semibold text-slate-900">❄ Snow Removal</span>
          <AdminNav />
          <div className="ml-auto flex items-center gap-3 text-sm text-slate-600">
            <span>{u.fullName}</span>
            <form action={logoutAction}>
              <button className="text-sky-700 hover:underline">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
