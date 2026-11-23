import { localDate, addMinutes, manualEmailSubject, manualMessageSchema, NOTIFYING_ROUTE_STATUSES, type ManualMessageInput } from '@snow/core';
import { asSystem, asUser, type SessionUser } from '../db';
import { config } from '../env';
import { getMessenger } from '../adapters/messaging';
import { requireRole } from '../auth';
import { log } from '../log';
import { contactFor, recomputeRoute, RECIPIENT_COLUMNS } from './schedule';

const MAX_ATTEMPTS = 3;
const STALE_SENDING_MINUTES = 10;

/**
 * One scheduler pass. Called every minute by the backend (cron route or local runner),
 * so it keeps working when every app is closed.
 *  1. Recalculate routes that are live today (follows delays and progress).
 *  2. Send notifications that are due, each exactly once.
 */
export async function runSchedulerTick(now = new Date()) {
  const c = config();
  const today = localDate(now, c.timeZone);
  const routes = await asSystem((tx) =>
    tx.query<{ id: string }>(
      `select id from routes
        where (status in ('published', 'in_progress') and service_date between ($1::date - 1) and ($1::date + 1))
           or (status in ('paused', 'cancelled', 'completed', 'draft') and exists (
                select 1 from notifications n where n.route_id = routes.id and n.status = 'scheduled'))`,
      [today],
    ),
  );
  let created = 0;
  let cancelled = 0;
  for (const r of routes) {
    const res = await asSystem((tx) => recomputeRoute(tx, r.id, now));
    created += res.created;
    cancelled += res.cancelled;
  }
  const sent = await sendDueNotifications(now);
  return { routes: routes.length, created, cancelled, ...sent };
}

export async function sendDueNotifications(now = new Date()) {
  // A row stuck in 'sending' means a worker died mid-send. We cannot know if the provider got it,
  // so mark it failed for the admin instead of risking a duplicate message.
  await asSystem((tx) =>
    tx.query(
      `update notifications set status = 'failed', failed_at = now(), error = 'Interrupted while sending; not retried to avoid a duplicate', updated_at = now()
        where status = 'sending' and updated_at < $1`,
      [addMinutes(now, -STALE_SENDING_MINUTES).toISOString()],
    ),
  );

  // Claim due rows atomically. SKIP LOCKED lets several workers run without sending twice.
  const claimed = await asSystem((tx) =>
    tx.query<any>(
      `update notifications n set status = 'sending', attempts = attempts + 1, updated_at = now()
        where n.id in (select id from notifications where status = 'scheduled' and scheduled_at <= $1
                        order by scheduled_at limit 50 for update skip locked)
        returning n.*`,
      [now.toISOString()],
    ),
  );

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const n of claimed) {
    // Last check right before sending: the world may have changed since the row was scheduled.
    if (n.kind !== 'manual') {
      const [ok] = await asSystem((tx) =>
        tx.query<{ ok: boolean }>(
          `select (r.status = any($2::text::text[]) and s.status = 'pending' and not c.opted_out and p.active) as ok
             from route_stops s join routes r on r.id = s.route_id join properties p on p.id = s.property_id join clients c on c.id = p.client_id
            where s.id = $1`,
          [n.route_stop_id, `{${NOTIFYING_ROUTE_STATUSES.join(',')}}`],
        ),
      );
      if (!ok?.ok) {
        await asSystem((tx) => tx.query(`update notifications set status = 'cancelled', cancel_reason = 'No longer relevant at send time', updated_at = now() where id = $1`, [n.id]));
        skipped++;
        continue;
      }
    } else {
      const [c] = await asSystem((tx) => tx.query<{ opted_out: boolean }>('select opted_out from clients where id = $1', [n.client_id]));
      if (c?.opted_out) {
        await asSystem((tx) => tx.query(`update notifications set status = 'cancelled', cancel_reason = 'Client opted out', updated_at = now() where id = $1`, [n.id]));
        skipped++;
        continue;
      }
    }

    const messenger = getMessenger(n.channel);
    const res = await messenger.send({ channel: n.channel, to: n.to_address, body: n.body, subject: n.subject, notificationId: n.id });
    if (res.ok) {
      await asSystem((tx) =>
        tx.query(
          `update notifications set status = 'sent', sent_at = $2, provider_ref = $3, simulated = $4, provider = $5, error = null, updated_at = now() where id = $1`,
          [n.id, now.toISOString(), res.providerRef, res.simulated, messenger.name],
        ),
      );
      sent++;
    } else if (res.retryable && n.attempts < MAX_ATTEMPTS) {
      await asSystem((tx) =>
        tx.query(`update notifications set status = 'scheduled', scheduled_at = $2, error = $3, updated_at = now() where id = $1`, [n.id, addMinutes(now, 5).toISOString(), res.error]),
      );
    } else {
      await asSystem((tx) =>
        tx.query(`update notifications set status = 'failed', failed_at = $2, error = $3, simulated = $4, provider = $5, updated_at = now() where id = $1`, [
          n.id, now.toISOString(), res.error, res.simulated, messenger.name,
        ]),
      );
      log.warn(`Notification ${n.id} failed: ${res.error}`);
      failed++;
    }
  }
  return { claimed: claimed.length, sent, failed, skipped };
}

