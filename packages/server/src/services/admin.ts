import { randomUUID } from 'node:crypto';
import { localDate } from '@snow/core';
import { z } from 'zod';
import { asSystem, asUser, type SessionUser } from '../db';
import { config } from '../env';
import { requireRole } from '../auth';

/** Overview page: today's routes, blocked stops, failed notifications. */
export async function overview(user: SessionUser) {
  requireRole(user, 'admin');
  const today = localDate(new Date(), config().timeZone);
  return asUser(user, async (tx) => {
    const routes = await tx.query<any>(
      `select r.id, r.status, r.planned_start, p.full_name as driver_name, sh.started_at as shift_started_at,
              count(s.id) filter (where s.status <> 'removed')::int as stop_count,
              count(s.id) filter (where s.status = 'completed')::int as completed_count,
              count(s.id) filter (where s.status = 'blocked')::int as blocked_count,
              count(s.id) filter (where s.status = 'in_progress')::int as active_count
         from routes r join profiles p on p.id = r.driver_id left join shifts sh on sh.route_id = r.id left join route_stops s on s.route_id = r.id
        where r.service_date = $1 and r.status <> 'cancelled' group by r.id, p.full_name, sh.started_at order by r.planned_start`,
      [today],
    );
    const blocked = await tx.query<any>(
      `select s.id, s.route_id, s.finished_at, p.address, c.name as client_name, v.block_reason, v.note
         from route_stops s join routes r on r.id = s.route_id join properties p on p.id = s.property_id join clients c on c.id = p.client_id
         left join visits v on v.route_stop_id = s.id
        where s.status = 'blocked' and r.service_date >= ($1::date - 1) order by s.finished_at desc limit 20`,
      [today],
    );
    const failed = await tx.query<any>(
      `select n.id, n.channel, n.kind, n.error, n.failed_at, n.simulated, c.id as client_id, c.name as client_name, p.address, n.route_id
         from notifications n join clients c on c.id = n.client_id left join properties p on p.id = n.property_id
        where n.status = 'failed' and n.created_at > now() - interval '3 days' order by n.failed_at desc limit 20`,
    );
    const [counts] = await tx.query<any>(
      `select (select count(*)::int from clients) as clients, (select count(*)::int from properties where active) as properties,
              (select count(*)::int from notifications where status = 'scheduled') as scheduled,
              (select count(*)::int from notifications where status in ('sent', 'delivered') and sent_at > now() - interval '1 day') as sent_today`,
    );
    return { today, routes, blocked, failed, counts };
  });
}

export async function listDrivers(user: SessionUser) {
  requireRole(user, 'admin');
  const today = localDate(new Date(), config().timeZone);
  return asUser(user, (tx) =>
    tx.query<any>(
      `select p.id, p.full_name, p.email, p.active,
              (select count(*)::int from routes r where r.driver_id = p.id and r.service_date = $1 and r.status <> 'cancelled') as routes_today,
              (select json_build_object('id', r.id, 'status', r.status) from routes r where r.driver_id = p.id and r.service_date = $1 and r.status not in ('cancelled', 'draft') order by r.planned_start limit 1) as current_route,
              (select max(sh.started_at) from shifts sh where sh.driver_id = p.id) as last_shift
         from profiles p where p.role = 'driver' order by p.active desc, p.full_name`,
      [today],
    ),
  );
}

const newDriver = z.object({ fullName: z.string().trim().min(1).max(120), email: z.email() });

/**
 * Add a driver. Dev mode: creates a local account. Supabase mode: creates the auth user
 * through the Supabase admin API (needs the service key; NOT VERIFIED against a live project).
 */
export async function createDriver(user: SessionUser, raw: unknown) {
  requireRole(user, 'admin');
  const input = newDriver.parse(raw);
  const c = config();
  let id: string;
  if (c.authMode === 'supabase') {
    if (!c.supabase?.serviceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is needed to invite drivers');
    const res = await fetch(`${c.supabase.url}/auth/v1/admin/users`, {
      method: 'POST',
      headers: { apikey: c.supabase.serviceRoleKey, Authorization: `Bearer ${c.supabase.serviceRoleKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: input.email, email_confirm: true, user_metadata: { full_name: input.fullName } }),
    });
    if (!res.ok) throw new Error(`Could not create the account (${res.status})`);
    id = (await res.json()).id;
  } else {
    id = randomUUID();
    await asSystem((tx) => tx.query('insert into auth.users (id, email) values ($1, $2)', [id, input.email]));
  }
  await asUser(user, (tx) => tx.query(`insert into profiles (id, role, full_name, email) values ($1, 'driver', $2, $3)`, [id, input.fullName, input.email]));
  return id;
}

export async function setDriverActive(user: SessionUser, driverId: string, active: boolean) {
  requireRole(user, 'admin');
  await asUser(user, (tx) => tx.query(`update profiles set active = $2 where id = $1 and role = 'driver'`, [driverId, active]));
}

export async function driverOptions(user: SessionUser) {
  requireRole(user, 'admin');
  return asUser(user, (tx) => tx.query<{ id: string; full_name: string }>(`select id, full_name from profiles where role = 'driver' and active order by full_name`));
}
