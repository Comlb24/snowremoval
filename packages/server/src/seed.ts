import { localDate, localTime, addMinutes } from '@snow/core';
import { asSystem, type SessionUser } from './db';
import { config } from './env';
import { log } from './log';
import { createClient, createProperty } from './services/clients';
import { createDraftRoute, setRouteStatus } from './services/routes';

/** Fixed IDs so the demo accounts are easy to find. All data is synthetic (555-01xx numbers, made-up names). */
export const DEMO = {
  admin: '00000000-0000-4000-a000-000000000001',
  driver1: '00000000-0000-4000-a000-000000000002',
  driver2: '00000000-0000-4000-a000-000000000003',
  clientUser: '00000000-0000-4000-a000-000000000004',
};

const CLIENTS: { name: string; phone: string; channel: 'sms' | 'voice'; email?: string; properties: { address: string; lat: number; lng: number; instructions: string; minutes: number }[] }[] = [
  { name: 'Jane Doe', phone: '506-555-0101', channel: 'sms', email: 'jane@example.com', properties: [
    { address: '12 Maple Ave, Moncton, NB', lat: 46.0942, lng: -64.7905, instructions: 'Clear to the garage door. Mind the flower bed on the left.', minutes: 15 },
    { address: '48 Birch Lane, Dieppe, NB', lat: 46.0989, lng: -64.7243, instructions: 'Rental unit. Shovel the side path too.', minutes: 20 },
  ] },
  { name: 'Marc Leblanc', phone: '506-555-0102', channel: 'voice', properties: [
    { address: '7 Elmwood Dr, Moncton, NB', lat: 46.1072, lng: -64.8128, instructions: 'Long driveway. Push snow to the right side.', minutes: 25 },
  ] },
  { name: 'Priya Singh', phone: '506-555-0103', channel: 'sms', properties: [
    { address: '220 Mountain Rd, Moncton, NB', lat: 46.1031, lng: -64.8237, instructions: 'Gate code 4512.', minutes: 15 },
  ] },
  { name: 'Tom Richard', phone: '506-555-0104', channel: 'sms', properties: [
    { address: '91 Pine Glen Rd, Riverview, NB', lat: 46.0612, lng: -64.8034, instructions: '', minutes: 10 },
  ] },
  { name: 'Chloé Cormier', phone: '506-555-0105', channel: 'sms', properties: [
    { address: '15 Acadie Ave, Dieppe, NB', lat: 46.0923, lng: -64.7351, instructions: 'Corner lot. Also clear the sidewalk ramp.', minutes: 20 },
  ] },
  { name: 'Grace Wong', phone: '506-555-0106', channel: 'sms', properties: [
    { address: '303 St George Blvd, Moncton, NB', lat: 46.0889, lng: -64.7987, instructions: 'Back lane access only.', minutes: 15 },
  ] },
  // This number ends in 0000: the simulated messenger fails it, to show failed delivery in the admin.
  { name: 'Ben Unreachable', phone: '506-555-0000', channel: 'sms', properties: [
    { address: '5 Hillcrest Ct, Riverview, NB', lat: 46.0551, lng: -64.8211, instructions: '', minutes: 10 },
  ] },
];

export async function seedDemoData(now = new Date()) {
  const c = config();
  await asSystem(async (tx) => {
    const users = [
      [DEMO.admin, 'admin', 'Alex Admin', 'admin@demo.test'],
      [DEMO.driver1, 'driver', 'Dana Driver', 'dana@demo.test'],
      [DEMO.driver2, 'driver', 'Sam Plow', 'sam@demo.test'],
      [DEMO.clientUser, 'client', 'Jane Doe', 'jane@demo.test'],
    ];
    for (const [id, role, name, email] of users) {
      await tx.query('insert into auth.users (id, email) values ($1, $2) on conflict do nothing', [id, email]);
      await tx.query('insert into profiles (id, role, full_name, email) values ($1, $2, $3, $4) on conflict do nothing', [id, role, name, email]);
    }
  });
  const admin: SessionUser = { id: DEMO.admin, role: 'admin' };
  const propertyIds: string[] = [];
  let janeId = '';
  for (const cl of CLIENTS) {
    const [first, ...rest] = cl.properties;
    const id = await createClient(
      admin,
      { name: cl.name, phone: cl.phone, email: cl.email, notifyChannel: cl.channel, optedOut: false },
      { address: first.address, lat: first.lat, lng: first.lng, instructions: first.instructions, serviceMinutes: first.minutes, active: true },
    );
    if (cl.name === 'Jane Doe') janeId = id;
    for (const p of rest) {
      await createProperty(admin, { clientId: id, address: p.address, lat: p.lat, lng: p.lng, instructions: p.instructions, serviceMinutes: p.minutes, active: true });
    }
  }
  await asSystem((tx) => tx.query('update clients set user_id = $1 where id = $2', [DEMO.clientUser, janeId]));
  const all = await asSystem((tx) => tx.query<{ id: string; address: string }>('select id, address from properties order by address'));
  propertyIds.push(...all.map((p) => p.id));

  // Today's route starts about three hours from now (rounded), so its notifications are in the future.
  const start = new Date(Math.ceil(addMinutes(now, 180).getTime() / 900_000) * 900_000);
  const todayRoute = await createDraftRoute(admin, {
    serviceDate: localDate(start, c.timeZone),
    plannedStartTime: localTime(start, c.timeZone),
    driverId: DEMO.driver1,
    startAddress: c.defaultStart.address,
    startLat: c.defaultStart.lat,
    startLng: c.defaultStart.lng,
    propertyIds: propertyIds.slice(0, 6),
  });
  await setRouteStatus(admin, todayRoute, 'publish');

  const tomorrow = localDate(addMinutes(now, 24 * 60), c.timeZone);
  await createDraftRoute(admin, {
    serviceDate: tomorrow,
    plannedStartTime: '07:00',
    driverId: DEMO.driver2,
    startAddress: c.defaultStart.address,
    startLat: c.defaultStart.lat,
    startLng: c.defaultStart.lng,
    propertyIds: propertyIds.slice(4),
  });
  log.info('Demo data created');
  return { todayRoute };
}

/** Seed once, on first start of an empty local database (development only). */
export async function ensureDemoData() {
  // Only the local embedded database ever gets demo data — never a real (Supabase) database.
  if (config().appEnv === 'production' || config().databaseUrl) return;
  const [row] = await asSystem((tx) => tx.query<{ n: number }>('select count(*)::int as n from profiles'));
  if (row.n === 0) await seedDemoData();
}
