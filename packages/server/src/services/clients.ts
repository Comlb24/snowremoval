import { createHash, randomBytes } from 'node:crypto';
import { CHANNEL_LABELS, clientInputSchema, localDate, paymentInputSchema, propertyInputSchema, previewImport, type ClientInput, type PropertyInput, type PropertyFormInput, type ImportRow } from '@snow/core';
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
              coalesce(json_agg(json_build_object('id', p.id, 'address', p.address, 'active', p.active) order by p.address) filter (where p.id is not null), '[]') as properties,
              coalesce(sum(d.quoted_amount) filter (where p.active), 0)::float8 as quoted_total,
              (select coalesce(sum(cp.amount), 0) from client_payments cp where cp.client_id = c.id)::float8 as paid_total
         from clients c left join client_contacts cc on cc.client_id = c.id left join properties p on p.client_id = c.id
         left join property_admin_details d on d.property_id = p.id
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
      `select c.*, cc.phone, cc.email, lp.email as login_email, lp.active as login_active
         from clients c left join client_contacts cc on cc.client_id = c.id left join profiles lp on lp.id = c.user_id where c.id = $1`,
      [clientId],
    );
    if (!client) return null;
    const properties = await tx.query<any>(
      `select p.*, d.quoted_amount::float8 as quoted_amount, coalesce(d.office_notes, '') as office_notes, ${RESIDENT_COLUMNS},
              exists (select 1 from status_links l where l.property_id = p.id and l.revoked_at is null) as has_status_link
         from properties p left join property_admin_details d on d.property_id = p.id left join property_residents pr on pr.property_id = p.id
        where p.client_id = $1 order by p.created_at`,
      [clientId],
    );
    const payments = await tx.query<any>(
      `select cp.id, cp.amount::float8 as amount, cp.paid_on::text as paid_on, cp.note, cp.created_at, pr.full_name as recorded_by
         from client_payments cp left join profiles pr on pr.id = cp.created_by where cp.client_id = $1 order by cp.paid_on desc, cp.created_at desc`,
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
      `select n.id, n.kind, n.channel, n.subject, n.status, n.simulated, n.body, n.scheduled_at, n.sent_at, n.error, n.cancel_reason, p.address
         from notifications n left join properties p on p.id = n.property_id
        where n.client_id = $1 and n.status <> 'cancelled' order by coalesce(n.sent_at, n.scheduled_at) desc limit 100`,
      [clientId],
    );
    const preferences = await tx.query<any>(
      `select l.change, l.created_at, p.full_name from communication_preferences_log l left join profiles p on p.id = l.changed_by
        where l.client_id = $1 order by l.created_at desc limit 50`,
      [clientId],
    );
    const seasonStart = winterSeasonStart(new Date());
    const [stats] = await tx.query<any>(
      `select count(*) filter (where v.status = 'completed')::int as completed_total,
              count(*) filter (where v.status = 'completed' and r.service_date >= $2)::int as completed_season,
              count(*) filter (where v.status = 'blocked' and r.service_date >= $2)::int as blocked_season,
              max(v.completed_at) as last_completed_at
         from visits v join properties p on p.id = v.property_id join route_stops s on s.id = v.route_stop_id
         join routes r on r.id = s.route_id where p.client_id = $1`,
      [clientId, seasonStart],
    );
    // Only active properties count toward what the client owes.
    const quotedTotal = properties.filter((p: any) => p.active).reduce((t: number, p: any) => t + (p.quoted_amount ?? 0), 0);
    const paidTotal = payments.reduce((t: number, p: any) => t + p.amount, 0);
    return { client, properties, payments, money: { quotedTotal, paidTotal, balance: Math.round((quotedTotal - paidTotal) * 100) / 100 }, visits, communications, preferences, stats: { ...stats, seasonStart } };
  });
}

/** A snow season runs July to June, so November and February count as the same winter. */
function winterSeasonStart(now: Date) {
  const [y, m] = localDate(now.toISOString(), config().timeZone).split('-').map(Number);
  return `${m >= 7 ? y : y - 1}-07-01`;
}

async function insertClient(tx: Tx, user: SessionUser, c: ClientInput) {
  const [row] = await tx.query<{ id: string }>(
    `insert into clients (name, notify_channel, opted_out, opted_out_at) values ($1, $2, $3, case when $3 then now() end) returning id`,
    [c.name, c.notifyChannel, c.optedOut],
  );
  await tx.query('insert into client_contacts (client_id, phone, email) values ($1, $2, $3)', [row.id, c.phone, c.email ?? null]);
  await tx.query('insert into communication_preferences_log (client_id, change, changed_by) values ($1, $2, $3)', [
    row.id, `Created with ${CHANNEL_LABELS[c.notifyChannel]}${c.optedOut ? ', opted out' : ''}`, user.id,
  ]);
  return row.id;
}

