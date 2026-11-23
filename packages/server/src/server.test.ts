import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { addMinutes, localDate, localTime } from '@snow/core';
import {
  setConfig, loadConfig, useMemoryDb, asSystem, asAnon, asUser, seedDemoData, DEMO,
  createClient, createStatusLink, revokeStatusLinks, statusByToken, importCsv, getClient, clientOverview,
  createDraftRoute, setRouteStatus, reorderStops, getRouteDetail, moveStop,
  myRoutes, driverRoute, revealPhone, recordStopUpdate, addPhoto, startShift, getPhoto,
  runSchedulerTick, sendManualMessage, getMessenger, twilioMessenger, updateClient, createClientLogin,
  createAdmin, listAdmins, setAdminActive, verifySession, createSessionToken,
  resendMessenger, updateProperty, getProperty, listProperties, recordPayment, deletePayment, setPropertyActive, createProperty,
  type SessionUser,
} from './index';

const admin: SessionUser = { id: DEMO.admin, role: 'admin' };
const dana: SessionUser = { id: DEMO.driver1, role: 'driver' };
const sam: SessionUser = { id: DEMO.driver2, role: 'driver' };
const jane: SessionUser = { id: DEMO.clientUser, role: 'client' };
let todayRoute = '';

const count = async (sql: string, p: unknown[] = []) => (await asSystem((tx) => tx.query<{ n: number }>(sql, p)))[0].n;

beforeAll(async () => {
  setConfig(loadConfig({ APP_ENV: 'test', LOCAL_STORAGE_DIR: `/tmp/snow-test-photos-${process.pid}` } as any));
  await useMemoryDb();
  ({ todayRoute } = await seedDemoData());
}, 60_000);

describe('role isolation (database policies)', () => {
  it('driver sees only their own published routes', async () => {
    const mine = await myRoutes(dana);
    expect(mine.map((r) => r.id)).toContain(todayRoute);
    const other = await myRoutes(sam); // Sam only has a draft for tomorrow
    expect(other).toHaveLength(0);
    expect(await driverRoute(sam, todayRoute)).toBeNull();
  });

  it('drivers cannot read client contact details or notifications directly', async () => {
    const contacts = await asUser(dana, (tx) => tx.query('select * from client_contacts'));
    expect(contacts).toHaveLength(0);
    const notes = await asUser(dana, (tx) => tx.query('select * from notifications'));
    expect(notes).toHaveLength(0);
  });

  it('driver route data carries no phone numbers', async () => {
    const r = await driverRoute(dana, todayRoute);
    // Look for real phone numbers (+1506555…, 506-555-…), not "555" inside an ID or a timestamp's milliseconds.
    expect(JSON.stringify(r)).not.toMatch(/\+1506555|506\D?555/);
  });

  it('client sees only their own properties (and several of them)', async () => {
    const { properties } = await clientOverview(jane);
    expect(properties).toHaveLength(2);
    expect(properties.every((p: any) => /Maple|Birch/.test(p.address))).toBe(true);
    const others = await asUser(jane, (tx) => tx.query(`select * from properties where address not like '%Maple%' and address not like '%Birch%'`));
    expect(others).toHaveLength(0);
  });

  it('the public role cannot read any table', async () => {
    await expect(asAnon((tx) => tx.query('select * from properties'))).rejects.toThrow(/permission denied/);
  });

  it('a driver cannot use admin services', async () => {
    await expect(getClient(dana, randomUUID())).rejects.toThrow(/access/);
    await expect(asUser(dana, (tx) => tx.query(`update properties set instructions = 'x'`))).resolves.toEqual([]);
    expect(await count(`select count(*)::int as n from properties where instructions = 'x'`)).toBe(0);
  });
});

describe('phone number reveal', () => {
  it('works only for the assigned driver and is logged without the number', async () => {
    const r = await driverRoute(dana, todayRoute);
    const stopId = r!.stops[0].id;
    const { phone } = await revealPhone(dana, stopId);
    expect(phone).toMatch(/^\+1506555/);
    await expect(revealPhone(sam, stopId)).rejects.toThrow();
    const logRows = await asSystem((tx) => tx.query<any>('select * from phone_reveals where route_stop_id = $1', [stopId]));
    expect(logRows).toHaveLength(1);
    expect(JSON.stringify(logRows)).not.toMatch(/\+1506555|506\D?555/);
  });
});

