import Link from 'next/link';
import { equipmentText } from '@snow/core';
import { listProperties } from '@snow/server';
import { requirePageRole } from '@/lib/session';
import { Card, Empty, input, LinkButton, Notice, PageHeader, Tag } from '@/components/ui';
import { money } from '@/lib/format';

export default async function PropertiesPage({ searchParams }: { searchParams: Promise<{ q?: string; msg?: string }> }) {
  const user = await requirePageRole('admin');
  const { q = '', msg } = await searchParams;
  const properties = await listProperties(user, q);
  const active = properties.filter((p: any) => p.active).length;
  return (
    <>
      <PageHeader
        title="Properties"
        sub={`${active} active · ${properties.length - active} inactive`}
        actions={
          <>
            <LinkButton href="/admin/clients/import" variant="secondary">Import CSV</LinkButton>
            <LinkButton href="/admin/properties/new">Add property</LinkButton>
          </>
        }
      />
      {msg && <div className="mb-4"><Notice tone="success">{msg}</Notice></div>}
      <form className="mb-4">
        <input name="q" defaultValue={q} placeholder="Search address, owner or resident" className={`${input} max-w-md`} />
      </form>
      <Card>
        {properties.length === 0 ? (
          <Empty>{q ? 'No properties found.' : 'No properties yet. Add a client first, then add their properties.'}</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2 pr-4">Address</th>
                  <th className="py-2 pr-4">Owner</th>
                  <th className="py-2 pr-4">Equipment</th>
                  <th className="py-2 pr-4 text-right">Quote</th>
                  <th className="py-2">Driver notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {properties.map((p: any) => (
                  <tr key={p.id} className={`align-top hover:bg-slate-50 ${p.active ? '' : 'text-slate-400'}`}>
                    <td className="py-2 pr-4">
                      <Link href={`/admin/properties/${p.id}`} className={`font-medium hover:underline ${p.active ? 'text-sky-800' : 'text-slate-500'}`}>{p.address}</Link>
                      {!p.active && <> <Tag>Inactive</Tag></>}
                    </td>
                    <td className="py-2 pr-4">
                      <Link href={`/admin/clients/${p.client_id}`} className="hover:underline">{p.client_name}</Link>
                      {p.has_resident && <div className="text-xs text-slate-500">Updates to resident{p.resident_name ? `: ${p.resident_name}` : ''}</div>}
                    </td>
                    <td className="py-2 pr-4">{equipmentText(p.equipment) || <span className="text-slate-400">Not set</span>}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{money(p.quoted_amount)}</td>
                    <td className="max-w-xs truncate py-2 text-slate-600" title={p.instructions}>{p.instructions || '—'}</td>
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
