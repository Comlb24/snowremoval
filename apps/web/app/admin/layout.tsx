import { requirePageRole } from '@/lib/session';
import { AdminNav } from './nav';
import { logoutAction } from '../login/actions';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const u = await requirePageRole('admin');
  return (
    <div className="min-h-screen">
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