/** Twilio delivery status callback (SMS MessageStatus or call CallStatus). */
export async function applyProviderStatus(providerRef: string, status: string, errorCode?: string) {
  const delivered = ['delivered', 'completed', 'read'];
  const failed = ['failed', 'undelivered', 'busy', 'no-answer', 'canceled'];
  if (delivered.includes(status)) {
    await asSystem((tx) => tx.query(`update notifications set status = 'delivered', delivered_at = now(), updated_at = now() where provider_ref = $1 and status in ('sent', 'sending')`, [providerRef]));
  } else if (failed.includes(status)) {
    await asSystem((tx) =>
      tx.query(`update notifications set status = 'failed', failed_at = now(), error = $2, updated_at = now() where provider_ref = $1 and status in ('sent', 'sending', 'delivered')`, [
        providerRef, `Provider reported ${status}${errorCode ? ` (code ${errorCode})` : ''}`,
      ]),
    );
  }
}

/** Admin: send an immediate service message to one client or every client on a route. */
export async function sendManualMessage(user: SessionUser, raw: ManualMessageInput) {
  requireRole(user, 'admin');
  const input = manualMessageSchema.parse(raw);
  const targets = await asUser(user, (tx) =>
    input.target.type === 'client'
      ? tx.query<any>(
          `select c.id as client_id, c.notify_channel, c.opted_out, cc.phone, cc.email, null::uuid as route_id, null::uuid as property_id, null::uuid as stop_id
             from clients c left join client_contacts cc on cc.client_id = c.id where c.id = $1`,
          [input.target.clientId],
        )
      : tx.query<any>(
          // Route messages are about the property, so they go to the resident when there is one.
          `select c.id as client_id, c.opted_out, ${RECIPIENT_COLUMNS}, s.route_id, s.property_id, s.id as stop_id
             from route_stops s join properties p on p.id = s.property_id join clients c on c.id = p.client_id
             left join client_contacts cc on cc.client_id = c.id left join property_residents pr on pr.property_id = p.id
            where s.route_id = $1 and s.status <> 'removed'`,
          [input.target.routeId],
        ),
  );
  if (!targets.length) throw new Error('No recipients found');
  let queued = 0;
  const skipped: string[] = [];
  await asUser(user, async (tx) => {
    for (const t of targets) {
      const to = contactFor(t);
      if (t.opted_out || !to) {
        skipped.push(t.client_id);
        continue;
      }
      const messenger = getMessenger(t.notify_channel);
      await tx.query(
        `insert into notifications (client_id, property_id, route_id, route_stop_id, kind, channel, to_address, body, subject, scheduled_at, status, simulated, provider, created_by)
         values ($1, $2, $3, $4, 'manual', $5, $6, $7, $8, now(), 'scheduled', $9, $10, $11)`,
        [t.client_id, t.property_id, t.route_id, t.stop_id, t.notify_channel, to, input.body, t.notify_channel === 'email' ? manualEmailSubject(config().businessName) : null, messenger.simulated, messenger.name, user.id],
      );
      queued++;
    }
  });
  const result = await sendDueNotifications(new Date());
  return { queued, skippedOptedOut: skipped.length, ...result };
}

export interface CommunicationFilter {
  status?: string;
  routeId?: string;
  clientId?: string;
  limit?: number;
}

/** Admin communications history. Phone numbers are included only for admins (RLS). */
export async function listCommunications(user: SessionUser, f: CommunicationFilter = {}) {
  requireRole(user, 'admin');
  return asUser(user, (tx) =>
    tx.query<any>(
      `select n.id, n.kind, n.channel, n.subject, n.status, n.simulated, n.provider, n.provider_ref, n.body, n.window_start, n.window_end,
              n.scheduled_at, n.sent_at, n.delivered_at, n.failed_at, n.error, n.cancel_reason, n.created_at, n.to_address,
              c.id as client_id, c.name as client_name, p.address, n.route_id, r.service_date::text as service_date
         from notifications n join clients c on c.id = n.client_id
         left join properties p on p.id = n.property_id left join routes r on r.id = n.route_id
        where ($1::text is null or n.status = $1) and ($2::uuid is null or n.route_id = $2) and ($3::uuid is null or n.client_id = $3)
        order by coalesce(n.sent_at, n.scheduled_at) desc limit $4`,
      [f.status ?? null, f.routeId ?? null, f.clientId ?? null, f.limit ?? 200],
    ),
  );
}
