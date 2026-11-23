import Link from 'next/link';
import { listClients } from '@snow/server';
import { requirePageRole } from '@/lib/session';
import { Card, Empty, input, LinkButton, PageHeader, Tag } from '@/components/ui';
import { phone } from '@/lib/format';

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requirePageRole('admin');
  const { q = '' } = await searchParams;
  const clients = await listClients(user, q);
  return (
    <>
      <PageHeader
        title="Clients & Properties"
        sub={`${clients.length} client${clients.length === 1 ? '' : 's'}`}
        actions={
          <>
            <LinkButton href="/admin/clients/import" variant="secondary">Import CSV</LinkButton>
            <LinkButton href="/admin/clients/new">Add client</LinkButton>
          </>
        }
      />
      <form className="mb-4">
        <input name="q" defaultValue={q} placeholder="Search name, address or phone" className={`${input} max-w-md`} />
      </form>
      <Card>
        {clients.length === 0 ? (
          <Empty>No clients found.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2 pr-4">Client</th>
                  <th className="py-2 pr-4">Phone</th>
                  <th className="py-2 pr-4">Notify by</th>
                  <th className="py-2">Properties</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {clients.map((c: any) => (
                  <tr key={c.id} className="align-top hover:bg-slate-50">
                    <td className="py-2 pr-4">
                      <Link href={`/admin/clients/${c.id}`} className="font-medium text-sky-800 hover:underline">{c.name}</Link>
                    </td>
                    <td className="py-2 pr-4 tabular-nums">{phone(c.phone)}</td>
                    <td className="py-2 pr-4">
                      {c.opted_out ? <Tag tone="danger">Opted out</Tag> : c.notify_channel === 'sms' ? 'SMS' : 'Voice call'}
                    </td>
                    <td className="py-2">
                      <ul>
                        {c.properties.map((p: any) => (
                          <li key={p.id} className={p.active ? '' : 'text-slate-400 line-through'}>{p.address}</li>
                        ))}
                      </ul>
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