describe('arrival estimates', () => {
  it('manual reordering changes estimates and replaces stale notifications', async () => {
    const before = await getRouteDetail(admin, todayRoute);
    const stops = before!.stops.filter((s: any) => s.status !== 'removed');
    const lastBefore = stops[stops.length - 1];
    await moveStop(admin, todayRoute, lastBefore.id, 'up');
    await moveStop(admin, todayRoute, lastBefore.id, 'up');
    const after = await getRouteDetail(admin, todayRoute);
    const moved = after!.stops.find((s: any) => s.id === lastBefore.id);
    expect(new Date(moved.est_arrival).getTime()).toBeLessThan(new Date(lastBefore.est_arrival).getTime());
    // exactly one live scheduled notification per stop after the reorder
    const dupes = await count(
      `select count(*)::int as n from (select route_stop_id from notifications where route_id = $1 and status = 'scheduled' group by route_stop_id having count(*) > 1) x`,
      [todayRoute],
    );
    expect(dupes).toBe(0);
    expect(await count(`select count(*)::int as n from notifications where route_id = $1 and status = 'cancelled'`, [todayRoute])).toBeGreaterThan(0);
  });
});

describe('notifications', () => {
  it('never uses a real messenger outside production', () => {
    expect(getMessenger().simulated).toBe(true);
    expect(() => twilioMessenger()).toThrow(/Refusing/);
    const c = loadConfig({ APP_ENV: 'development', MESSAGING_MODE: 'live', TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't', TWILIO_FROM_NUMBER: '+15005550006' } as any);
    expect(c.messagingMode).toBe('simulated');
  });

  it('scheduler is idempotent: repeated ticks create no duplicates', async () => {
    const n1 = await count('select count(*)::int as n from notifications where status <> $1', ['cancelled']);
    await runSchedulerTick();
    await runSchedulerTick();
    const n2 = await count('select count(*)::int as n from notifications where status <> $1', ['cancelled']);
    expect(n2).toBe(n1);
  });

  it('starting a shift does not message every client', async () => {
    const sentBefore = await count(`select count(*)::int as n from notifications where route_id = $1 and status in ('sent','failed')`, [todayRoute]);
    await startShift(dana, todayRoute);
    await runSchedulerTick();
    const sentAfter = await count(`select count(*)::int as n from notifications where route_id = $1 and status in ('sent','failed')`, [todayRoute]);
    expect(sentAfter).toBe(sentBefore);
  });

  it('late publication sends one immediate notification per stop, never historical ones', async () => {
    const start = addMinutes(new Date(), -45);
    const tz = 'America/Moncton';
    const props = await asSystem((tx) => tx.query<{ id: string }>(`select id from properties where address like '%Pine Glen%' or address like '%Hillcrest%'`));
    const routeId = await createDraftRoute(admin, {
      serviceDate: localDate(start, tz), plannedStartTime: localTime(start, tz), driverId: DEMO.driver2,
      startAddress: 'Depot', startLat: 46.11, startLng: -64.8, propertyIds: props.map((p) => p.id),
    });
    expect(await count('select count(*)::int as n from notifications where route_id = $1', [routeId])).toBe(0); // drafts never notify
    await setRouteStatus(admin, routeId, 'publish');
    await runSchedulerTick();
    await runSchedulerTick();
    const rows = await asSystem((tx) => tx.query<any>(`select status, kind, simulated, error from notifications where route_id = $1 and status <> 'cancelled'`, [routeId]));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.kind === 'initial' && r.simulated)).toBe(true);
    // The 555-0000 number fails in simulation: failure is recorded for the admin.
    expect(rows.filter((r) => r.status === 'failed')).toHaveLength(1);
    expect(rows.filter((r) => r.status === 'sent')).toHaveLength(1);
  });

  it('pausing a route cancels its pending notifications', async () => {
    await setRouteStatus(admin, todayRoute, 'pause');
    expect(await count(`select count(*)::int as n from notifications where route_id = $1 and status = 'scheduled'`, [todayRoute])).toBe(0);
    await setRouteStatus(admin, todayRoute, 'resume');
    expect(await count(`select count(*)::int as n from notifications where route_id = $1 and status = 'scheduled'`, [todayRoute])).toBeGreaterThan(0);
  });

  it('manual messages skip opted-out clients', async () => {
    const d = await getRouteDetail(admin, todayRoute);
    const c = await getClient(admin, d!.stops[0].client_id);
    await updateClient(admin, c!.client.id, { name: c!.client.name, phone: c!.client.phone, notifyChannel: 'sms', optedOut: true });
    const res = await sendManualMessage(admin, { target: { type: 'route', routeId: todayRoute }, body: 'Crews are running late due to heavy snow.' });
    expect(res.skippedOptedOut).toBeGreaterThanOrEqual(1);
    expect(res.queued).toBeGreaterThan(0);
    const scheduledForOptedOut = await count(`select count(*)::int as n from notifications where client_id = $1 and status = 'scheduled'`, [c!.client.id]);
    expect(scheduledForOptedOut).toBe(0);
    await updateClient(admin, c!.client.id, { name: c!.client.name, phone: c!.client.phone, notifyChannel: 'sms', optedOut: false });
  });
});

