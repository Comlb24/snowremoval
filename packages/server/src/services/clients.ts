import { createHash, randomBytes } from 'node:crypto';
import { clientInputSchema, propertyInputSchema, previewImport, type ClientInput, type PropertyInput, type ImportRow } from '@snow/core';
import { asSystem, asUser, type SessionUser, type Tx } from '../db';
import { config } from '../env';
import { requireRole } from '../auth';
import { getRouting } from '../adapters/routing';

export async function listClients(user: SessionUser, search = '') {
  requireRole(user, 'admin');
  return asUser(user, (tx) =>
    tx.query<any>(
      `select c.id, c.name, c.notify_channel, c.opted_out, cc.phone, cc.email,
              count(p.id)::int as property_count, count(p.id) filter (where p.active)::int as active_property_count,
              coalesce(json_agg(json_build_object('id', p.id, 'address', p.address, 'active', p.active) order by p.address) filter (where p.id is not null), '[]') as properties
         from clients c left join client_contacts cc on cc.client_id = c.id left join properties p on p.client_id = c.id
        where $1 = '' or c.name ilike '%' || $1 || '%' or p.address ilike '%' || $1 || '%' or (regexp_replace($1, '\\D', '', 'g') <> '' and cc.phone like '%' || regexp_replace($1, '\\D', '', 'g') || '%')
        group by c.id, cc.phone, cc.email order by c.name`,
      [search.trim()],
    ),
  );
}

export async function getClient(user: SessionUser, clientId: string) {
  requireRole(user, 'admin');
  return asUser(user, async (tx) => {
    const [client] = await tx.query<any>(
      `select c.*, cc.phone, cc.email from clients c left join client_contacts cc on cc.client_id = c.id where c.id = $1`,
      [clientId],
    );
    if (!client) return null;
    const properties = await tx.query<any>(
      `select p.*, exists (select 1 from status_links l where l.property_id = p.id and l.revoked_at is null) as has_status_link
         from properties p where p.client_id = $1 order by p.created_at`,
      [clientId],
    );
    const visits = await tx.query<any>(
      `select v.*, p.address, r.service_date::text as service_date, d.full_name as driver_name
         from visits v join properties p on p.id = v.property_id join route_stops s on s.id = v.route_stop_id
         join routes r on r.id = s.route_id join profiles d on d.id = v.driver_id
        where p.client_id = $1 order by coalesce(v.completed_at, v.blocked_at, v.started_at) desc limit 100`,
      [clientId],
    );
    const communications = await tx.query<any>(
      `select n.id, n.kind, n.channel, n.status, n.simulated, n.body, n.scheduled_at, n.sent_at, n.error, n.cancel_reason, p.address
         from notifications n left join properties p on p.id = n.property_id
        where n.client_id = $1 and n.status <> 'cancelled' order by coalesce(n.sent_at, n.scheduled_at) desc limit 100`,
      [clientId],
    );
    const preferences = await tx.query<any>(
      `select l.change, l.created_at, p.full_name from communication_preferences_log l left join profiles p on p.id = l.changed_by
        where l.client_id = $1 order by l.created_at desc limit 50`,
      [clientId],
    );
    return { client, properties, visits, communications, preferences };
  });
}

async function insertClient(tx: Tx, user: SessionUser, c: ClientInput) {
  const [row] = await tx.query<{ id: string }>(
    `insert into clients (name, notify_channel, opted_out, opted_out_at) values ($1, $2, $3, case when $3 then now() end) returning id`,
    [c.name, c.notifyChannel, c.optedOut],
  );
  await tx.query('insert into client_contacts (client_id, phone, email) values ($1, $2, $3)', [row.id, c.phone, c.email ?? null]);
  await tx.query('insert into communication_preferences_log (client_id, change, changed_by) values ($1, $2, $3)', [
    row.id, `Created with ${c.notifyChannel === 'sms' ? 'SMS' : 'automated voice call'}${c.optedOut ? ', opted out' : ''}`, user.id,
  ]);
  return row.id;
}

