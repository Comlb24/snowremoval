import { asAnon, asUser, type SessionUser } from '../db';
import { requireRole } from '../auth';

export interface PublicStatus {
  firstName: string;
  address: string;
  active: boolean;
  stop: null | {
    status: string;
    routeStatus: string;
    serviceDate: string;
    windowStart: string | null;
    windowEnd: string | null;
    finishedAt: string | null;
    hasPhoto: boolean;
  };
}

/** Public status page data. The token is checked in the database; revoked or unknown tokens return null. */
export async function statusByToken(token: string): Promise<PublicStatus | null> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const [row] = await asAnon((tx) => tx.query<{ s: PublicStatus | null }>('select app.status_by_token($1) as s', [token]));
  return row?.s ?? null;
}

/** Signed-in client: their own properties and current/next service. Row Level Security limits the rows. */
export async function clientOverview(user: SessionUser) {
  requireRole(user, 'client');
  return asUser(user, async (tx) => {
    const [client] = await tx.query<any>('select id, name, notify_channel, opted_out from clients limit 1');
    const properties = await tx.query<any>(
      `select p.id, p.address, p.active,
              (select json_build_object('status', s.status, 'windowStart', s.window_start, 'windowEnd', s.window_end, 'finishedAt', s.finished_at,
                                        'serviceDate', r.service_date::text, 'routeStatus', r.status, 'hasPhoto', coalesce(v.photo_count, 0) > 0,
                                        'photoIds', (select coalesce(json_agg(ph.id), '[]') from visit_photos ph where ph.route_stop_id = s.id))
                 from route_stops s join routes r on r.id = s.route_id left join visits v on v.route_stop_id = s.id
                where s.property_id = p.id and r.service_date >= ((now() at time zone 'America/Moncton')::date - 1)
                order by r.service_date, r.planned_start limit 1) as stop,
              (select json_agg(h order by h.at desc) from (
                 select v.status, coalesce(v.completed_at, v.blocked_at) as at, v.photo_count > 0 as has_photo
                   from visits v where v.property_id = p.id and v.status <> 'in_progress' order by at desc limit 10) h) as history
         from properties p order by p.address`,
    );
    return { client, properties };
  });
}
