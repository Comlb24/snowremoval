import { routeDraftSchema, suggestOrder, zonedToUtc, type RouteDraftInput } from '@snow/core';
import { asSystem, asUser, type SessionUser, type Tx } from '../db';
import { config } from '../env';
import { requireRole } from '../auth';
import { getRouting } from '../adapters/routing';
import { recomputeRoute, previewNotifications } from './schedule';

const ids = (v: string[]) => JSON.stringify(v);
// JSON is sent as text and cast in SQL: postgres.js would otherwise JSON-encode a jsonb parameter a second time.
const IN_IDS = (n: number) => `(select (jsonb_array_elements_text($${n}::text::jsonb))::uuid)`;

interface Matrix {
  ids: string[];
  minutes: number[][];
}

async function buildMatrix(start: { lat: number; lng: number }, props: { id: string; lat: number; lng: number }[]) {
  const routing = getRouting();
  const minutes = await routing.matrix([start, ...props.map((p) => ({ lat: p.lat, lng: p.lng }))]);
  return { matrix: { ids: ['start', ...props.map((p) => p.id)], minutes } as Matrix, simulated: routing.simulated };
}

/** Write drive minutes and positions from the cached matrix for a given order of stop ids. */
async function applyOrder(tx: Tx, routeId: string, orderedStopIds: string[]) {
  const [route] = await tx.query<{ travel_matrix: Matrix }>('select travel_matrix from routes where id = $1', [routeId]);
  const stops = await tx.query<{ id: string; property_id: string; status: string }>('select id, property_id, status from route_stops where route_id = $1', [routeId]);
  const m = route.travel_matrix;
  const idx = (key: string) => m.ids.indexOf(key);
  const active = orderedStopIds.map((id) => stops.find((s) => s.id === id)).filter((s): s is NonNullable<typeof s> => !!s && s.status !== 'removed');
  const removed = stops.filter((s) => s.status === 'removed');
  let prev = idx('start');
  let pos = 1;
  for (const s of active) {
    const cur = idx(s.property_id);
    const drive = prev >= 0 && cur >= 0 ? m.minutes[prev][cur] : 0;
    await tx.query('update route_stops set position = $2, drive_minutes = $3, updated_at = now() where id = $1', [s.id, pos++, drive]);
    prev = cur;
  }
  for (const s of removed) await tx.query('update route_stops set position = $2, drive_minutes = 0 where id = $1', [s.id, pos++]);
}

async function recompute(routeId: string) {
  return asSystem((tx) => recomputeRoute(tx, routeId));
}

/** Create a draft route with a suggested efficient stop order. */
export async function createDraftRoute(user: SessionUser, raw: RouteDraftInput) {
  requireRole(user, 'admin');
  const input = routeDraftSchema.parse(raw);
  const c = config();
  const props = await asUser(user, (tx) =>
    tx.query<{ id: string; lat: number; lng: number; service_minutes: number; address: string }>(
      `select id, lat, lng, service_minutes, address from properties where active and id in ${IN_IDS(1)}`,
      [ids(input.propertyIds)],
    ),
  );
  if (props.length !== new Set(input.propertyIds).size) throw new Error('Some properties are inactive or missing');
  const start = { lat: input.startLat, lng: input.startLng };
  const { matrix, simulated } = await buildMatrix(start, props);
  const order = suggestOrder(matrix.minutes).map((i) => props[i - 1]);
  const plannedStart = zonedToUtc(input.serviceDate, input.plannedStartTime, c.timeZone);

  const routeId = await asUser(user, async (tx) => {
    const [r] = await tx.query<{ id: string }>(
      `insert into routes (service_date, driver_id, planned_start, start_address, start_lat, start_lng, travel_matrix, matrix_simulated, created_by, name)
       values ($1, $2, $3, $4, $5, $6, $7::text::jsonb, $8, $9, $10) returning id`,
      [input.serviceDate, input.driverId, plannedStart.toISOString(), input.startAddress, input.startLat, input.startLng, JSON.stringify(matrix), simulated, user.id, ''],
    );
    let prev = 0;
    for (let i = 0; i < order.length; i++) {
      const cur = matrix.ids.indexOf(order[i].id);
      await tx.query(
        `insert into route_stops (route_id, property_id, position, drive_minutes, service_minutes) values ($1, $2, $3, $4, $5)`,
        [r.id, order[i].id, i + 1, matrix.minutes[prev][cur], order[i].service_minutes],
      );
      prev = cur;
    }
    return r.id;
  });
  await recompute(routeId);
  return routeId;
}

async function assertEditable(tx: Tx, routeId: string) {
  const [r] = await tx.query<{ status: string }>('select status from routes where id = $1', [routeId]);
  if (!r) throw new Error('Route not found');
  if (r.status === 'completed' || r.status === 'cancelled') throw new Error(`This route is ${r.status} and cannot be changed`);
}

