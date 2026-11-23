import Link from 'next/link';
import { clientOptions, config } from '@snow/server';
import { requirePageRole } from '@/lib/session';
import { Card, LinkButton, Notice, PageHeader } from '@/components/ui';
import { PropertyForm } from '../property-form';

export default async function NewPropertyPage({ searchParams }: { searchParams: Promise<{ clientId?: string; error?: string }> }) {
  const user = await requirePageRole('admin');
  const { clientId, error } = await searchParams;
  const clients = await clientOptions(user);
  const owner = clientId ? clients.find((c) => c.id === clientId) : undefined;
  const fromClient = owner?.id;
  return (
    <>
      <PageHeader
        title="Add property"
        sub={fromClient ? <><Link href={`/admin/clients/${fromClient}`} className="text-sky-700">← {owner!.name}</Link> · You can add more properties for this client after saving.</> : <Link href="/admin/properties" className="text-sky-700">← Properties</Link>}
      />
      {error && <div className="mb-4"><Notice tone="danger">{error}</Notice></div>}
      {clients.length === 0 ? (
        <Card>
          <p className="mb-3 text-sm text-slate-700">Every property needs an owner. Add the client first.</p>
          <LinkButton href="/admin/clients/new">Add client</LinkButton>
        </Card>
      ) : (
        <Card>
          <PropertyForm clients={clients} clientId={fromClient} returnTo={fromClient ? 'client' : undefined} simulatedLocations={config().routingMode === 'mock'} />
        </Card>
      )}
    </>
  );
}