describe('driver workflow and status page', () => {
  it('completes a stop without a photo; status link updates; retries apply once', async () => {
    const r = await driverRoute(dana, todayRoute);
    const stop = r!.stops.find((s: any) => s.status === 'pending')!;
    const { token } = await createStatusLink(admin, stop.property_id);
    expect((await statusByToken(token))!.stop!.status).toBe('pending');

    const update = { clientUuid: randomUUID(), stopId: stop.id, status: 'completed' as const, occurredAt: new Date().toISOString() };
    const results = [await recordStopUpdate(dana, update), await recordStopUpdate(dana, update), await recordStopUpdate(dana, update)];
    expect(results.map((x) => x.result)).toEqual(['applied', 'duplicate', 'duplicate']);
    expect(await count('select count(*)::int as n from visit_updates where client_uuid = $1', [update.clientUuid])).toBe(1);
    expect(await count('select count(*)::int as n from visits where route_stop_id = $1', [stop.id])).toBe(1);

    const status = await statusByToken(token);
    expect(status!.stop!.status).toBe('completed');
    expect(status!.stop!.hasPhoto).toBe(false);

    // Completed stops get no further notifications.
    expect(await count(`select count(*)::int as n from notifications where route_stop_id = $1 and status = 'scheduled'`, [stop.id])).toBe(0);

    await revokeStatusLinks(admin, stop.property_id);
    expect(await statusByToken(token)).toBeNull();
    expect(await statusByToken('x'.repeat(43))).toBeNull();
  });

  it('photos are optional, stored once on retry, and private', async () => {
    const r = await driverRoute(dana, todayRoute);
    const stop = r!.stops.find((s: any) => s.status === 'pending')!;
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]);
    const meta = { clientUuid: randomUUID(), stopId: stop.id, contentType: 'image/jpeg' };
    const a = await addPhoto(dana, meta, bytes);
    const b = await addPhoto(dana, meta, bytes);
    expect(a.photoId).toBe(b.photoId);
    expect(b.result).toBe('duplicate');
    expect(await count('select count(*)::int as n from visit_photos where route_stop_id = $1', [stop.id])).toBe(1);
    expect(await count('select photo_count as n from visits where route_stop_id = $1', [stop.id])).toBe(1);
    await recordStopUpdate(dana, { clientUuid: randomUUID(), stopId: stop.id, status: 'completed', occurredAt: new Date().toISOString() });

    expect(await getPhoto(dana, a.photoId)).not.toBeNull();
    expect(await getPhoto(admin, a.photoId)).not.toBeNull();
    expect(await getPhoto(sam, a.photoId)).toBeNull();
    await expect(addPhoto(sam, { ...meta, clientUuid: randomUUID() }, bytes)).rejects.toThrow();
  });

  it('blocked stops are recorded with a reason', async () => {
    const r = await driverRoute(dana, todayRoute);
    const stop = r!.stops.find((s: any) => s.status === 'pending')!;
    await recordStopUpdate(dana, { clientUuid: randomUUID(), stopId: stop.id, status: 'blocked', blockReason: 'Vehicle in driveway', occurredAt: new Date().toISOString() });
    const d = await getRouteDetail(admin, todayRoute);
    const s = d!.stops.find((x: any) => x.id === stop.id);
    expect(s.status).toBe('blocked');
    expect(s.block_reason).toBe('Vehicle in driveway');
  });
});

