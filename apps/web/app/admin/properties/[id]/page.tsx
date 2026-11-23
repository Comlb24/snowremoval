import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { clientOptions, config, getProperty } from '@snow/server';
import { requirePageRole } from '@/lib/session';
import { btn, Card, Notice, PageHeader, Tag } from '@/components/ui';
import { createStatusLinkAction, revokeStatusLinkAction, setPropertyActiveAction } from '../../actions';
import { PropertyForm } from '../property-form';
import { CopyLink } from './copy-link';

export default async function PropertyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string; error?: string }> }) {
  const user = await requirePageRole('admin');
  const { id } = await params;
  const sp = await searchParams;
  const [p, clients] = await Promise.all([getProperty(user, id), clientOptions(user)]);
  if (!p) notFound();
  const flashLink = (await cookies()).get('snow_flash_link')?.value;

  return (
    <>
      <PageHeader
        title={p.address}
        sub={<><Link href="/admin/properties" className="text-sky-700">← Properties</Link> · Owner <Link href={`/admin/clients/${p.client_id}`} className="text-sky-700 hover:underline">{p.client_name}</Link></>}
        actions={p.active ? <Tag tone="success">Active</Tag> : <Tag>Inactive</Tag>}
      />
      {sp.msg && <div className="mb-4"><Notice tone="success">{sp.msg}</Notice></div>}
      {sp.error && <div className="mb-4"><Notice tone="danger">{sp.error}</Notice></div>}
      {flashLink && (
        <div className="mb-4">
          <Notice tone="warning">
            New private status link. Copy it now — it is shown only once. Creating it turned off any older link.
            <CopyLink url={flashLink} />
          </Notice>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Property details" className="lg:col-span-2">
          <PropertyForm clients={clients} property={p} simulatedLocations={config().routingMode === 'mock'} />
        </Card>

        <div className="space-y-4">
          <Card title="Service">
            <p className="mb-3 text-sm text-slate-700">
              {p.active ? 'Active properties can be added to routes and count toward the client’s balance.' : 'Inactive properties are left off new routes and do not count toward the balance.'}
            </p>
            <form action={setPropertyActiveAction}>
              <input type="hidden" name="propertyId" value={p.id} />
              <input type="hidden" name="active" value={p.active ? 'false' : 'true'} />
              <button className={btn('secondary', 'sm')}>{p.active ? 'Mark inactive' : 'Mark active'}</button>
            </form>
          </Card>

          <Card title="Private status link">
            <p className="mb-3 text-sm text-slate-700">
              {p.has_status_link ? 'A link is active. The client can see arrival times without signing in.' : 'No link yet. Create one to text the client a page with arrival times.'}
            </p>
            <div className="flex flex-wrap gap-2">
              <form action={createStatusLinkAction}>
                <input type="hidden" name="propertyId" value={p.id} />
                <button className={btn('secondary', 'sm')}>{p.has_status_link ? 'Replace link' : 'Create link'}</button>
              </form>
              {p.has_status_link && (
                <form action={revokeStatusLinkAction}>
                  <input type="hidden" name="propertyId" value={p.id} />
                  <button className={btn('danger', 'sm')}>Revoke link</button>
                </form>
              )}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
