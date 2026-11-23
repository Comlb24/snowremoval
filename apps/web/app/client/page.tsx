import { clientOverview, config } from '@snow/server';
import { requirePageRole } from '@/lib/session';
import { StatusView } from '@/components/status-view';
import { day, t } from '@/lib/format';
import { logoutAction } from '../login/actions';

export const dynamic = 'force-dynamic';

export default async function ClientHome() {
  const user = await requirePageRole('client');
  const { client, properties } = await clientOverview(user);
  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <meta httpEquiv="refresh" content="60" />
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm font-medium text-slate-500">{config().businessName}</p>
        <form action={logoutAction}><button className="text-sm text-sky-700">Sign out</button></form>
      </div>
      <h1 className="mb-4 text-xl font-semibold">Hi {client?.name.split(' ')[0]}</h1>
      <div className="space-y-4">
        {properties.map((p: any) => (
          <div key={p.id}>
            <StatusView address={p.address} active={p.active} stop={p.stop} />
            {p.stop?.photoIds?.length > 0 && (
              <div className="mt-2 flex gap-2 overflow-x-auto">
                {p.stop.photoIds.map((id: string) => (
                  // Private photo served only after a permission check.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={id} src={`/api/photos/${id}`} alt="Driveway after service" className="h-28 rounded-lg object-cover ring-1 ring-slate-200" />
                ))}
              </div>
            )}
            {p.history?.length > 0 && (
              <details className="mt-2 text-sm text-slate-700">
                <summary className="cursor-pointer">Past visits</summary>
                <ul className="mt-1 space-y-1">
                  {p.history.map((h: any, i: number) => (
                    <li key={i}>{h.status === 'completed' ? '✓ Completed' : '! Blocked'} · {day(h.at)} {t(h.at)}{h.has_photo ? ' · photo' : ''}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        ))}
      </div>
      <p className="mt-6 text-xs text-slate-500">
        Updates by {({ sms: 'SMS', email: 'email', voice: 'automated voice call' } as Record<string, string>)[client?.notify_channel ?? 'sms']}{client?.opted_out ? ' (turned off)' : ''}. To change this, contact us.
      </p>
    </main>
  );
}
