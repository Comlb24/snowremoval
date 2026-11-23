import Link from 'next/link';
import { CHANNEL_LABELS, type Channel } from '@snow/core';
import { notFound } from 'next/navigation';
import { config, driverOptions, getRouteDetail, getRoutePreview, listActiveProperties } from '@snow/server';
import { localTime } from '@snow/core';
import { requirePageRole } from '@/lib/session';
import { btn, Card, Field, input, Notice, PageHeader, Progress, SimTag, Status, Tag } from '@/components/ui';
import { day, dt, t, win } from '@/lib/format';
import { routeCommandAction, sendMessageAction } from '../../actions';

function Cmd({ routeId, cmd, stopId, children, variant = 'secondary', confirm }: { routeId: string; cmd: string; stopId?: string; children: React.ReactNode; variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; confirm?: string }) {
  return (
    <form action={routeCommandAction} className="inline">
      <input type="hidden" name="routeId" value={routeId} />
      <input type="hidden" name="cmd" value={cmd} />
      {stopId && <input type="hidden" name="stopId" value={stopId} />}
      <button className={btn(variant, 'sm')} title={confirm} aria-label={typeof children === 'string' ? children : cmd}>{children}</button>
    </form>
  );
}

export default async function RoutePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string; error?: string }> }) {
  const user = await requirePageRole('admin');
  const { id } = await params;
  const sp = await searchParams;
  const data = await getRouteDetail(user, id);
  if (!data) notFound();
  const { route, stops, notifications } = data;
  const [preview, drivers, allProps] = await Promise.all([route.status === 'draft' ? getRoutePreview(user, id) : null, driverOptions(user), listActiveProperties(user)]);
  const active = stops.filter((s: any) => s.status !== 'removed');
  const editable = !['completed', 'cancelled'].includes(route.status);
  const done = active.filter((s: any) => ['completed', 'blocked'].includes(s.status)).length;
  const onRoute = new Set(active.map((s: any) => s.property_id));
  const addable = allProps.filter((p: any) => !onRoute.has(p.id));
  const notifByStop = new Map<string, any[]>();
  for (const n of notifications) if (n.route_stop_id) notifByStop.set(n.route_stop_id, [...(notifByStop.get(n.route_stop_id) ?? []), n]);
  const previewByStop = new Map((preview ?? []).map((p: any) => [p.stopId, p]));
  const lateCount = (preview ?? []).filter((p: any) => p.planned?.immediate).length;

  return (
    <>
      <PageHeader
        title={`${day(route.service_date)} · ${route.driver_name}`}
        sub={<><Link href="/admin/routes" className="text-sky-700">← Routes</Link> · Planned start {t(route.planned_start)} from {route.start_address} {route.matrix_simulated && <Tag tone="warning">Simulated travel times</Tag>}</>}
        actions={
          <>
            <Status status={route.status} />
            {route.status === 'draft' && <Cmd routeId={id} cmd="publish" variant="primary">Publish to driver</Cmd>}
            {['published', 'in_progress'].includes(route.status) && <Cmd routeId={id} cmd="pause">Pause messages</Cmd>}
            {route.status === 'paused' && <Cmd routeId={id} cmd="resume" variant="primary">Resume</Cmd>}
            {editable && <Cmd routeId={id} cmd="cancel" variant="danger">Cancel route</Cmd>}
          </>
        }
      />
      {sp.msg && <div className="mb-4"><Notice tone="success">{sp.msg}</Notice></div>}
      {sp.error && <div className="mb-4"><Notice tone="danger">{sp.error}</Notice></div>}
      {route.status === 'paused' && <div className="mb-4"><Notice tone="warning">This route is paused. No automatic messages are sent until you resume it.</Notice></div>}
      {route.status === 'draft' && (
        <div className="mb-4">
          <Notice tone="info">
            Draft — the driver cannot see it and no messages are scheduled. Check the order and the message schedule below, then publish.
            {lateCount > 0 && <strong> {lateCount} client(s) would be messaged immediately because their normal message time has passed.</strong>}
          </Notice>
        </div>
      )}

      <Card className="mb-4">
        <div className="mb-2 flex flex-wrap items-center gap-4 text-sm text-slate-700">
          <span>Shift: {route.shift_started_at ? `started ${t(route.shift_started_at)}` : 'not started'}{route.shift_ended_at ? `, finished ${t(route.shift_ended_at)}` : ''}</span>
          <span>{active.filter((s: any) => s.status === 'completed').length} completed · {active.filter((s: any) => s.status === 'blocked').length} blocked</span>
        </div>
        <Progress done={done} total={active.length} />
      </Card>

      <Card
        title="Stops"
        actions={editable && active.some((s: any) => s.status === 'pending') ? <Cmd routeId={id} cmd="resuggest">Re-suggest order</Cmd> : null}
        className="mb-4"
      >
        <p className="mb-3 text-xs text-slate-500">Arrival = planned start + driving time + service time at earlier stops. Windows are two hours, centred on the estimate. Clients get a message one hour before their window. All times are estimates.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr><th className="py-2 pr-2">#</th><th className="py-2 pr-3">Property</th><th className="py-2 pr-3">Status</th><th className="py-2 pr-3">Est. arrival</th><th className="py-2 pr-3">Window (estimate)</th><th className="py-2 pr-3">Client message</th><th className="py-2">Order</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {active.map((s: any, i: number) => {
                const pv: any = previewByStop.get(s.id);
                const ns = (notifByStop.get(s.id) ?? []).filter((n) => n.status !== 'cancelled');
                const last = ns[ns.length - 1];
                return (
                  <tr key={s.id} className="align-top">
                    <td className="py-2 pr-2 tabular-nums text-slate-500">{i + 1}</td>
                    <td className="py-2 pr-3">
                      <Link href={`/admin/properties/${s.property_id}`} className="font-medium hover:underline">{s.address}</Link>
                      <div className="text-xs text-slate-500">{s.client_name} · {s.service_minutes} min · {Math.round(s.drive_minutes)} min drive {s.notify_channel !== 'sms' && `· ${s.notify_channel === 'email' ? 'email' : 'voice call'}`}{s.to_resident && ' · to resident'}</div>
                      {s.status === 'blocked' && <div className="text-xs text-amber-800">! {s.block_reason ?? 'Blocked'}{s.note ? ` — “${s.note}”` : ''}</div>}
                      {s.status === 'completed' && <div className="text-xs">{s.photo_count > 0 ? <Tag tone="success">📷 Photo evidence</Tag> : <Tag>Completed — no photo</Tag>}</div>}
                    </td>
                    <td className="py-2 pr-3"><Status status={s.status} /></td>
                    <td className="py-2 pr-3 tabular-nums">{['completed', 'blocked'].includes(s.status) ? `Done ${t(s.finished_at)}` : t(s.est_arrival)}</td>
                    <td className="py-2 pr-3 tabular-nums">{s.status === 'pending' ? win(s.window_start, s.window_end) : '—'}</td>
                    <td className="py-2 pr-3 text-xs">
                      {s.opted_out ? <Tag tone="danger">Opted out</Tag>
                        : route.status === 'draft' ? (pv?.planned ? (pv.planned.immediate ? <Tag tone="warning">Immediately on publish</Tag> : <>At {t(pv.planned.scheduledAt)}</>) : '—')
                        : last ? <><Status status={last.status} /> {last.status === 'scheduled' ? t(last.scheduled_at) : t(last.sent_at)} {last.kind === 'update' && <Tag>update</Tag>}</> : '—'}
                    </td>
                    <td className="py-2 whitespace-nowrap">
                      {editable && s.status === 'pending' && (
                        <>
                          <Cmd routeId={id} cmd="up" stopId={s.id} variant="ghost">↑</Cmd>
                          <Cmd routeId={id} cmd="down" stopId={s.id} variant="ghost">↓</Cmd>
                          <Cmd routeId={id} cmd="remove" stopId={s.id} variant="ghost">Remove</Cmd>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {editable && (
          <Card title="Change route">
            <form action={routeCommandAction} className="grid grid-cols-2 gap-3">
              <input type="hidden" name="routeId" value={id} />
              <input type="hidden" name="cmd" value="details" />
              <Field label="Date"><input type="date" name="serviceDate" defaultValue={route.service_date} className={input} /></Field>
              <Field label="Start time"><input type="time" name="plannedStartTime" defaultValue={localTime(route.planned_start, config().timeZone)} className={input} /></Field>
              <div className="col-span-2">
                <Field label="Driver">
                  <select name="driverId" defaultValue={route.driver_id} className={input}>
                    {drivers.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
                  </select>
                </Field>
              </div>
              <div className="col-span-2"><button className={btn('secondary', 'sm')}>Save and recalculate</button></div>
            </form>
            {addable.length > 0 && (
              <form action={routeCommandAction} className="mt-4 border-t border-slate-100 pt-4">
                <input type="hidden" name="routeId" value={id} />
                <input type="hidden" name="cmd" value="add" />
                <Field label="Add properties">
                  <select name="propertyIds" multiple size={Math.min(6, addable.length)} className={input}>
                    {addable.map((p: any) => <option key={p.id} value={p.id}>{p.address} · {p.client_name}</option>)}
                  </select>
                </Field>
                <button className={`${btn('secondary', 'sm')} mt-2`}>Add to end</button>
              </form>
            )}
          </Card>
        )}

        <Card title="Messages for this route">
          {route.status !== 'draft' && (
            <form action={sendMessageAction} className="mb-4 space-y-2">
              <input type="hidden" name="targetType" value="route" />
              <input type="hidden" name="routeId" value={id} />
              <input type="hidden" name="returnTo" value={`/admin/routes/${id}`} />
              <textarea name="body" required rows={2} maxLength={480} placeholder="Immediate message to every client on this route…" className={input} />
              <button className={btn('secondary', 'sm')}>Send now to route</button>
            </form>
          )}
          {notifications.length === 0 ? (
            <p className="text-sm text-slate-500">{route.status === 'draft' ? 'Messages are scheduled when you publish.' : 'None yet.'}</p>
          ) : (
            <ul className="max-h-96 divide-y divide-slate-100 overflow-auto text-sm">
              {[...notifications].reverse().map((n: any) => (
                <li key={n.id} className="py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Status status={n.status} />
                    <SimTag simulated={n.simulated} />
                    <span>{n.client_name}</span>
                    <span className="text-slate-500">{n.kind} · {CHANNEL_LABELS[n.channel as Channel]} · {n.status === 'scheduled' ? `due ${dt(n.scheduled_at)}` : dt(n.sent_at ?? n.scheduled_at)}</span>
                  </div>
                  {n.window_start && <div className="text-xs text-slate-600">Window {win(n.window_start, n.window_end)}</div>}
                  {n.error && <div className="text-xs text-rose-700">{n.error}</div>}
                  {n.cancel_reason && <div className="text-xs text-slate-500">{n.cancel_reason}</div>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