describe('admin data', () => {
  it('CSV import creates one client with several properties', async () => {
    const csv = 'client_name,phone,address,service_minutes\nNew Person,506-555-0190,1 First St Moncton,15\nNew Person,506-555-0190,2 Second St Moncton,20\n';
    const res = await importCsv(admin, csv);
    expect(res.clientsCreated).toBe(1);
    expect(res.propertiesCreated).toBe(2);
    expect(res.simulatedLocations).toBe(true);
    const again = await importCsv(admin, csv);
    expect(again.clientsCreated).toBe(0);
    expect(again.skippedExisting).toBe(2);
  });

  it('gives a client a sign-in that sees only their own properties', async () => {
    const clientId = await createClient(admin, { name: 'Login Test', phone: '506-555-0191', notifyChannel: 'sms' }, { address: '9 Login St', lat: 46.1, lng: -64.8, instructions: '', serviceMinutes: 15, active: true });
    const id = await createClientLogin(admin, clientId, { fullName: 'Login Test', email: 'Login.Test@Example.com' });
    const me: SessionUser = { id, role: 'client' };
    const { properties } = await clientOverview(me);
    expect(properties.map((p: any) => p.address)).toEqual(['9 Login St']);
    await expect(createClientLogin(admin, clientId, { fullName: 'X', email: 'x2@example.com' })).rejects.toThrow(/already/);
    await expect(createClientLogin(dana as any, clientId, { fullName: 'X', email: 'x3@example.com' })).rejects.toThrow(/access/);
  });

  it('validates client input', async () => {
    await expect(createClient(admin, { name: 'X', phone: '12', notifyChannel: 'sms' })).rejects.toThrow(/valid phone/);
  });

  it('reorderStops ignores unknown ids safely', async () => {
    await expect(reorderStops(admin, todayRoute, [randomUUID()])).resolves.toBeTruthy();
  });
});

describe('team members (admins)', () => {
  it('an admin can give another person admin access, and remove it again', async () => {
    const id = await createAdmin(admin, { fullName: 'Pat Helper', email: 'Pat@Example.com', password: 'temp-pass-123' });
    const list = await listAdmins(admin);
    expect(list.find((a) => a.id === id)).toMatchObject({ full_name: 'Pat Helper', email: 'pat@example.com', active: true });
    const pat = { id, role: 'admin' as const };
    expect((await verifySession(await createSessionToken(id)))?.role).toBe('admin');
    // The new admin can manage the team too.
    expect((await listAdmins(pat)).length).toBeGreaterThanOrEqual(2);
    await setAdminActive(admin, id, false);
    expect(await verifySession(await createSessionToken(id))).toBeNull();
    await setAdminActive(admin, id, true);
    expect(await verifySession(await createSessionToken(id))).not.toBeNull();
  });

  it('blocks duplicate emails, self-removal and non-admins', async () => {
    await expect(createAdmin(admin, { fullName: 'Again', email: 'pat@example.com', password: 'temp-pass-123' })).rejects.toThrow(/already has an account/);
    await expect(setAdminActive(admin, admin.id, false)).rejects.toThrow(/your own access/);
    await expect(createAdmin(dana, { fullName: 'X', email: 'x@example.com' })).rejects.toThrow();
    await expect(listAdmins(jane)).rejects.toThrow();
  });
});

