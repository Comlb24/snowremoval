'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { ZodError } from 'zod';
import * as S from '@snow/server';
import type { RouteDraftInput } from '@snow/core';
import { requirePageRole } from '@/lib/session';

const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const msg = (e: unknown) => (e instanceof ZodError ? e.issues.map((i) => i.message).join('; ') : e instanceof Error ? e.message : String(e));
const back = (path: string, e: unknown): never => redirect(`${path}${path.includes('?') ? '&' : '?'}error=${encodeURIComponent(msg(e))}`);

async function locate(user: S.SessionUser, address: string, lat: string, lng: string) {
  if (lat && lng) return { lat: Number(lat), lng: Number(lng), source: 'manual' };
  const g = await S.geocodeAddress(user, address);
  if (!g) throw new Error('Address not found. Enter the latitude and longitude instead.');
  return { lat: g.lat, lng: g.lng, source: g.source };
}

// ---------------------------------------------------------------- clients & properties
export async function createClientAction(f: FormData) {
  const user = await requirePageRole('admin');
  let id = '';
  try {
    const loc = await locate(user, str(f, 'address'), str(f, 'lat'), str(f, 'lng'));
    id = await S.createClient(
      user,
      { name: str(f, 'name'), phone: str(f, 'phone'), email: str(f, 'email'), notifyChannel: str(f, 'notifyChannel') || 'sms', optedOut: false },
      { address: str(f, 'address'), lat: loc.lat, lng: loc.lng, instructions: str(f, 'instructions'), serviceMinutes: Number(str(f, 'serviceMinutes') || 15), active: true, source: loc.source },
    );
  } catch (e) {
    back('/admin/clients/new', e);
  }
  redirect(`/admin/clients/${id}?msg=Client+added`);
}

export async function updateClientAction(f: FormData) {
  const user = await requirePageRole('admin');
  const id = str(f, 'clientId');
  try {
    await S.updateClient(user, id, { name: str(f, 'name'), phone: str(f, 'phone'), email: str(f, 'email'), notifyChannel: str(f, 'notifyChannel'), optedOut: f.get('optedOut') === 'on' });
  } catch (e) {
    back(`/admin/clients/${id}`, e);
  }
  revalidatePath(`/admin/clients/${id}`);
  redirect(`/admin/clients/${id}?msg=Saved`);
}

export async function savePropertyAction(f: FormData) {
  const user = await requirePageRole('admin');
  const clientId = str(f, 'clientId');
  const propertyId = str(f, 'propertyId');
  try {
    const loc = await locate(user, str(f, 'address'), str(f, 'lat'), str(f, 'lng'));
    // Unchanged coordinates keep their original source label (e.g. "simulated").
    const unchanged = propertyId && str(f, 'lat') === str(f, 'origLat') && str(f, 'lng') === str(f, 'origLng');
    const source = unchanged ? undefined : loc.source;
    const data = { clientId, address: str(f, 'address'), lat: loc.lat, lng: loc.lng, instructions: str(f, 'instructions'), serviceMinutes: Number(str(f, 'serviceMinutes') || 15), active: f.get('active') !== 'off' };
    if (propertyId) await S.updateProperty(user, propertyId, data, source);
    else await S.createProperty(user, data, loc.source);
  } catch (e) {
    back(`/admin/clients/${clientId}`, e);
  }
  redirect(`/admin/clients/${clientId}?msg=Property+saved`);
}

export async function setPropertyActiveAction(f: FormData) {
  const user = await requirePageRole('admin');
  const clientId = str(f, 'clientId');
  try {
    const detail = await S.getClient(user, clientId);
    const p = detail!.properties.find((x: any) => x.id === str(f, 'propertyId'))!;
    await S.updateProperty(user, p.id, { clientId, address: p.address, lat: p.lat, lng: p.lng, instructions: p.instructions, serviceMinutes: p.service_minutes, active: str(f, 'active') === 'true' });
  } catch (e) {
    back(`/admin/clients/${clientId}`, e);
  }
  redirect(`/admin/clients/${clientId}?msg=Saved`);
}

export async function createStatusLinkAction(f: FormData) {
  const user = await requirePageRole('admin');
  const clientId = str(f, 'clientId');
  const { url } = await S.createStatusLink(user, str(f, 'propertyId'));
  // Only a hash is stored. The full link is handed to the next page in a short-lived private cookie
  // (never in the URL, so it does not end up in browser history or server logs).
  (await cookies()).set('snow_flash_link', url, { httpOnly: true, sameSite: 'strict', path: '/admin', maxAge: 120 });
  redirect(`/admin/clients/${clientId}?msg=Status+link+created`);
}

