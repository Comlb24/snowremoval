import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { config, getClient } from '@snow/server';
import { requirePageRole } from '@/lib/session';
import { btn, Card, Field, input, Notice, PageHeader, SimTag, Status, Tag } from '@/components/ui';
import { day, dt, phone } from '@/lib/format';
import {
  createClientLoginAction, createStatusLinkAction, revokeStatusLinkAction, savePropertyAction, sendMessageAction, setPropertyActiveAction, updateClientAction,
} from '../../actions';
import { CopyLink } from './copy-link';

export default async function ClientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string; error?: string }> }) {
  const user = await requirePageRole('admin');
  const { id } = await params;
  const sp = await searchParams;
  const flashLink = (await cookies()).get('snow_flash_link')?.value;
  const data = await getClient(user, id);
  if (!data) notFound();
  const { client, properties, visits, communications, preferences } = data;

  return (
    <>
      <PageHeader
        title={client.name}
        sub={<><Link href="/admin/clients" className="text-sky-700">← Clients</Link> · {properties.length} propert{properties.length === 1 ? 'y' : 'ies'}</>}
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
        <Card title="Contact & preferences">
          <form action={updateClientAction} className="space-y-3">
            <input type="hidden" name="clientId" value={client.id} />
            <Field label="Name"><input name="name" defaultValue={client.name} required className={input} /></Field>
            <Field label="Phone"><input name="phone" defaultValue={phone(client.phone)} required className={input} /></Field>
            <Field label="Email (optional)"><input name="email" defaultValue={client.email ?? ''} className={input} /></Field>
            <fieldset>
              <legend className="mb-1 text-sm font-medium text-slate-700">Send service updates by</legend>
              <label className="mr-4 inline-flex items-center gap-2 text-sm"><input type="radio" name="notifyChannel" value="sms" defaultChecked={client.notify_channel === 'sms'} /> SMS</label>
              <label className="inline-flex items-center gap-2 text-sm"><input type="radio" name="notifyChannel" value="voice" defaultChecked={client.notify_channel === 'voice'} /> Automated voice call</label>
            </fieldset>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="optedOut" defaultChecked={client.opted_out} /> Opted out of all notifications
            </label>
            <button className={btn()}>Save</button>
          </form>
          <div className="mt-4 border-t border-slate-100 pt-4">
            <h3 className="mb-2 text-sm font-semibold text-slate-900">App sign-in</h3>
            {client.user_id ? (
              <p className="text-sm text-slate-700">Signed up as {client.login_email}{client.login_active === false ? ' (turned off)' : ''}. They can see their properties on the web and in the app.</p>
            ) : (
              <form action={createClientLoginAction} className="space-y-2">
                <input type="hidden" name="clientId" value={client.id} />
                <input type="hidden" name="fullName" value={client.name} />
                <p className="text-xs text-slate-500">Optional. The private status link works without a sign-in.</p>
                <input name="email" type="email" required placeholder="Sign-in email" defaultValue={client.email ?? ''} className={input} />
                {config().authMode === 'supabase' && (
                  <input name="password" type="text" required minLength={8} autoComplete="off" placeholder="Temporary password (8+ characters)" className={input} />
                )}
                <button className={btn('secondary', 'sm')}>Create sign-in</button>
              </form>
            )}
          </div>
          {preferences.length > 0 && (
            <details className="mt-4 text-sm">
              <summary className="cursor-pointer text-slate-600">Preference history ({preferences.length})</summary>
              <ul className="mt-2 space-y-1 text-slate-700">
                {preferences.map((p: any, i: number) => (
                  <li key={i}>{dt(p.created_at)} — {p.change}{p.full_name ? ` (${p.full_name})` : ''}</li>
                ))}
              </ul>
            </details>
          )}
        </Card>

        <div className="space-y-4 lg:col-span-2">
          {properties.map((p: any) => (
            <Card
              key={p.id}
              title={<span className={p.active ? '' : 'text-slate-400'}>{p.address}</span>}
              actions={p.active ? <Tag tone="success">Active</Tag> : <Tag>Inactive</Tag>}
            >
              <form action={savePropertyAction} className="grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="clientId" value={client.id} />
                <input type="hidden" name="propertyId" value={p.id} />
                <input type="hidden" name="active" value={p.active ? 'on' : 'off'} />
                <input type="hidden" name="origLat" value={String(p.lat)} />
                <input type="hidden" name="origLng" value={String(p.lng)} />
                <Field label="Address"><input name="address" defaultValue={p.address} className={input} /></Field>
                <Field label="Service time (minutes)"><input name="serviceMinutes" type="number" defaultValue={p.service_minutes} className={input} /></Field>
                <div className="sm:col-span-2">
                  <Field label="Driveway instructions"><textarea name="instructions" rows={2} defaultValue={p.instructions} className={input} /></Field>
                </div>
                <Field label="Latitude" hint={<>Location: {p.location_source === 'simulated' ? <Tag tone="warning">Simulated</Tag> : p.location_source}</>}>
                  <input name="lat" defaultValue={p.lat} className={input} />
                </Field>
                <Field label="Longitude"><input name="lng" defaultValue={p.lng} className={input} /></Field>
                <div className="flex flex-wrap gap-2 sm:col-span-2">
                  <button className={btn('secondary', 'sm')}>Save property</button>
                </div>
              </form>
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-sm">
                <form action={setPropertyActiveAction}>
                  <input type="hidden" name="clientId" value={client.id} />
                  <input type="hidden" name="propertyId" value={p.id} />
                  <input type="hidden" name="active" value={p.active ? 'false' : 'true'} />
                  <button className={btn('ghost', 'sm')}>{p.active ? 'Mark inactive' : 'Mark active'}</button>
                </form>
                <span className="text-slate-500">Status link: {p.has_status_link ? 'active' : 'none'}</span>
                <form action={createStatusLinkAction}>
                  <input type="hidden" name="clientId" value={client.id} />
                  <input type="hidden" name="propertyId" value={p.id} />
                  <button className={btn('secondary', 'sm')}>{p.has_status_link ? 'Replace link' : 'Create link'}</button>
                </form>
                {p.has_status_link && (
                  <form action={revokeStatusLinkAction}>
                    <input type="hidden" name="clientId" value={client.id} />
                    <input type="hidden" name="propertyId" value={p.id} />
                    <button className={btn('danger', 'sm')}>Revoke link</button>
                  </form>
                )}
              </div>
            </Card>
          ))}

          <Card title="Add another property">
            <form action={savePropertyAction} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="clientId" value={client.id} />
              <Field label="Address"><input name="address" required className={input} /></Field>
              <Field label="Service time (minutes)"><input name="serviceMinutes" type="number" defaultValue={15} className={input} /></Field>
              <div className="sm:col-span-2"><Field label="Driveway instructions"><textarea name="instructions" rows={2} className={input} /></Field></div>
              <div className="sm:col-span-2"><button className={btn('secondary')}>Add property</button></div>
            </form>
          </Card>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Visit history">
          {visits.length === 0 ? (
            <p className="text-sm text-slate-500">No visits yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {visits.map((v: any) => (
                <li key={v.id} className="py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Status status={v.status} />
                    {v.status === 'completed' && (v.photo_count > 0 ? <Tag tone="success">📷 Photo ({v.photo_count})</Tag> : <Tag>No photo</Tag>)}
                    <span className="text-slate-600">{day(v.service_date)} · {v.address} · {v.driver_name}</span>
                  </div>
                  {(v.block_reason || v.note) && <div className="text-slate-600">{v.block_reason}{v.note ? ` “${v.note}”` : ''}</div>}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Communications">
          <form action={sendMessageAction} className="mb-4 space-y-2">
            <input type="hidden" name="targetType" value="client" />
            <input type="hidden" name="clientId" value={client.id} />
            <input type="hidden" name="returnTo" value={`/admin/clients/${client.id}`} />
            <textarea name="body" required rows={2} maxLength={480} placeholder="Send an immediate message…" className={input} />
            <button className={btn('secondary', 'sm')} disabled={client.opted_out}>
              Send now by {client.notify_channel === 'sms' ? 'SMS' : 'voice call'}
            </button>
            {client.opted_out && <p className="text-xs text-rose-700">This client opted out. No messages are sent.</p>}
          </form>
          {communications.length === 0 ? (
            <p className="text-sm text-slate-500">No messages yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {communications.map((n: any) => (
                <li key={n.id} className="py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Status status={n.status} />
                    <SimTag simulated={n.simulated} />
                    <span className="text-slate-600">{n.channel === 'sms' ? 'SMS' : 'Voice'} · {n.kind} · {dt(n.sent_at ?? n.scheduled_at)}</span>
                  </div>
                  <p className="mt-1 text-slate-700">{n.body}</p>
                  {n.error && <p className="text-rose-700">{n.error}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