describe('properties, quotes and payments', () => {
  it('saves equipment and shows it to the driver, but never quotes or office notes', async () => {
    const r = await driverRoute(dana, todayRoute);
    const stop = r!.stops[0];
    const before = await getProperty(admin, stop.property_id);
    await updateProperty(admin, stop.property_id, {
      clientId: before.client_id, address: before.address, lat: before.lat, lng: before.lng, instructions: before.instructions,
      serviceMinutes: before.service_minutes, active: true, equipment: ['snowblower', 'snowplow', 'snowplow'], quotedAmount: '$1,250.50', officeNotes: 'Pays late',
    });
    const after = await getProperty(admin, stop.property_id);
    expect(after).toMatchObject({ equipment: ['snowblower', 'snowplow'], quoted_amount: 1250.5, office_notes: 'Pays late' });

    const driverView = await driverRoute(dana, todayRoute);
    expect(driverView!.stops[0].equipment).toEqual(['snowblower', 'snowplow']);
    expect(JSON.stringify(driverView)).not.toMatch(/1250\.5|Pays late/);
    // Direct reads of the admin-only tables return nothing for drivers and clients.
    for (const u of [dana, jane]) {
      expect(await asUser(u, (tx) => tx.query('select * from property_admin_details'))).toHaveLength(0);
      expect(await asUser(u, (tx) => tx.query('select * from client_payments'))).toHaveLength(0);
    }
    await expect(listProperties(dana)).rejects.toThrow();
  });

  it('rejects unknown equipment and bad amounts', async () => {
    const [p] = await listProperties(admin);
    const full = await getProperty(admin, p.id);
    const base = { clientId: full.client_id, address: full.address, lat: full.lat, lng: full.lng };
    await expect(updateProperty(admin, p.id, { ...base, equipment: ['shovel'] })).rejects.toThrow();
    await expect(updateProperty(admin, p.id, { ...base, quotedAmount: 'lots' })).rejects.toThrow(/amount/);
    await expect(updateProperty(admin, p.id, { ...base, quotedAmount: '-5' })).rejects.toThrow(/negative/);
  });

  it('works out the balance from active property quotes minus payments', async () => {
    const clientId = await createClient(admin, { name: 'Balance Test', phone: '506-555-0192', notifyChannel: 'sms' });
    const a = await createProperty(admin, { clientId, address: '1 Quote St', lat: 46.1, lng: -64.8, quotedAmount: '700' });
    await createProperty(admin, { clientId, address: '2 Quote St', lat: 46.1, lng: -64.8, quotedAmount: '500' });
    const pay = await recordPayment(admin, { clientId, amount: '800', paidOn: '2026-11-03', note: 'e-transfer' });
    let d = await getClient(admin, clientId);
    expect(d!.money).toEqual({ quotedTotal: 1200, paidTotal: 800, balance: 400 });
    expect(d!.payments[0]).toMatchObject({ amount: 800, paid_on: '2026-11-03', note: 'e-transfer' });

    await setPropertyActive(admin, a, false); // inactive properties do not count
    d = await getClient(admin, clientId);
    expect(d!.money.balance).toBe(-300);

    await deletePayment(admin, pay);
    d = await getClient(admin, clientId);
    expect(d!.money).toEqual({ quotedTotal: 500, paidTotal: 0, balance: 500 });
    await expect(recordPayment(admin, { clientId, amount: '0', paidOn: '2026-11-03' })).rejects.toThrow(/more than/);
    await expect(recordPayment(dana, { clientId, amount: '10', paidOn: '2026-11-03' })).rejects.toThrow();
  });

  it('moves a property to a different owner', async () => {
    const from = await createClient(admin, { name: 'Owner One', phone: '506-555-0193', notifyChannel: 'sms' });
    const to = await createClient(admin, { name: 'Owner Two', phone: '506-555-0194', notifyChannel: 'sms' });
    const id = await createProperty(admin, { clientId: from, address: '3 Move St', lat: 46.1, lng: -64.8, quotedAmount: '300' });
    await updateProperty(admin, id, { clientId: to, address: '3 Move St', lat: 46.1, lng: -64.8, quotedAmount: '300' });
    expect((await getClient(admin, from))!.properties).toHaveLength(0);
    expect((await getClient(admin, to))!.money.quotedTotal).toBe(300);
  });
});

