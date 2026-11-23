import Link from 'next/link';
import { listRoutes } from '@snow/server';
import { requirePageRole } from '@/lib/session';
import { Card, Empty, LinkButton, PageHeader, Progress, Status, Tag } from '@/components/ui';
import { day, t } from '@/lib/format';

export default async function RoutesPage() {
  const user = await requirePageRole('admin');
  const routes = await listRoutes(user);
  return (
    <>
      <PageHeader title="Routes" actions={<LinkButton href="/admin/routes/new">New route</LinkButton>} />
      <Card>
        {routes.length === 0 ? (
          <Empty>No routes yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr><th className="py-2 pr-4">Date</th><th className="py-2 pr-4">Driver</th><th className="py-2 pr-4">Start</th><th className="py-2 pr-4">Status</th><th className="py-2 pr-4 w-48">Progress</th><th className="py-2">Issues</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {routes.map((r: any) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="py-2 pr-4"><Link href={`/admin/routes/${r.id}`} className="font-medium text-sky-800 hover:underline">{day(r.service_date)}</Link></td>
                    <td className="py-2 pr-4">{r.driver_name}</td>
                    <td className="py-2 pr-4">{t(r.planned_start)}</td>
                    <td className="py-2 pr-4"><Status status={r.status} /></td>
                    <td className="py-2 pr-4"><Progress done={r.completed_count + r.blocked_count} total={r.stop_count} /></td>
                    <td className="py-2 space-x-1">
                      {r.blocked_count > 0 && <Tag tone="warning">{r.blocked_count} blocked</Tag>}
                      {r.failed_count > 0 && <Tag tone="danger">{r.failed_count} failed messages</Tag>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
