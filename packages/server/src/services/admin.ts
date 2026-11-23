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

const accountInput = z.object({
  fullName: z.string().trim().min(1, 'Enter a name').max(120),
  email: z.email('Enter a valid email').transform((e) => e.trim().toLowerCase()),
  // Required with Supabase sign-in; ignored by the development demo sign-in.
  password: z.string().min(8, 'Temporary password must be at least 8 characters').max(72).optional(),
});

/**
 * Create a sign-in account (auth user + profile). Used for the first admin (setup script),
 * drivers (Drivers page) and client logins (client page).
 * Supabase mode: confirmed Supabase Auth user with a temporary password. Dev mode: local account.
 */
export async function createAccount(role: 'admin' | 'driver' | 'client', raw: unknown, opts: { clientId?: string } = {}) {
  const input = accountInput.parse(raw);
  const c = config();
  let id: string;
  if (c.authMode === 'supabase') {
    if (!input.password) throw new Error('Set a temporary password (8+ characters) for this account');
    const { createSupabaseUser } = await import('../adapters/supabase');
    id = await createSupabaseUser(input.email, input.password, input.fullName);
  } else {
    id = randomUUID();
    await asSystem((tx) => tx.query('insert into auth.users (id, email) values ($1, $2)', [id, input.email]));
  }
  await asSystem(async (tx) => {
    await tx.query('insert into profiles (id, role, full_name, email) values ($1, $2, $3, $4)', [id, role, input.fullName, input.email]);
    if (opts.clientId) {
      const rows = await tx.query('update clients set user_id = $2, updated_at = now() where id = $1 and user_id is null returning id', [opts.clientId, id]);
      if (!rows.length) throw new Error('This client already has a sign-in');
    }
  });
  return id;
}

export async function createDriver(user: SessionUser, raw: unknown) {
  requireRole(user, 'admin');
  return createAccount('driver', raw);
}

/** Give a client a sign-in for the client web page and mobile app. */
export async function createClientLogin(user: SessionUser, clientId: string, raw: unknown) {
  requireRole(user, 'admin');
  const [c] = await asUser(user, (tx) => tx.query<{ user_id: string | null }>('select user_id from clients where id = $1', [clientId]));
  if (!c) throw new Error('Client not found');
  if (c.user_id) throw new Error('This client already has a sign-in');
  return createAccount('client', raw, { clientId });
}

export async function setDriverActive(user: SessionUser, driverId: string, active: boolean) {
  requireRole(user, 'admin');
  await asUser(user, (tx) => tx.query(`update profiles set active = $2 where id = $1 and role = 'driver'`, [driverId, active]));
}

export async function driverOptions(user: SessionUser) {
  requireRole(user, 'admin');
  return asUser(user, (tx) => tx.query<{ id: string; full_name: string }>(`select id, full_name from profiles where role = 'driver' and active order by full_name`));
}