describe('service updates by email', () => {
  const tz = 'America/Moncton';
  async function routeFor(clientId: string, startOffsetMinutes: number) {
    const [p] = await asSystem((tx) => tx.query<{ id: string }>('select id from properties where client_id = $1', [clientId]));
    const start = addMinutes(new Date(), startOffsetMinutes);
    const routeId = await createDraftRoute(admin, {
      serviceDate: localDate(start, tz), plannedStartTime: localTime(start, tz), driverId: DEMO.driver2,
      startAddress: 'Depot', startLat: 46.11, startLng: -64.8, propertyIds: [p.id],
    });
    await setRouteStatus(admin, routeId, 'publish');
    await runSchedulerTick();
    return routeId;
  }
  const rowsFor = (routeId: string) =>
    asSystem((tx) => tx.query<any>(`select channel, to_address, subject, body, status, simulated, cancel_reason, error from notifications where route_id = $1 order by created_at`, [routeId]));

  it('needs an email address before email can be chosen', async () => {
    await expect(createClient(admin, { name: 'No Email', phone: '506-555-0180', notifyChannel: 'email' })).rejects.toThrow(/email address/);
  });

  it('sends the arrival window to the email address, with a subject, simulated outside production', async () => {
    const clientId = await createClient(admin, { name: 'Erin Email', phone: '506-555-0181', email: 'erin@example.com', notifyChannel: 'email' }, { address: '1 Inbox Rd', lat: 46.1, lng: -64.8 });
    const rows = await rowsFor(await routeFor(clientId, -45));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ channel: 'email', to_address: 'erin@example.com', status: 'sent', simulated: true });
    expect(rows[0].subject).toMatch(/^Snow removal at 1 Inbox Rd today/);
    expect(rows[0].body).toMatch(/^Hi Erin,/);
    expect(rows[0].body).not.toMatch(/\+1506555|506\D?555/);
  });

  it('switching from email to SMS replaces a waiting email with a text', async () => {
    const clientId = await createClient(admin, { name: 'Sam Switch', phone: '506-555-0182', email: 'sam@example.com', notifyChannel: 'email' }, { address: '2 Switch St', lat: 46.1, lng: -64.8 });
    const routeId = await routeFor(clientId, 240);
    expect((await rowsFor(routeId)).map((r) => [r.channel, r.status])).toEqual([['email', 'scheduled']]);
    await updateClient(admin, clientId, { name: 'Sam Switch', phone: '506-555-0182', email: 'sam@example.com', notifyChannel: 'sms', optedOut: false });
    const rows = await rowsFor(routeId);
    expect(rows.map((r) => [r.channel, r.status, r.to_address])).toEqual([['email', 'cancelled', 'sam@example.com'], ['sms', 'scheduled', '+15065550182']]);
    expect(rows[0].cancel_reason).toBe('Contact method changed');
  });

  it('a manual message goes by email, and a bad address is reported as failed', async () => {
    const clientId = await createClient(admin, { name: 'Fay Fail', phone: '506-555-0183', email: 'fail@example.com', notifyChannel: 'email' });
    const res = await sendManualMessage(admin, { target: { type: 'client', clientId }, body: 'Heavy snow tonight. Crews start at 4 a.m.' });
    expect(res.queued).toBe(1);
    const [n] = await asSystem((tx) => tx.query<any>('select channel, to_address, subject, status, error from notifications where client_id = $1', [clientId]));
    expect(n).toMatchObject({ channel: 'email', to_address: 'fail@example.com', status: 'failed' });
    expect(n.subject).toMatch(/Service update from/);
    expect(n.error).toMatch(/Simulated failure: email/);
  });

  it('never uses real email outside production', () => {
    expect(getMessenger('email').simulated).toBe(true);
    expect(() => resendMessenger()).toThrow(/Refusing/);
    const dev = loadConfig({ APP_ENV: 'development', MESSAGING_MODE: 'live', RESEND_API_KEY: 're_x', EMAIL_FROM: 'a@b.c' } as any);
    expect(dev.emailMode).toBe('simulated');
    const prod = loadConfig({ APP_ENV: 'production', SESSION_SECRET: 'x'.repeat(32), MESSAGING_MODE: 'live', RESEND_API_KEY: 're_x', EMAIL_FROM: 'a@b.c' } as any);
    expect(prod.emailMode).toBe('live');
    expect(prod.messagingMode).toBe('simulated'); // no Twilio values: SMS stays simulated
  });
});

