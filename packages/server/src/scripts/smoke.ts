// End-to-end check against the real database (Supabase). Usage: npm run setup:smoke
// Everything runs inside ONE database transaction that is rolled back at the end, so no test data stays.
// The only thing outside the database is one tiny test photo in private storage, which is deleted afterwards.
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import './load-env.ts';
import { loadConfig, setConfig } from '../env.ts';
import { localDate, addMinutes } from '@snow/core';

const c = loadConfig();
setConfig(c);
if (!c.databaseUrl) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const results: [boolean, string][] = [];
const check = (ok: boolean, msg: string) => {
  results.push([ok, msg]);
  console.log(`${ok ? '✓' : '✕'} ${msg}`);
};
class Rollback extends Error {}

const sql = postgres(c.databaseUrl, { prepare: false, max: 1, onnotice: () => {} });
let photoKey: string | null = null;

try {
  await sql.begin(async (outer) => {
    // Route every app transaction into a savepoint of the outer transaction.
    const q = async <T>(t: any, s: string, p?: unknown[]) => (await t.unsafe(s, p as any[])) as unknown as T[];
    const driver = {
      kind: 'postgres' as const,
      query: <T>(s: string, p?: unknown[]) => q<T>(outer, s, p),
      exec: async (s: string) => void (await outer.unsafe(s)),
      transaction: <T>(fn: (tx: any) => Promise<T>) =>
        outer.savepoint(async (sp) => {
          try {
            return await fn({ query: (s: string, p?: unknown[]) => q(sp, s, p) });
          } finally {
            // SET LOCAL lasts until the end of the outer transaction, so undo it after each step.
            await sp.unsafe('reset role');
            await sp.unsafe(`select set_config('request.jwt.claims', '', true)`);
          }
        }) as Promise<T>,
      close: async () => {},
    };
    (globalThis as any).__snowDb = Promise.resolve(driver);
    const S = await import('../index.ts');

    // Test accounts (only inside this transaction).
    const ids = { admin: randomUUID(), driver: randomUUID(), other: randomUUID(), client: randomUUID() };
    for (const [k, id] of Object.entries(ids)) {
      await outer.unsafe('insert into auth.users (id, email, aud, role) values ($1, $2, $3, $3)', [id, `${k}-${id.slice(0, 8)}@smoke.test`, 'authenticated']);
      await outer.unsafe('insert into public.profiles (id, role, full_name, email) values ($1, $2, $3, $4)', [
        id, k === 'other' ? 'driver' : k, `Smoke ${k}`, `${k}@smoke.test`,
      ]);
    }
    const admin = { id: ids.admin, role: 'admin' as const };
    const drv = { id: ids.driver, role: 'driver' as const };
    const other = { id: ids.other, role: 'driver' as const };
    const cli = { id: ids.client, role: 'client' as const };

    const clientId = await S.createClient(admin, { name: 'Smoke Test Client', phone: '506-555-0199', notifyChannel: 'sms' },
      { address: '1 Smoke Test Rd, Moncton, NB', lat: 46.09, lng: -64.79, instructions: 'Test', serviceMinutes: 15, active: true });
    await S.createProperty(admin, { clientId, address: '2 Smoke Test Rd, Moncton, NB', lat: 46.1, lng: -64.77, instructions: '', serviceMinutes: 20, active: true });
    await outer.unsafe('update public.clients set user_id = $1 where id = $2', [ids.client, clientId]);
    const props = await S.listActiveProperties(admin);
    check(props.filter((p: any) => p.client_name === 'Smoke Test Client').length === 2, 'Admin adds a client with two properties');

    const start = addMinutes(new Date(), 24 * 60);
    const routeId = await S.createDraftRoute(admin, {
      serviceDate: localDate(start, c.timeZone), plannedStartTime: '07:00', driverId: ids.driver,
      startAddress: c.defaultStart.address, startLat: c.defaultStart.lat, startLng: c.defaultStart.lng,
      propertyIds: props.filter((p: any) => p.client_name === 'Smoke Test Client').map((p: any) => p.id),
    });
    check(!!routeId, 'Admin creates a route with a suggested order');
    const before = await S.getRouteDetail(admin, routeId);
    const last = before!.stops[before!.stops.length - 1];
    await S.moveStop(admin, routeId, last.id, 'up');
    const after = await S.getRouteDetail(admin, routeId);
    check(new Date(after!.stops.find((s: any) => s.id === last.id).est_arrival) < new Date(last.est_arrival), 'Reordering recalculates arrival estimates');
    check((await S.myRoutes(drv)).length === 0, 'Driver cannot see the draft');
    await S.setRouteStatus(admin, routeId, 'publish');
    const scheduled = await S.listCommunications(admin, { routeId, status: 'scheduled' });
    check(scheduled.length === 2 && scheduled.every((n: any) => n.simulated), 'Publishing schedules one simulated message per stop');

    check((await S.myRoutes(drv)).some((r: any) => r.id === routeId), 'Assigned driver sees the published route');
    check((await S.myRoutes(other)).length === 0, 'Another driver cannot see it');
    const dr = await S.driverRoute(drv, routeId);
    check(!JSON.stringify(dr).includes('555'), 'Driver route data has no phone numbers');
    const stopId = dr!.stops[0].id;
    check((await S.revealPhone(drv, stopId)).phone === '+15065550199', 'Phone revealed only on request');
    let refused = false;
    try { await S.revealPhone(other, stopId); } catch { refused = true; }
    check(refused, 'Another driver cannot reveal the phone');

    const { token } = await S.createStatusLink(admin, dr!.stops[0].property_id);
    check((await S.statusByToken(token))?.stop?.status === 'pending', 'Status link works without sign-in');
    await S.startShift(drv, routeId);
    const upd = { clientUuid: randomUUID(), stopId, status: 'completed' as const, occurredAt: new Date().toISOString() };
    const r1 = await S.recordStopUpdate(drv, upd);
    const r2 = await S.recordStopUpdate(drv, upd);
    check(r1.result === 'applied' && r2.result === 'duplicate', 'Stop completed without a photo; a retry applies once');
    const st = await S.statusByToken(token);
    check(st?.stop?.status === 'completed' && st.stop.hasPhoto === false, 'Status page shows completed, no photo');

    const photo = await S.addPhoto(drv, { clientUuid: randomUUID(), stopId: dr!.stops[1].id, contentType: 'image/jpeg' }, new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]));
    const [{ storage_path }] = await outer.unsafe('select storage_path from public.visit_photos where id = $1', [photo.photoId]);
    photoKey = storage_path;
    check(!!(await S.getPhoto(admin, photo.photoId)), 'Photo uploaded to private Supabase storage and readable by admin');
    check((await S.getPhoto(other, photo.photoId)) === null, 'Another driver cannot read the photo');

    const ov = await S.clientOverview(cli);
    check(ov.properties.length === 2, 'Client sign-in sees only their own two properties');
    const tick = await S.runSchedulerTick();
    check(tick.failed === 0, 'Scheduler runs on Supabase');

    throw new Rollback();
  });
} catch (e) {
  if (!(e instanceof Rollback)) check(false, `Unexpected error: ${(e as Error).message}`);
} finally {
  if (photoKey) {
    const { supabaseAdmin } = await import('../adapters/supabase.ts');
    const { error } = await supabaseAdmin().storage.from('visit-photos').remove([photoKey]);
    check(!error, 'Test photo deleted from storage');
  }
  const [{ n }] = await sql`select count(*)::int as n from public.clients where name = 'Smoke Test Client'`;
  check(n === 0, 'All test data rolled back (nothing left in the database)');
  await sql.end();
}
const failed = results.filter(([ok]) => !ok).length;
console.log(failed ? `\n${failed} check(s) failed.` : '\nAll checks passed.');
process.exit(failed ? 1 : 0);