/** Manual reorder. Estimates and the notification plan are recalculated right after. */
export async function reorderStops(user: SessionUser, routeId: string, orderedStopIds: string[]) {
  requireRole(user, 'admin');
  await asUser(user, async (tx) => {
    await assertEditable(tx, routeId);
    await applyOrder(tx, routeId, orderedStopIds);
  });
  return recompute(routeId);
}

export async function moveStop(user: SessionUser, routeId: string, stopId: string, direction: 'up' | 'down') {
  const stops = await asUser(user, (tx) => tx.query<{ id: string }>(`select id from route_stops where route_id = $1 and status <> 'removed' order by position`, [routeId]));
  const order = stops.map((s) => s.id);
  const i = order.indexOf(stopId);
  const j = direction === 'up' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= order.length) return null;
  [order[i], order[j]] = [order[j], order[i]];
  return reorderStops(user, routeId, order);
}

/** Re-run the suggested order for stops not yet started. */
export async function resuggestOrder(user: SessionUser, routeId: string) {
  requireRole(user, 'admin');
  const { stops, matrix } = await asUser(user, async (tx) => {
    await assertEditable(tx, routeId);
    const [r] = await tx.query<{ travel_matrix: Matrix }>('select travel_matrix from routes where id = $1', [routeId]);
    const s = await tx.query<{ id: string; property_id: string; status: string }>(`select id, property_id, status from route_stops where route_id = $1 and status <> 'removed' order by position`, [routeId]);
    return { stops: s, matrix: r.travel_matrix };
  });
  const fixed = stops.filter((s) => s.status !== 'pending');
  const open = stops.filter((s) => s.status === 'pending');
  const fromKey = fixed.length ? fixed[fixed.length - 1].property_id : 'start';
  const keys = [fromKey, ...open.map((s) => s.property_id)].map((k) => matrix.ids.indexOf(k));
  const sub = keys.map((a) => keys.map((b) => matrix.minutes[a][b]));
  const order = suggestOrder(sub).map((i) => open[i - 1].id);
  return reorderStops(user, routeId, [...fixed.map((s) => s.id), ...order]);
}

export async function removeStop(user: SessionUser, routeId: string, stopId: string) {
  requireRole(user, 'admin');
  await asUser(user, async (tx) => {
    await assertEditable(tx, routeId);
    const [s] = await tx.query<{ status: string }>('select status from route_stops where id = $1 and route_id = $2', [stopId, routeId]);
    if (!s) throw new Error('Stop not found');
    if (s.status !== 'pending') throw new Error('Only stops that have not started can be removed');
    await tx.query(`update route_stops set status = 'removed', updated_at = now() where id = $1`, [stopId]);
    const rest = await tx.query<{ id: string }>(`select id from route_stops where route_id = $1 and status <> 'removed' order by position`, [routeId]);
    await applyOrder(tx, routeId, rest.map((r) => r.id));
  });
  return recompute(routeId);
}

/** Add properties to an existing route (appended at the end; travel times re-fetched). */
export async function addStops(user: SessionUser, routeId: string, propertyIds: string[]) {
  requireRole(user, 'admin');
  const data = await asUser(user, async (tx) => {
    await assertEditable(tx, routeId);
    const [r] = await tx.query<any>('select start_lat, start_lng from routes where id = $1', [routeId]);
    const existing = await tx.query<any>(`select s.id, s.property_id, s.status, p.lat, p.lng from route_stops s join properties p on p.id = s.property_id where s.route_id = $1 order by s.position`, [routeId]);
    const fresh = await tx.query<any>(`select id, lat, lng, service_minutes from properties where active and id in ${IN_IDS(1)}`, [ids(propertyIds)]);
    return { r, existing, fresh };
  });
  const newOnes = data.fresh.filter((p: any) => !data.existing.some((e: any) => e.property_id === p.id && e.status !== 'removed'));
  const all = [...data.existing.map((e: any) => ({ id: e.property_id, lat: e.lat, lng: e.lng })), ...newOnes.filter((p: any) => !data.existing.some((e: any) => e.property_id === p.id))];
  const { matrix, simulated } = await buildMatrix({ lat: data.r.start_lat, lng: data.r.start_lng }, all);
  await asUser(user, async (tx) => {
    await tx.query('update routes set travel_matrix = $2::text::jsonb, matrix_simulated = $3, updated_at = now() where id = $1', [routeId, JSON.stringify(matrix), simulated]);
    for (const p of newOnes) {
      await tx.query(
        `insert into route_stops (route_id, property_id, position, service_minutes) values ($1, $2, 9999, $3)
         on conflict (route_id, property_id) do update set status = 'pending', started_at = null, finished_at = null`,
        [routeId, p.id, p.service_minutes],
      );
    }
    const rest = await tx.query<{ id: string }>(`select id from route_stops where route_id = $1 and status <> 'removed' order by position`, [routeId]);
    await applyOrder(tx, routeId, rest.map((r) => r.id));
  });
  return recompute(routeId);
}

