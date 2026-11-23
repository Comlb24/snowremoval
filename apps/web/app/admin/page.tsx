import Link from 'next/link';
import { overview } from '@snow/server';
import { requirePageRole } from '@/lib/session';
import { Card, Empty, LinkButton, PageHeader, Progress, SimTag, Status } from '@/components/ui';
import { day, dt, t } from '@/lib/format';

export default async function OverviewPage() {
  const user = await requirePageRole('admin');
  const o = await overview(user);
  return (
    <>
      <PageHeader title="Overview" sub={day(o.today)} actions={<LinkButton href="/admin/routes/new">New route</LinkButton>} />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['Clients', o.counts.clients],
          ['Active properties', o.counts.properties],
          ['Messages waiting', o.counts.scheduled],
          ['Messages sent (24 h)', o.counts.sent_today],
        ].map(([l, v]) => (
          <div key={l as string} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-2xl font-semibold tabular-nums">{v}</div>
            <div className="text-sm text-slate-600">{l}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Today's routes" className="lg:col-span-2">
          {o.routes.length === 0 ? (
            <Empty>No routes today. <Link className="text-sky-700 underline" href="/admin/routes/new">Create one</Link>.</Empty>
          ) : (
            <ul className="divide-y divide-slate-100">
              {o.routes.map((r: any) => (
                <li key={r.id} className="py-3">
                  <Link href={`/admin/routes/${r.id}`} className="block hover:bg-slate-50">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span className="font-medium">{r.driver_name}</span>
                      <Status status={r.status} />
                      <span className="text-sm text-slate-500">Planned start {t(r.planned_start)}</span>
                      {r.status === 'published' && !r.shift_started_at && new Date(r.planned_start) < new Date() && (
                        <span className="text-sm font-medium text-amber-800">! Shift not started</span>
                      )}
                    </div>
                    <Progress done={r.completed_count + r.blocked_count} total={r.stop_count} />
                    <div className="mt-1 text-xs text-slate-600">
                      {r.completed_count} completed · {r.blocked_count} blocked · {r.active_count} in progress
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-4">
          <Card title={`Blocked properties (${o.blocked.length})`}>
            {o.blocked.length === 0 ? (
              <p className="text-sm text-slate-500">None.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {o.blocked.map((b: any) => (
                  <li key={b.id}>
                    <Link href={`/admin/routes/${b.route_id}`} className="hover:underline">
                      <Status status="blocked" /> <span className="font-medium">{b.address}</span>
                    </Link>
                    <div className="text-slate-600">{b.block_reason ?? 'No reason given'}{b.note ? ` — “${b.note}”` : ''} · {t(b.finished_at)}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title={`Failed notifications (${o.failed.length})`} actions={<Link href="/admin/communications?status=failed" className="text-sm text-sky-700">View all</Link>}>
            {o.failed.length === 0 ? (
              <p className="text-sm text-slate-500">None.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {o.failed.map((n: any) => (
                  <li key={n.id}>
                    <Link href={`/admin/clients/${n.client_id}`} className="font-medium hover:underline">{n.client_name}</Link> <SimTag simulated={n.simulated} />
                    <div className="text-slate-600">{n.error} · {dt(n.failed_at)}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
