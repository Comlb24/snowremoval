import {
  computeSchedule, emailMessage, planNotifications, smsMessage, voiceMessage,
  type Channel, type ExistingNotification, type PlannedNotification, type RouteStatus, type StopEstimate, type StopStatus,
} from '@snow/core';
import { iso, type Tx } from '../db';
import { config } from '../env';
import { getMessenger } from '../adapters/messaging';

export interface StopRow {
  id: string;
  route_id: string;
  property_id: string;
  position: number;
  drive_minutes: number;
  service_minutes: number;
  status: StopStatus;
  started_at: Date | null;
  finished_at: Date | null;
  address: string;
  property_active: boolean;
  client_id: string;
  client_name: string;
  notify_channel: Channel;
  opted_out: boolean;
  phone: string | null;
  email: string | null;
  /** Who the message is for: the resident when the property has one, otherwise the owner. */
  recipient_name: string;
  to_resident: boolean;
}

/** Where this client's updates go: their email for the email channel, otherwise their phone. */
export const contactFor = (s: { notify_channel: Channel; phone: string | null; email: string | null }) => (s.notify_channel === 'email' ? s.email : s.phone);

export interface RouteRow {
  id: string;
  status: RouteStatus;
  planned_start: Date;
  service_date: string;
  driver_id: string;
  travel_matrix: { ids: string[]; minutes: number[][] } | null;
  shift_started_at: Date | null;
}

/**
 * Who gets a property's service updates. A resident, when set, replaces the owner's channel and contact.
 * Needs the joins: clients c, client_contacts cc, property_residents pr.
 */
export const RECIPIENT_COLUMNS = `(pr.property_id is not null) as to_resident,
            case when pr.property_id is not null then pr.notify_channel else c.notify_channel end as notify_channel,
            case when pr.property_id is not null then pr.phone else cc.phone end as phone,
            case when pr.property_id is not null then pr.email else cc.email end as email,
            case when pr.property_id is not null then coalesce(nullif(pr.name, ''), 'there') else c.name end as recipient_name`;

export async function loadRouteForSchedule(tx: Tx, routeId: string, lock = false) {
  const [route] = await tx.query<RouteRow>(
    `select r.id, r.status, r.planned_start, r.service_date::text as service_date, r.driver_id, r.travel_matrix, sh.started_at as shift_started_at
       from routes r left join shifts sh on sh.route_id = r.id where r.id = $1 ${lock ? 'for update of r' : ''}`,
    [routeId],
  );
  if (!route) return null;
  const stops = await tx.query<StopRow>(
    `select s.id, s.route_id, s.property_id, s.position, s.drive_minutes, s.service_minutes, s.status, s.started_at, s.finished_at,
            p.address, p.active as property_active, c.id as client_id, c.name as client_name, c.opted_out,
            ${RECIPIENT_COLUMNS}
       from route_stops s
       join properties p on p.id = s.property_id
       join clients c on c.id = p.client_id
       left join client_contacts cc on cc.client_id = c.id
       left join property_residents pr on pr.property_id = p.id
      where s.route_id = $1 order by s.position`,
    [routeId],
  );
  return { route, stops };
}

export function estimatesFor(route: RouteRow, stops: StopRow[], now: Date): StopEstimate[] {
  return computeSchedule({
    plannedStart: new Date(route.planned_start),
    now: route.status === 'draft' ? undefined : now,
    shiftStartedAt: iso(route.shift_started_at),
    stops: stops.map((s) => ({
      id: s.id,
      driveMinutes: Number(s.drive_minutes),
      serviceMinutes: s.service_minutes,
      status: s.status,
      startedAt: iso(s.started_at),
      finishedAt: iso(s.finished_at),
    })),
  });
}

async function loadExisting(tx: Tx, routeId: string): Promise<ExistingNotification[]> {
  const rows = await tx.query(
    `select id, route_stop_id, kind, status, window_start, window_end, scheduled_at, sent_at, channel, to_address
       from notifications where route_id = $1 and kind <> 'manual'`,
    [routeId],
  );
  return rows.map((n: any) => ({
    id: n.id, stopId: n.route_stop_id, kind: n.kind, status: n.status,
    windowStart: iso(n.window_start), windowEnd: iso(n.window_end), scheduledAt: iso(n.scheduled_at)!, sentAt: iso(n.sent_at),
    channel: n.channel, to: n.to_address,
  }));
}

function plannerStops(stops: StopRow[], est: StopEstimate[]) {
  return stops.map((s, i) => ({
    stopId: s.id,
    status: s.status,
    estimate: est[i],
    eligible: !s.opted_out && s.property_active && !!contactFor(s),
    channel: s.notify_channel,
    to: contactFor(s),
  }));
}

