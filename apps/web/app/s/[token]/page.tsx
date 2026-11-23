import type { Metadata } from 'next';
import { config, statusByToken } from '@snow/server';
import { StatusView } from '@/components/status-view';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Service status', robots: { index: false, follow: false }, referrer: 'no-referrer' };

export default async function PublicStatusPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const s = await statusByToken(token);
  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <meta httpEquiv="refresh" content="60" />
      <p className="mb-4 text-sm font-medium text-slate-500">{config().businessName}</p>
      {!s ? (
        <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <h1 className="text-xl font-semibold">Link not available</h1>
          <p className="mt-2 text-slate-600">This status link is not valid or has been turned off. Please contact us for a new link.</p>
        </div>
      ) : (
        <>
          <h1 className="mb-4 text-xl font-semibold">Hi {s.firstName || 'there'}</h1>
          <StatusView address={s.address} stop={s.stop} active={s.active} />
          <p className="mt-6 text-center text-xs text-slate-500">This page updates every minute. Keep this link private.</p>
        </>
      )}
    </main>
  );
}