export async function revokeStatusLinkAction(f: FormData) {
  const user = await requirePageRole('admin');
  await S.revokeStatusLinks(user, str(f, 'propertyId'));
  redirect(`/admin/clients/${str(f, 'clientId')}?msg=Status+link+revoked`);
}

export async function previewCsvAction(text: string) {
  const user = await requirePageRole('admin');
  return S.previewCsv(user, text);
}

export async function importCsvAction(text: string) {
  const user = await requirePageRole('admin');
  try {
    const r = await S.importCsv(user, text);
    revalidatePath('/admin/clients');
    return { ok: true as const, ...r };
  } catch (e) {
    return { ok: false as const, error: msg(e) };
  }
}

// ---------------------------------------------------------------- routes
export async function createRouteAction(input: RouteDraftInput) {
  const user = await requirePageRole('admin');
  try {
    const id = await S.createDraftRoute(user, input);
    return { ok: true as const, id };
  } catch (e) {
    return { ok: false as const, error: msg(e) };
  }
}

export async function routeCommandAction(f: FormData) {
  const user = await requirePageRole('admin');
  const routeId = str(f, 'routeId');
  const cmd = str(f, 'cmd');
  let note = 'Saved';
  try {
    if (cmd === 'up' || cmd === 'down') await S.moveStop(user, routeId, str(f, 'stopId'), cmd);
    else if (cmd === 'remove') await S.removeStop(user, routeId, str(f, 'stopId'));
    else if (cmd === 'resuggest') { await S.resuggestOrder(user, routeId); note = 'Order re-suggested'; }
    else if (cmd === 'add') await S.addStops(user, routeId, f.getAll('propertyIds').map(String));
    else if (cmd === 'details') await S.updateRouteDetails(user, routeId, { serviceDate: str(f, 'serviceDate'), plannedStartTime: str(f, 'plannedStartTime'), driverId: str(f, 'driverId') });
    else if (['publish', 'pause', 'resume', 'cancel'].includes(cmd)) {
      await S.setRouteStatus(user, routeId, cmd as S.RouteAction);
      note = { publish: 'Route published to the driver', pause: 'Route paused — pending messages cancelled', resume: 'Route resumed', cancel: 'Route cancelled — pending messages cancelled' }[cmd]!;
    }
  } catch (e) {
    back(`/admin/routes/${routeId}`, e);
  }
  revalidatePath(`/admin/routes/${routeId}`);
  redirect(`/admin/routes/${routeId}?msg=${encodeURIComponent(note)}`);
}

// ---------------------------------------------------------------- drivers
export async function createDriverAction(f: FormData) {
  const user = await requirePageRole('admin');
  try {
    await S.createDriver(user, { fullName: str(f, 'fullName'), email: str(f, 'email') });
  } catch (e) {
    back('/admin/drivers', e);
  }
  redirect('/admin/drivers?msg=Driver+added');
}

export async function setDriverActiveAction(f: FormData) {
  const user = await requirePageRole('admin');
  await S.setDriverActive(user, str(f, 'driverId'), str(f, 'active') === 'true');
  redirect('/admin/drivers?msg=Saved');
}

// ---------------------------------------------------------------- communications
export async function sendMessageAction(f: FormData) {
  const user = await requirePageRole('admin');
  const ret = str(f, 'returnTo') || '/admin/communications';
  const type = str(f, 'targetType');
  let note = '';
  try {
    const target = type === 'route' ? { type: 'route' as const, routeId: str(f, 'routeId') } : { type: 'client' as const, clientId: str(f, 'clientId') };
    const r = await S.sendManualMessage(user, { target, body: str(f, 'body') });
    note = `Message sent to ${r.sent} recipient(s)${r.failed ? `, ${r.failed} failed` : ''}${r.skippedOptedOut ? `, ${r.skippedOptedOut} opted out (skipped)` : ''}`;
  } catch (e) {
    back(ret, e);
  }
  redirect(`${ret}${ret.includes('?') ? '&' : '?'}msg=${encodeURIComponent(note)}`);
}

export async function runSchedulerAction() {
  await requirePageRole('admin');
  const r = await S.runSchedulerTick();
  redirect(`/admin/communications?msg=${encodeURIComponent(`Scheduler ran: ${r.sent} sent, ${r.failed} failed, ${r.cancelled} cancelled`)}`);
}