export function renderMessage(kind: 'initial' | 'update', channel: Channel, stop: Pick<StopRow, 'recipient_name' | 'address'>, window: { start: string; end: string }): { body: string; subject: string | null } {
  const c = config();
  const input = { name: stop.recipient_name, address: stop.address, window, businessName: c.businessName, timeZone: c.timeZone };
  if (channel === 'email') return emailMessage(input, kind === 'update');
  return { body: channel === 'voice' ? voiceMessage(input, kind === 'update') : smsMessage(input, kind === 'update'), subject: null };
}

export const renderBody = (...a: Parameters<typeof renderMessage>) => renderMessage(...a).body;

/**
 * Recalculate a route's estimates and bring its scheduled notifications up to date.
 * Safe to call any number of times (idempotent). Runs inside the caller's transaction.
 */
export async function recomputeRoute(tx: Tx, routeId: string, now = new Date()) {
  const data = await loadRouteForSchedule(tx, routeId, true);
  if (!data) return { created: 0, cancelled: 0 };
  const { route, stops } = data;
  const est = estimatesFor(route, stops, now);
  const existing = await loadExisting(tx, routeId);
  const auto = config().autoMessages;
  const plan = auto
    ? planNotifications({ routeStatus: route.status, stops: plannerStops(stops, est), existing, now })
    : { create: [], suppressed: [], cancel: existing.filter((n) => n.status === 'scheduled').map((n) => ({ id: n.id, reason: 'Automatic messages are turned off' })) };

  for (const c of plan.cancel) {
    await tx.query(`update notifications set status = 'cancelled', cancel_reason = $2, updated_at = now() where id = $1 and status = 'scheduled'`, [c.id, c.reason]);
  }
  let created = 0;
  for (const p of plan.create) {
    const stop = stops.find((s) => s.id === p.stopId)!;
    const messenger = getMessenger(p.channel);
    const msg = renderMessage(p.kind, p.channel, stop, p.window);
    const rows = await tx.query(
      `insert into notifications (client_id, property_id, route_id, route_stop_id, kind, channel, to_address, body, subject, window_start, window_end,
                                  scheduled_at, status, simulated, provider, dedupe_key)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'scheduled', $13, $14, $15)
       on conflict (dedupe_key) where dedupe_key is not null and status <> 'cancelled' do nothing
       returning id`,
      [stop.client_id, stop.property_id, routeId, stop.id, p.kind, p.channel, contactFor(stop), msg.body, msg.subject,
       p.window.start, p.window.end, p.scheduledAt.toISOString(), messenger.simulated, messenger.name, p.dedupeKey],
    );
    created += rows.length;
  }

  // Public window per stop: keep the window the client was told while the estimate is still inside it.
  const communicated = existing.filter((n) => ['sending', 'sent', 'delivered'].includes(n.status) && n.windowStart);
  for (let i = 0; i < stops.length; i++) {
    const e = est[i];
    const last = communicated.filter((n) => n.stopId === stops[i].id).sort((a, b) => (a.sentAt ?? a.scheduledAt).localeCompare(b.sentAt ?? b.scheduledAt)).pop();
    let window = e.window;
    if (e.arrival && last && e.arrival.getTime() >= Date.parse(last.windowStart!) && e.arrival.getTime() <= Date.parse(last.windowEnd!)) {
      window = { start: last.windowStart!, end: last.windowEnd! };
    }
    await tx.query(`update route_stops set est_arrival = $2, window_start = $3, window_end = $4 where id = $1`, [
      stops[i].id, e.arrival?.toISOString() ?? null, window?.start ?? null, window?.end ?? null,
    ]);
  }
  return { created, cancelled: plan.cancel.length, suppressed: plan.suppressed };
}

/** What would be sent if the route were published now (dry run, writes nothing). */
export async function previewNotifications(tx: Tx, routeId: string, now = new Date()) {
  const data = await loadRouteForSchedule(tx, routeId);
  if (!data) return null;
  const { route, stops } = data;
  const live = route.status === 'draft' ? { ...route, status: 'published' as RouteStatus } : route;
  const est = estimatesFor(live, stops, now);
  const existing = await loadExisting(tx, routeId);
  const plan = config().autoMessages ? planNotifications({ routeStatus: live.status, stops: plannerStops(stops, est), existing, now }) : { create: [] as PlannedNotification[] };
  const byStop = new Map<string, PlannedNotification>(plan.create.map((p) => [p.stopId, p]));
  return stops.map((s, i) => ({
    stopId: s.id,
    address: s.address,
    clientName: s.client_name,
    channel: s.notify_channel,
    toResident: s.to_resident,
    eligible: !s.opted_out && s.property_active && !!contactFor(s),
    optedOut: s.opted_out,
    status: s.status,
    arrival: est[i].arrival?.toISOString() ?? null,
    window: est[i].window,
    planned: byStop.get(s.id) ? { scheduledAt: byStop.get(s.id)!.scheduledAt.toISOString(), immediate: byStop.get(s.id)!.immediate, kind: byStop.get(s.id)!.kind } : null,
  }));
}
