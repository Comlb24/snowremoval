import Link from 'next/link';
import { CHANNEL_LABELS, type Channel } from '@snow/core';
import { config, listClients, listCommunications, listRoutes } from '@snow/server';
import { requirePageRole } from '@/lib/session';
import { btn, Card, Empty, Field, input, Notice, PageHeader, SimTag, Status } from '@/components/ui';
import { day, dt, phone, win } from '@/lib/format';
import { runSchedulerAction, sendMessageAction } from '../actions';

const FILTERS = [
  { key: '', label: 'All' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'sent', label: 'Sent' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'failed', label: 'Failed' },
  { key: 'cancelled', label: 'Cancelled' },
];

export default async function CommunicationsPage({ searchParams }: { searchParams: Promise<{ status?: string; msg?: string; error?: string }> }) {
  const user = await requirePageRole('admin');
  const sp = await searchParams;
  const [rows, clients, routes] = await Promise.all([
    listCommunications(user, { status: sp.status || undefined }),
    listClients(user),
    listRoutes(user),
  ]);
  const live = config().messagingMode === 'live';
  return (
    <>
      <PageHeader
        title="Communications"
        sub={live ? 'Live mode: messages are sent through Twilio.' : 'Development: every message is simulated and nothing is sent.'}
        actions={!live && <form action={runSchedulerAction}><button className={btn('secondary')}>Run scheduler now</button></form>}
      />
      {sp.msg && <div className="mb-4"><Notice tone="success">{sp.msg}</Notice></div>}
      {sp.error && <div className="mb-4"><Notice tone="danger">{sp.error}</Notice></div>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <nav className="mb-3 flex flex-wrap gap-1 text-sm">
            {FILTERS.map((f) => (
              <Link key={f.key} href={f.key ? `/admin/communications?status=${f.key}` : '/admin/communications'}
                className={`rounded-md px-3 py-1 ${(sp.status ?? '') === f.key ? 'bg-sky-100 font-medium text-sky-900' : 'text-slate-700 hover:bg-slate-100'}`}>{f.label}</Link>
            ))}
          </nav>
          {rows.length === 0 ? (
            <Empty>No messages.</Empty>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {rows.map((n: any) => (
                <li key={n.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Status status={n.status} />
                    <SimTag simulated={n.simulated} />
                    <Link href={`/admin/clients/${n.client_id}`} className="font-medium hover:underline">{n.client_name}</Link>
                    <span className="text-slate-500 tabular-nums">{n.channel === 'email' ? n.to_address : phone(n.to_address)}</span>
                    <span className="text-slate-500">{CHANNEL_LABELS[n.channel as Channel]} · {n.dedupe_key?.startsWith('on_my_way:') ? 'driver on the way' : n.kind === 'manual' ? 'manual message' : n.kind === 'update' ? 'updated window' : 'service window'}</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-600">
                    {n.status === 'scheduled' ? `Due ${dt(n.scheduled_at)}` : n.sent_at ? `Sent ${dt(n.sent_at)}` : `Was due ${dt(n.scheduled_at)} (not sent)`}
                    {n.window_start && ` · window ${win(n.window_start, n.window_end)}`}
                    {n.service_date && <> · <Link className="underline" href={`/admin/routes/${n.route_id}`}>route {day(n.service_date)}</Link></>}
                    {n.provider_ref && ` · ref ${n.provider_ref.slice(0, 18)}`}
                  </div>
                  {n.subject && <p className="mt-1 font-medium text-slate-800">{n.subject}</p>}
                  <p className="mt-1 whitespace-pre-line text-slate-800">{n.body}</p>
                  {n.error && <p className="mt-1 text-rose-700">✕ {n.error}</p>}
                  {n.cancel_reason && <p className="mt-1 text-xs text-slate-500">Cancelled: {n.cancel_reason}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Send an immediate message">
          <form action={sendMessageAction} className="space-y-3">
            <fieldset className="space-y-2 text-sm">
              <label className="flex items-center gap-2"><input type="radio" name="targetType" value="client" defaultChecked /> One client</label>
              <select name="clientId" className={input}>
                {clients.map((c: any) => <option key={c.id} value={c.id}>{c.name}{c.opted_out ? ' (opted out)' : ''}</option>)}
              </select>
              <label className="flex items-center gap-2"><input type="radio" name="targetType" value="route" /> Everyone on a route</label>
              <select name="routeId" className={input}>
                {routes.filter((r: any) => !['draft', 'cancelled'].includes(r.status)).map((r: any) => <option key={r.id} value={r.id}>{day(r.service_date)} · {r.driver_name}</option>)}
              </select>
            </fieldset>
            <Field label="Message" hint="Sent by each client's chosen method. Opted-out clients are skipped.">
              <textarea name="body" required rows={4} maxLength={480} className={input} defaultValue="Due to heavy snowfall, service is running later than planned today. Arrival times are approximate." />
            </Field>
            <button className={btn()}>Send now</button>
          </form>
        </Card>
      </div>
    </>
  );
}
