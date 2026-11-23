import { localDate, stopUpdateSchema, type StopUpdateInput } from '@snow/core';
import { z } from 'zod';
import { asSystem, asUser, type SessionUser } from '../db';
import { config } from '../env';
import { requireRole } from '../auth';
import { getStorage } from '../adapters/storage';
import { recomputeRoute } from './schedule';

/** Routes assigned to this driver (published or later). Database policies hide drafts and other drivers' routes. */
export async function myRoutes(user: SessionUser) {
  requireRole(user, 'driver');
  const today = localDate(new Date(), config().timeZone);
  return asUser(user, (tx) =>
    tx.query<any>(
      `select r.id, r.service_date::text as service_date, r.planned_start, r.status, r.start_address,
              sh.started_at as shift_started_at, sh.ended_at as shift_ended_at,
              count(s.id) filter (where s.status <> 'removed')::int as stop_count,
              count(s.id) filter (where s.status in ('completed', 'blocked'))::int as done_count
         from routes r left join shifts sh on sh.route_id = r.id left join route_stops s on s.route_id = r.id
        where r.service_date >= ($1::date - 1) and r.status <> 'cancelled'
        group by r.id, sh.started_at, sh.ended_at order by r.service_date, r.planned_start`,
      [today],
    ),
  );
}

/**
 * Full route for the driver app (cached on the device for offline use).
 * Contains no client phone numbers — those need an explicit reveal.
 */
export async function driverRoute(user: SessionUser, routeId: string) {
  requireRole(user, 'driver');
  return asUser(user, async (tx) => {
    const [route] = await tx.query<any>(
      `select r.id, r.service_date::text as service_date, r.planned_start, r.status, r.start_address, r.start_lat, r.start_lng,
              sh.started_at as shift_started_at, sh.ended_at as shift_ended_at
         from routes r left join shifts sh on sh.route_id = r.id where r.id = $1`,
      [routeId],
    );
    if (!route) return null;
    const stops = await tx.query<any>(
      `select s.id, s.position, s.status, s.est_arrival, s.window_start, s.window_end, s.started_at, s.finished_at, s.service_minutes,
              p.id as property_id, p.address, p.lat, p.lng, p.instructions, p.equipment, c.name as client_name,
              v.note, v.block_reason, coalesce(v.photo_count, 0)::int as photo_count
         from route_stops s join properties p on p.id = s.property_id join clients c on c.id = p.client_id
         left join visits v on v.route_stop_id = s.id
        where s.route_id = $1 and s.status <> 'removed' order by s.position`,
      [routeId],
    );
    return { route, stops, fetchedAt: new Date().toISOString() };
  });
}

async function routeOfStop(stopId: string) {
  const [r] = await asSystem((tx) => tx.query<{ route_id: string }>('select route_id from route_stops where id = $1', [stopId]));
  return r?.route_id;
}

export async function startShift(user: SessionUser, routeId: string) {
  requireRole(user, 'driver');
  await asUser(user, (tx) => tx.query('select app.driver_start_shift($1)', [routeId]));
  // Recalculate estimates only. Starting a shift does not send messages to every client:
  // messages still go out at each stop's own time (one hour before its window).
  await asSystem((tx) => recomputeRoute(tx, routeId));
}

export async function endShift(user: SessionUser, routeId: string) {
  requireRole(user, 'driver');
  await asUser(user, (tx) => tx.query('select app.driver_end_shift($1)', [routeId]));
  await asSystem((tx) => recomputeRoute(tx, routeId));
}

/** Apply a stop update exactly once (retries with the same clientUuid are ignored). */
export async function recordStopUpdate(user: SessionUser, raw: StopUpdateInput) {
  requireRole(user, 'driver');
  const input = stopUpdateSchema.parse(raw);
  const [{ result }] = await asUser(user, (tx) =>
    tx.query<{ result: string }>('select app.driver_record_stop_update($1, $2, $3, $4, $5, $6) as result', [
      input.clientUuid, input.stopId, input.status, input.note ?? null, input.blockReason ?? null, input.occurredAt,
    ]),
  );
  const routeId = await routeOfStop(input.stopId);
  if (result === 'applied' && routeId) await asSystem((tx) => recomputeRoute(tx, routeId));
  return { result };
}

const photoMeta = z.object({ clientUuid: z.uuid(), stopId: z.uuid(), contentType: z.enum(['image/jpeg', 'image/png', 'image/heic', 'image/webp']) });
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

/** Optional driveway photo. Idempotent by clientUuid: the same upload retried is stored once. */
export async function addPhoto(user: SessionUser, meta: { clientUuid: string; stopId: string; contentType: string }, bytes: Uint8Array) {
  requireRole(user, 'driver');
  const m = photoMeta.parse(meta);
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_PHOTO_BYTES) throw new Error('Photo must be under 10 MB');
  // Permission check first (raises if the stop is not on this driver's active route).
  await asUser(user, (tx) => tx.query('select app.assert_driver_stop($1)', [m.stopId]));
  const [existing] = await asSystem((tx) => tx.query<{ id: string }>('select id from visit_photos where client_uuid = $1', [m.clientUuid]));
  if (existing) return { photoId: existing.id, result: 'duplicate' };
  const routeId = await routeOfStop(m.stopId);
  const ext = m.contentType.split('/')[1].replace('jpeg', 'jpg');
  const key = `routes/${routeId}/${m.stopId}/${m.clientUuid}.${ext}`;
  await getStorage().put(key, bytes, m.contentType); // same key on retry: overwrites, never duplicates
  const [{ id }] = await asUser(user, (tx) =>
    tx.query<{ id: string }>('select app.driver_add_photo($1, $2, $3, $4, $5) as id', [m.clientUuid, m.stopId, key, m.contentType, bytes.byteLength]),
  );
  return { photoId: id, result: 'applied' };
}

/** Reveal the client's phone for a stop. Logged in the database. */
export async function revealPhone(user: SessionUser, stopId: string) {
  requireRole(user, 'driver');
  const [{ phone }] = await asUser(user, (tx) => tx.query<{ phone: string | null }>('select app.reveal_client_phone($1) as phone', [stopId]));
  return { phone };
}

/** Photo bytes for any role allowed by the database policies (admin, assigned driver, owning client). */
export async function getPhoto(user: SessionUser, photoId: string) {
  const [row] = await asUser(user, (tx) => tx.query<{ storage_path: string }>('select storage_path from visit_photos where id = $1', [photoId]));
  if (!row) return null;
  return getStorage().get(row.storage_path);
}

export async function listStopPhotos(user: SessionUser, stopId: string) {
  return asUser(user, (tx) => tx.query<{ id: string; created_at: Date }>('select id, created_at from visit_photos where route_stop_id = $1 order by created_at', [stopId]));
}