describe('resident contact on a property', () => {
  const tz = 'America/Moncton';
  async function publishFor(propertyId: string, startOffsetMinutes: number) {
    const start = addMinutes(new Date(), startOffsetMinutes);
    const routeId = await createDraftRoute(admin, {
      serviceDate: localDate(start, tz), plannedStartTime: localTime(start, tz), driverId: DEMO.driver1,
      startAddress: 'Depot', startLat: 46.11, startLng: -64.8, propertyIds: [propertyId],
    });
    await setRouteStatus(admin, routeId, 'publish');
    await runSchedulerTick();
    return routeId;
  }
  const rowsFor = (routeId: string) =>
    asSystem((tx) => tx.query<any>(`select client_id, channel, to_address, subject, body, status, cancel_reason from notifications where route_id = $1 order by created_at`, [routeId]));
  const base = { address: '10 Rental Row', lat: 46.1, lng: -64.8 };

  it('sends updates to the resident instead of the owner, by the resident’s method', async () => {
    const ownerId = await createClient(admin, { name: 'Olivia Owner', phone: '506-555-0170', email: 'olivia@example.com', notifyChannel: 'sms' });
    const id = await createProperty(admin, { ...base, clientId: ownerId, resident: { name: 'Rita Resident', email: 'rita@example.com', notifyChannel: 'email' } });
    const rows = await rowsFor(await publishFor(id, -45));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ client_id: ownerId, channel: 'email', to_address: 'rita@example.com', status: 'sent' });
    expect(rows[0].body).toMatch(/^Hi Rita,/);
    expect(JSON.stringify(rows)).not.toMatch(/olivia|Olivia|\+15065550170/);
    expect(await getProperty(admin, id)).toMatchObject({ has_resident: true, resident_name: 'Rita Resident', resident_channel: 'email' });
  });

  it('clearing the resident sends waiting updates back to the owner', async () => {
    const ownerId = await createClient(admin, { name: 'Oscar Owner', phone: '506-555-0171', notifyChannel: 'sms' });
    const id = await createProperty(admin, { ...base, address: '11 Rental Row', clientId: ownerId, resident: { name: '', phone: '506-555-0172', notifyChannel: 'sms' } });
    const routeId = await publishFor(id, 240);
    expect((await rowsFor(routeId)).map((r) => [r.to_address, r.status])).toEqual([['+15065550172', 'scheduled']]);
    // A save that leaves the resident out keeps it.
    await updateProperty(admin, id, { ...base, address: '11 Rental Row', clientId: ownerId });
    expect((await getProperty(admin, id)).has_resident).toBe(true);
    await updateProperty(admin, id, { ...base, address: '11 Rental Row', clientId: ownerId, resident: null });
    const rows = await rowsFor(routeId);
    expect(rows.map((r) => [r.to_address, r.status])).toEqual([['+15065550172', 'cancelled'], ['+15065550171', 'scheduled']]);
    expect(rows[0].cancel_reason).toBe('Contact method changed');
  });

  it('the driver reaches the resident’s phone; drivers and clients cannot read resident details', async () => {
    const ownerId = await createClient(admin, { name: 'Pat Owner', phone: '506-555-0173', notifyChannel: 'sms' });
    const id = await createProperty(admin, { ...base, address: '12 Rental Row', clientId: ownerId, resident: { name: 'Ray', phone: '506-555-0174', notifyChannel: 'sms' } });
    const routeId = await publishFor(id, 240);
    const r = await driverRoute(dana, routeId);
    expect((await revealPhone(dana, r!.stops[0].id)).phone).toBe('+15065550174');
    expect(JSON.stringify(r)).not.toMatch(/\+15065550174|Ray/);
    for (const u of [dana, jane]) expect(await asUser(u, (tx) => tx.query('select * from property_residents'))).toHaveLength(0);
  });

  it('the private status link greets the resident, and the owner when there is none', async () => {
    const ownerId = await createClient(admin, { name: 'Sky Owner', phone: '506-555-0177', notifyChannel: 'sms' });
    const id = await createProperty(admin, { ...base, address: '13 Rental Row', clientId: ownerId, resident: { name: 'Tess Tenant', phone: '506-555-0178' } });
    const { token } = await createStatusLink(admin, id);
    expect((await statusByToken(token))!.firstName).toBe('Tess');
    await updateProperty(admin, id, { ...base, address: '13 Rental Row', clientId: ownerId, resident: { name: '', phone: '506-555-0178' } });
    expect((await statusByToken(token))!.firstName).toBe('');
    await updateProperty(admin, id, { ...base, address: '13 Rental Row', clientId: ownerId, resident: null });
    expect((await statusByToken(token))!.firstName).toBe('Sky');
  });

  it('checks the resident has a contact for the chosen method', async () => {
    const ownerId = await createClient(admin, { name: 'Quinn Owner', phone: '506-555-0175', notifyChannel: 'sms' });
    await expect(createProperty(admin, { ...base, clientId: ownerId, resident: { name: 'Only Name' } })).rejects.toThrow(/phone or email/);
    await expect(createProperty(admin, { ...base, clientId: ownerId, resident: { phone: '506-555-0176', notifyChannel: 'email' } })).rejects.toThrow(/resident’s email/);
    await expect(createProperty(admin, { ...base, clientId: ownerId, resident: { email: 'a@example.com', notifyChannel: 'sms' } })).rejects.toThrow(/resident’s phone/);
    await expect(createProperty(admin, { ...base, clientId: ownerId, resident: { phone: '12', notifyChannel: 'sms' } })).rejects.toThrow(/valid phone/);
  });
});