export async function updateRouteDetails(user: SessionUser, routeId: string, patch: { serviceDate: string; plannedStartTime: string; driverId: string }) {
  requireRole(user, 'admin');
  const plannedStart = zonedToUtc(patch.serviceDate, patch.plannedStartTime, config().timeZone);
  await asUser(user, async (tx) => {
    await assertEditable(tx, routeId);
    await tx.query('update routes set service_date = $2, planned_start = $3, driver_id = $4, updated_at = now() where id = $1', [routeId, patch.serviceDate, plannedStart.toISOString(), patch.driverId]);
  });
  return recompute(routeId);
}

export type RouteAction = 'publish' | 'pause' | 'resume' | 'cancel';

/** Publish, pause, resume or cancel. Pausing or cancelling immediately stops pending messages. */
export async function setRouteStatus(user: SessionUser, routeId: string, action: RouteAction) {
  requireRole(user, 'admin');
  await asUser(user, async (tx) => {
    const [r] = await tx.query<{ status: string; shift: string | null }>('select r.status, sh.id as shift from routes r left join shifts sh on sh.route_id = r.id where r.id = $1', [routeId]);
    if (!r) throw new Error('Route not found');
    const allowed: Record<RouteAction, string[]> = {
      publish: ['draft'],
      pause: ['published', 'in_progress'],
      resume: ['paused'],
      cancel: ['draft', 'published', 'in_progress', 'paused'],
    };
    if (!allowed[action].includes(r.status)) throw new Error(`Cannot ${action} a route that is ${r.status.replace('_', ' ')}`);
    const next = action === 'publish' ? 'published' : action === 'pause' ? 'paused' : action === 'resume' ? (r.shift ? 'in_progress' : 'published') : 'cancelled';
    await tx.query(`update routes set status = $2, published_at = case when $2 = 'published' then coalesce(published_at, now()) else published_at end, updated_at = now() where id = $1`, [routeId, next]);
  });
  return recompute(routeId);
}

export async function listRoutes(user: SessionUser, opts: { from?: string; to?: string } = {}) {
  requireRole(user, 'admin');
  return asUser(user, (tx) =>
    tx.query<any>(
      `select r.id, r.service_date::text as service_date, r.planned_start, r.status, r.start_address, r.matrix_simulated, p.full_name as driver_name, r.driver_id,
              count(s.id) filter (where s.status <> 'removed')::int as stop_count,
              count(s.id) filter (where s.status = 'completed')::int as completed_count,
              count(s.id) filter (where s.status = 'blocked')::int as blocked_count,
              (select count(*)::int from notifications n where n.route_id = r.id and n.status = 'failed') as failed_count
         from routes r join profiles p on p.id = r.driver_id left join route_stops s on s.route_id = r.id
        where ($1::date is null or r.service_date >= $1::date) and ($2::date is null or r.service_date <= $2::date)
        group by r.id, p.full_name order by r.service_date desc, r.planned_start desc limit 200`,
      [opts.from ?? null, opts.to ?? null],
    ),
  );
}

export async function getRouteDetail(user: SessionUser, routeId: string) {
  requireRole(user, 'admin');
  return asUser(user, async (tx) => {
    const [route] = await tx.query<any>(
      `select r.*, r.service_date::text as service_date, p.full_name as driver_name, sh.started_at as shift_started_at, sh.ended_at as shift_ended_at
         from routes r join profiles p on p.id = r.driver_id left join shifts sh on sh.route_id = r.id where r.id = $1`,
      [routeId],
    );
    if (!route) return null;
    const stops = await tx.query<any>(
      `select s.*, p.address, p.instructions, p.equipment, p.location_source, c.id as client_id, c.name as client_name, c.opted_out,
              (pr.property_id is not null) as to_resident, coalesce(pr.notify_channel, c.notify_channel) as notify_channel,
              v.note, v.block_reason, v.photo_count, v.completed_at, v.blocked_at,
              (select n.status from notifications n where n.route_stop_id = s.id and n.kind <> 'manual' and n.status <> 'cancelled' order by n.created_at desc limit 1) as last_notification_status
         from route_stops s join properties p on p.id = s.property_id join clients c on c.id = p.client_id
         left join property_residents pr on pr.property_id = p.id
         left join visits v on v.route_stop_id = s.id
        where s.route_id = $1 order by s.position`,
      [routeId],
    );
    const notifications = await tx.query<any>(
      `select n.id, n.kind, n.channel, n.status, n.simulated, n.scheduled_at, n.sent_at, n.window_start, n.window_end, n.error, n.cancel_reason,
              n.route_stop_id, n.dedupe_key, c.name as client_name
         from notifications n join clients c on c.id = n.client_id where n.route_id = $1 order by n.scheduled_at`,
      [routeId],
    );
    return { route, stops, notifications };
  });
}

export async function getRoutePreview(user: SessionUser, routeId: string) {
  requireRole(user, 'admin');
  // Read access is checked as the admin; the dry run itself writes nothing.
  const ok = await asUser(user, (tx) => tx.query('select 1 from routes where id = $1', [routeId]));
  if (!ok.length) return null;
  return asSystem((tx) => previewNotifications(tx, routeId));
}
