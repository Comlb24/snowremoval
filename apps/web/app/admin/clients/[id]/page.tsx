import type React from 'react';
import { COMING_SOON } from '@/lib/features';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { config, getClient } from '@snow/server';
import { requirePageRole } from '@/lib/session';
import { CHANNEL_LABELS, equipmentText, localDate, type Channel } from '@snow/core';
import { btn, Card, Field, input, LinkButton, Notice, PageHeader, SimTag, Status, Tag } from '@/components/ui';
import { day, dt, money as fmtMoney, phone } from '@/lib/format';
import { createClientLoginAction, deletePaymentAction, recordPaymentAction, sendMessageAction, updateClientAction } from '../../actions';
import { Balance } from '../balance';

export default async function ClientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string; error?: string; edit?: string }> }) {
  const user = await requirePageRole('admin');
  const { id } = await params;
  const sp = await searchParams;
  const data = await getClient(user, id);
  if (!data) notFound();
  const { client, properties, payments, money, visits, communications, preferences, stats } = data;
  const activeCount = properties.filter((p: any) => p.active).length;
  const today = localDate(new Date().toISOString(), config().timeZone);

  return (
    <>
      <PageHeader
        title={client.name}
        sub={
          <span className="flex flex-wrap items-center gap-2">
            <Link href="/admin/clients" className="text-sky-700">← Clients</Link>
            <span>·</span>
            {client.opted_out ? <Tag tone="danger">Opted out</Tag> : <Tag tone="success">Getting updates</Tag>}
            {client.user_id ? <Tag tone="success">App sign-in{client.login_active === false ? ' (off)' : ''}</Tag> : <Tag>No app sign-in</Tag>}
            <span>Client since {day(client.created_at)}</span>
          </span>
        }
        actions={
<LinkButton href="?edit=1#edit" variant="secondary">Edit details</LinkButton>
        }
      />
      {sp.msg && <div className="mb-4"><Notice tone="success">{sp.msg}</Notice></div>}
      {sp.error && <div className="mb-4"><Notice tone="danger">{sp.error}</Notice></div>}

      <dl className="mb-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Active properties" value={activeCount} sub={properties.length > activeCount ? `+${properties.length - activeCount} inactive` : undefined} />
        <Stat label="Visits this season" value={stats.completed_season} sub={`Since ${day(stats.seasonStart)}`} />
        <Stat label="Last service" value={stats.last_completed_at ? day(stats.last_completed_at) : 'None yet'} />
        <Stat label="Blocked this season" value={stats.blocked_season} />
        <Stat label="Balance" value={<Balance amount={money.balance} />} />
      </dl>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Contact & preferences">
          <dl className="space-y-2 text-sm">
            <Row label="Phone">{client.phone ? <a href={`tel:${client.phone}`} className="text-sky-800 hover:underline">{phone(client.phone)}</a> : '—'}</Row>
            <Row label="Email">{client.email ? <a href={`mailto:${client.email}`} className="break-all text-sky-800 hover:underline">{client.email}</a> : '—'}</Row>
            <Row label="Updates by">{CHANNEL_LABELS[client.notify_channel as Channel]}</Row>
            <Row label="Notifications">{client.opted_out ? <span className="text-rose-700">Opted out{client.opted_out_at ? ` on ${day(client.opted_out_at)}` : ''}</span> : 'On'}</Row>
            <Row label="App sign-in">{client.user_id ? `${client.login_email}${client.login_active === false ? ' (turned off)' : ''}` : 'Not set up'}</Row>
          </dl>
          <details id="edit" open={sp.edit === '1'} className="group mt-4 border-t border-slate-100 pt-4">
            <summary className="cursor-pointer text-sm font-medium text-sky-800">Edit details</summary>
            <div className="mt-3">
              <form action={updateClientAction} className="space-y-3">
                <input type="hidden" name="clientId" value={client.id} />
                <Field label="Name"><input name="name" defaultValue={client.name} required className={input} /></Field>
                <Field label="Phone"><input name="phone" defaultValue={phone(client.phone)} required className={input} /></Field>
                <Field label="Email (optional)" hint="Needed if updates go by email."><input name="email" type="email" defaultValue={client.email ?? ''} className={input} /></Field>
                <fieldset>
                  <legend className="mb-1 text-sm font-medium text-slate-700">Send service updates by</legend>
                  <label className="mr-4 inline-flex items-center gap-2 text-sm"><input type="radio" name="notifyChannel" value="sms" defaultChecked={client.notify_channel === 'sms'} /> SMS</label>
                  <label className="mr-4 inline-flex items-center gap-2 text-sm"><input type="radio" name="notifyChannel" value="email" defaultChecked={client.notify_channel === 'email'} /> Email</label>
                  {/* A client already set to voice keeps the option, so saving the form never drops their choice. */}
                  {(() => {
                    const off = COMING_SOON.voiceCalls && client.notify_channel !== 'voice';
                    return (
                      <label className={`inline-flex items-center gap-2 text-sm ${off ? 'text-slate-400' : ''}`}><input type="radio" name="notifyChannel" value="voice" defaultChecked={client.notify_channel === 'voice'} disabled={off} /> Automated voice call{COMING_SOON.voiceCalls && ' (coming soon)'}</label>
                    );
                  })()}
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
            </div>
          </details>
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
          <Card title="Money" actions={<Balance amount={money.balance} />}>
            <dl className="mb-4 grid grid-cols-3 gap-3 text-sm">
              <div className="rounded-lg bg-slate-50 p-3"><dt className="text-slate-500">Quoted</dt><dd className="text-lg font-semibold tabular-nums">{fmtMoney(money.quotedTotal)}</dd></div>
              <div className="rounded-lg bg-slate-50 p-3"><dt className="text-slate-500">Paid</dt><dd className="text-lg font-semibold tabular-nums">{fmtMoney(money.paidTotal)}</dd></div>
              <div className="rounded-lg bg-slate-50 p-3"><dt className="text-slate-500">Balance</dt><dd className="text-lg font-semibold tabular-nums">{fmtMoney(money.balance)}</dd></div>
            </dl>
            <p className="mb-3 text-xs text-slate-500">Quoted is the total of this client’s active property quotes. Only admins see money.</p>
            <form action={recordPaymentAction} className="grid gap-2 sm:grid-cols-[8rem_10rem_1fr_auto] sm:items-end">
              <input type="hidden" name="clientId" value={client.id} />
              <Field label="Amount"><input name="amount" required inputMode="decimal" placeholder="250.00" className={input} /></Field>
              <Field label="Date paid"><input name="paidOn" type="date" required defaultValue={today} className={input} /></Field>
              <Field label="Note (optional)"><input name="note" maxLength={200} placeholder="e-transfer, cheque #…" className={input} /></Field>
              <button className={btn('secondary')}>Record payment</button>
            </form>
            {payments.length > 0 && (
              <ul className="mt-4 divide-y divide-slate-100 border-t border-slate-100 text-sm">
                {payments.map((pm: any) => (
                  <li key={pm.id} className="flex flex-wrap items-center gap-3 py-2">
                    <span className="w-24 font-medium tabular-nums">{fmtMoney(pm.amount)}</span>
                    <span className="text-slate-600">{day(pm.paid_on)}{pm.note ? ` · ${pm.note}` : ''}{pm.recorded_by ? ` · by ${pm.recorded_by}` : ''}</span>
                    <form action={deletePaymentAction} className="ml-auto">
                      <input type="hidden" name="clientId" value={client.id} />
                      <input type="hidden" name="paymentId" value={pm.id} />
                      <button className={btn('ghost', 'sm')} aria-label={`Remove payment of ${fmtMoney(pm.amount)}`}>Remove</button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={`Properties (${properties.length})`} actions={<LinkButton href={`/admin/properties/new?clientId=${client.id}`}>Add property</LinkButton>}>
            {properties.length === 0 ? (
              <p className="text-sm text-slate-500">No properties yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {properties.map((p: any) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-3 py-2">
                    <div className="flex-1">
                      <Link href={`/admin/properties/${p.id}`} className={`font-medium hover:underline ${p.active ? 'text-sky-800' : 'text-slate-400'}`}>{p.address}</Link>
                      {!p.active && <> <Tag>Inactive</Tag></>}
                      <div className="text-slate-500">{equipmentText(p.equipment) || 'Equipment not set'} · {p.service_minutes} min per visit · {p.has_status_link ? 'Tracking link on' : 'No tracking link'}</div>
                      {p.instructions && <div className="text-slate-600">Driver notes: {p.instructions}</div>}
                      {p.has_resident && (
                        <div className="text-xs text-sky-800">
                          Resident{p.resident_name ? ` ${p.resident_name}` : ''}{p.resident_phone ? ` · ${phone(p.resident_phone)}` : ''}{p.resident_email ? ` · ${p.resident_email}` : ''}. Updates go to them, not to this client.
                        </div>
                      )}
                      {p.office_notes && <div className="text-xs text-amber-800">Office note: {p.office_notes}</div>}
                    </div>
                    <span className="tabular-nums">{fmtMoney(p.quoted_amount)}</span>
                  </li>
                ))}
              </ul>
            )}
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
              Send now by {({ sms: 'SMS', email: 'email', voice: 'voice call' } as Record<string, string>)[client.notify_channel]}
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
                    <span className="text-slate-600">{CHANNEL_LABELS[n.channel as Channel]} · {n.kind} · {dt(n.sent_at ?? n.scheduled_at)}</span>
                  </div>
                  {n.subject && <p className="mt-1 font-medium text-slate-800">{n.subject}</p>}
                  <p className="mt-1 whitespace-pre-line text-slate-700">{n.body}</p>
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

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums text-slate-900">{value}</dd>
      {sub && <dd className="text-xs text-slate-500">{sub}</dd>}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-28 shrink-0 text-slate-500">{label}</dt>
      <dd className="min-w-0 text-slate-900">{children}</dd>
    </div>
  );
}
