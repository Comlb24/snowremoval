import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { addMinutes, localDate, localTime } from '@snow/core';
import {
  setConfig, loadConfig, useMemoryDb, asSystem, asAnon, asUser, seedDemoData, DEMO,
  createClient, createStatusLink, revokeStatusLinks, statusByToken, importCsv, getClient, clientOverview,
  createDraftRoute, setRouteStatus, reorderStops, getRouteDetail, moveStop,
  myRoutes, driverRoute, revealPhone, recordStopUpdate, addPhoto, startShift, getPhoto,
  runSchedulerTick, sendManualMessage, getMessenger, twilioMessenger, updateClient, createClientLogin,
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
    expect(JSON.stringify(r)).not.toMatch(/555/);
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
    expect(JSON.stringify(logRows)).not.toMatch(/555/);
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