async function insertProperty(tx: Tx, p: PropertyInput, source: string) {
  const [row] = await tx.query<{ id: string }>(
    `insert into properties (client_id, address, lat, lng, location_source, instructions, service_minutes, active)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [p.clientId, p.address, p.lat, p.lng, source, p.instructions, p.serviceMinutes, p.active],
  );
  return row.id;
}

/** Look up coordinates. In development these are simulated and labelled so. */
export async function geocodeAddress(user: SessionUser, address: string) {
  requireRole(user, 'admin');
  const routing = getRouting();
  const r = await routing.geocode(address);
  return r ? { ...r, simulated: routing.simulated } : null;
}

export async function createClient(user: SessionUser, raw: unknown, firstProperty?: Omit<PropertyInput, 'clientId'> & { source?: string }) {
  requireRole(user, 'admin');
  const c = clientInputSchema.parse(raw);
  return asUser(user, async (tx) => {
    const id = await insertClient(tx, user, c);
    if (firstProperty) {
      const p = propertyInputSchema.parse({ ...firstProperty, clientId: id });
      await insertProperty(tx, p, firstProperty.source ?? 'manual');
    }
    return id;
  });
}

export async function updateClient(user: SessionUser, clientId: string, raw: unknown) {
  requireRole(user, 'admin');
  const c = clientInputSchema.parse(raw);
  await asUser(user, async (tx) => {
    const [before] = await tx.query<any>('select notify_channel, opted_out from clients where id = $1', [clientId]);
    if (!before) throw new Error('Client not found');
    await tx.query(
      `update clients set name = $2, notify_channel = $3, opted_out = $4,
              opted_out_at = case when $4 and not opted_out then now() when not $4 then null else opted_out_at end, updated_at = now() where id = $1`,
      [clientId, c.name, c.notifyChannel, c.optedOut],
    );
    await tx.query(
      `insert into client_contacts (client_id, phone, email) values ($1, $2, $3)
       on conflict (client_id) do update set phone = excluded.phone, email = excluded.email`,
      [clientId, c.phone, c.email ?? null],
    );
    const changes: string[] = [];
    if (before.notify_channel !== c.notifyChannel) changes.push(`Channel changed to ${c.notifyChannel === 'sms' ? 'SMS' : 'automated voice call'}`);
    if (before.opted_out !== c.optedOut) changes.push(c.optedOut ? 'Opted out of notifications' : 'Opted back in to notifications');
    for (const ch of changes) await tx.query('insert into communication_preferences_log (client_id, change, changed_by) values ($1, $2, $3)', [clientId, ch, user.id]);
  });
  await refreshRoutesFor(`select distinct s.route_id from route_stops s join properties p on p.id = s.property_id where p.client_id = $1`, clientId);
}

/** Opt-outs and property changes must reach routes already scheduled. */
async function refreshRoutesFor(sql: string, id: string) {
  const { recomputeRoute } = await import('./schedule');
  const routes = await asSystem((tx) =>
    tx.query<{ route_id: string }>(`select route_id from (${sql}) x where route_id in (select id from routes where status in ('published', 'in_progress', 'paused'))`, [id]),
  );
  for (const r of routes) await asSystem((tx) => recomputeRoute(tx, r.route_id));
}

export async function createProperty(user: SessionUser, raw: unknown, source = 'manual') {
  requireRole(user, 'admin');
  const p = propertyInputSchema.parse(raw);
  return asUser(user, (tx) => insertProperty(tx, p, source));
}

export async function updateProperty(user: SessionUser, propertyId: string, raw: unknown, source?: string) {
  requireRole(user, 'admin');
  const p = propertyInputSchema.parse(raw);
  await asUser(user, (tx) =>
    tx.query(
      `update properties set address = $2, lat = $3, lng = $4, instructions = $5, service_minutes = $6, active = $7,
              location_source = coalesce($8, location_source), updated_at = now() where id = $1`,
      [propertyId, p.address, p.lat, p.lng, p.instructions, p.serviceMinutes, p.active, source ?? null],
    ),
  );
  await refreshRoutesFor('select distinct route_id from route_stops where property_id = $1', propertyId);
}

/** New private status link. The token is shown once; only its hash is stored. Creating one revokes older links. */
export async function createStatusLink(user: SessionUser, propertyId: string) {
  requireRole(user, 'admin');
  const token = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(token, 'utf8').digest('hex');
  await asUser(user, async (tx) => {
    await tx.query('update status_links set revoked_at = now() where property_id = $1 and revoked_at is null', [propertyId]);
    await tx.query('insert into status_links (property_id, token_hash, created_by) values ($1, $2, $3)', [propertyId, hash, user.id]);
  });
  return { token, url: `${config().publicBaseUrl}/s/${token}` };
}

export async function revokeStatusLinks(user: SessionUser, propertyId: string) {
  requireRole(user, 'admin');
  await asUser(user, (tx) => tx.query('update status_links set revoked_at = now() where property_id = $1 and revoked_at is null', [propertyId]));
}

export async function listActiveProperties(user: SessionUser) {
  requireRole(user, 'admin');
  return asUser(user, (tx) =>
    tx.query<any>(
      `select p.id, p.address, p.lat, p.lng, p.service_minutes, p.location_source, c.name as client_name, c.opted_out
         from properties p join clients c on c.id = p.client_id where p.active order by c.name, p.address`,
    ),
  );
}

// ---------------------------------------------------------------- CSV import

export function previewCsv(user: SessionUser, text: string) {
  requireRole(user, 'admin');
  return previewImport(text);
}

/**
 * Import the valid rows. Rows with the same name + phone become one client with several properties.
 * An existing client with the same phone number is reused instead of duplicated.
 */
export async function importCsv(user: SessionUser, text: string) {
  requireRole(user, 'admin');
  const preview = previewImport(text);
  if (preview.headerErrors.length) throw new Error(preview.headerErrors.join('; '));
  const valid = preview.rows.filter((r) => !r.errors.length);
  const routing = getRouting();
  const located: (ImportRow & { lat: number; lng: number; source: string })[] = [];
  const failed: { line: number; error: string }[] = [];
  for (const r of valid) {
    if (r.lat != null && r.lng != null) {
      located.push({ ...r, lat: r.lat, lng: r.lng, source: 'import' });
      continue;
    }
    try {
      const g = await routing.geocode(r.address);
      if (!g) failed.push({ line: r.line, error: 'Address not found' });
      else located.push({ ...r, lat: g.lat, lng: g.lng, source: g.source });
    } catch (e: any) {
      failed.push({ line: r.line, error: String(e?.message ?? e) });
    }
  }
  let clientsCreated = 0;
  let propertiesCreated = 0;
  let skippedExisting = 0;
  await asUser(user, async (tx) => {
    const clientIds = new Map<string, string>();
    for (const r of located) {
      let clientId = clientIds.get(r.clientKey);
      if (!clientId) {
        const [existing] = await tx.query<{ client_id: string }>('select client_id from client_contacts where phone = $1 limit 1', [r.phone]);
        clientId = existing?.client_id ?? (await insertClient(tx, user, { name: r.clientName, phone: r.phone!, email: r.email ?? undefined, notifyChannel: r.notifyChannel, optedOut: false }));
        if (!existing) clientsCreated++;
        clientIds.set(r.clientKey, clientId);
      }
      const [dup] = await tx.query('select 1 from properties where client_id = $1 and lower(address) = lower($2)', [clientId, r.address]);
      if (dup) {
        skippedExisting++;
        continue;
      }
      await insertProperty(tx, { clientId, address: r.address, lat: r.lat, lng: r.lng, instructions: r.instructions, serviceMinutes: r.serviceMinutes, active: true }, r.source);
      propertiesCreated++;
    }
  });
  return { clientsCreated, propertiesCreated, skippedExisting, invalidRows: preview.rows.length - valid.length, lookupFailures: failed, simulatedLocations: routing.simulated };
}