async function insertProperty(tx: Tx, p: PropertyInput, source: string) {
  const [row] = await tx.query<{ id: string }>(
    `insert into properties (client_id, address, lat, lng, location_source, instructions, service_minutes, active, equipment)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
    [p.clientId, p.address, p.lat, p.lng, source, p.instructions, p.serviceMinutes, p.active, p.equipment],
  );
  await saveAdminDetails(tx, row.id, p);
  await saveResident(tx, row.id, p);
  return row.id;
}

/** Store the resident contact, or remove it so updates go back to the owner. */
async function saveResident(tx: Tx, propertyId: string, p: PropertyInput) {
  if (p.resident === undefined) return;
  if (!p.resident) {
    await tx.query('delete from property_residents where property_id = $1', [propertyId]);
    return;
  }
  const r = p.resident;
  await tx.query(
    `insert into property_residents (property_id, name, phone, email, notify_channel) values ($1, $2, $3, $4, $5)
     on conflict (property_id) do update set name = excluded.name, phone = excluded.phone, email = excluded.email,
       notify_channel = excluded.notify_channel, updated_at = now()`,
    [propertyId, r.name, r.phone ?? null, r.email ?? null, r.notifyChannel],
  );
}

/** Admin-only resident columns, for joining onto a property row. */
const RESIDENT_COLUMNS = `pr.name as resident_name, pr.phone as resident_phone, pr.email as resident_email, pr.notify_channel as resident_channel,
              (pr.property_id is not null) as has_resident`;

async function saveAdminDetails(tx: Tx, propertyId: string, p: PropertyInput) {
  await tx.query(
    `insert into property_admin_details (property_id, quoted_amount, office_notes) values ($1, $2, $3)
     on conflict (property_id) do update set quoted_amount = excluded.quoted_amount, office_notes = excluded.office_notes, updated_at = now()`,
    [propertyId, p.quotedAmount, p.officeNotes],
  );
}

/** Look up coordinates. In development these are simulated and labelled so. */
export async function geocodeAddress(user: SessionUser, address: string) {
  requireRole(user, 'admin');
  const routing = getRouting();
  const r = await routing.geocode(address);
  return r ? { ...r, simulated: routing.simulated } : null;
}

export async function createClient(user: SessionUser, raw: unknown, firstProperty?: Omit<PropertyFormInput, 'clientId'> & { source?: string }) {
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
    if (before.notify_channel !== c.notifyChannel) changes.push(`Channel changed to ${CHANNEL_LABELS[c.notifyChannel]}`);
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
  await asUser(user, async (tx) => {
    const [row] = await tx.query<{ id: string }>(
      `update properties set client_id = $2, address = $3, lat = $4, lng = $5, instructions = $6, service_minutes = $7, active = $8,
              equipment = $9, location_source = coalesce($10, location_source), updated_at = now() where id = $1 returning id`,
      [propertyId, p.clientId, p.address, p.lat, p.lng, p.instructions, p.serviceMinutes, p.active, p.equipment, source ?? null],
    );
    if (!row) throw new Error('Property not found');
    await saveAdminDetails(tx, propertyId, p);
    await saveResident(tx, propertyId, p);
  });
  await refreshRoutesFor('select distinct route_id from route_stops where property_id = $1', propertyId);
}

export async function setPropertyActive(user: SessionUser, propertyId: string, active: boolean) {
  requireRole(user, 'admin');
  await asUser(user, (tx) => tx.query('update properties set active = $2, updated_at = now() where id = $1', [propertyId, active]));
  await refreshRoutesFor('select distinct route_id from route_stops where property_id = $1', propertyId);
}

/** One property with its owner and admin-only details, for the property page. */
export async function getProperty(user: SessionUser, propertyId: string) {
  requireRole(user, 'admin');
  return asUser(user, async (tx) => {
    const [property] = await tx.query<any>(
      `select p.*, d.quoted_amount::float8 as quoted_amount, coalesce(d.office_notes, '') as office_notes, c.name as client_name, ${RESIDENT_COLUMNS},
              exists (select 1 from status_links l where l.property_id = p.id and l.revoked_at is null) as has_status_link
         from properties p join clients c on c.id = p.client_id left join property_admin_details d on d.property_id = p.id
         left join property_residents pr on pr.property_id = p.id where p.id = $1`,
      [propertyId],
    );
    return property ?? null;
  });
}

/** All properties with their owner, for the Properties tab. */
export async function listProperties(user: SessionUser, search = '') {
  requireRole(user, 'admin');
  return asUser(user, (tx) =>
    tx.query<any>(
      `select p.id, p.address, p.active, p.equipment, p.instructions, c.id as client_id, c.name as client_name,
              d.quoted_amount::float8 as quoted_amount, coalesce(d.office_notes, '') as office_notes, ${RESIDENT_COLUMNS}
         from properties p join clients c on c.id = p.client_id left join property_admin_details d on d.property_id = p.id
         left join property_residents pr on pr.property_id = p.id
        where $1 = '' or p.address ilike '%' || $1 || '%' or c.name ilike '%' || $1 || '%' or pr.name ilike '%' || $1 || '%'
        order by p.active desc, p.address`,
      [search.trim()],
    ),
  );
}

/** Short list of clients for the owner drop-down. */
export async function clientOptions(user: SessionUser) {
  requireRole(user, 'admin');
  return asUser(user, (tx) => tx.query<{ id: string; name: string }>('select id, name from clients order by name'));
}

// ---------------------------------------------------------------- payments (admin only)

export async function recordPayment(user: SessionUser, raw: unknown) {
  requireRole(user, 'admin');
  const p = paymentInputSchema.parse(raw);
  const [row] = await asUser(user, (tx) =>
    tx.query<{ id: string }>(
      'insert into client_payments (client_id, amount, paid_on, note, created_by) values ($1, $2, $3, $4, $5) returning id',
      [p.clientId, p.amount, p.paidOn, p.note, user.id],
    ),
  );
  return row.id;
}

export async function deletePayment(user: SessionUser, paymentId: string) {
  requireRole(user, 'admin');
  await asUser(user, (tx) => tx.query('delete from client_payments where id = $1', [paymentId]));
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
      await insertProperty(tx, propertyInputSchema.parse({ clientId, address: r.address, lat: r.lat, lng: r.lng, instructions: r.instructions, serviceMinutes: r.serviceMinutes, active: true }), r.source);
      propertiesCreated++;
    }
  });
  return { clientsCreated, propertiesCreated, skippedExisting, invalidRows: preview.rows.length - valid.length, lookupFailures: failed, simulatedLocations: routing.simulated };
}
