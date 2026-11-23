import 'server-only';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifySession, type SessionUser } from '@snow/server';

export const SESSION_COOKIE = 'snow_session';

export type CurrentUser = SessionUser & { fullName: string };

/** Signed-in user from the session cookie (web) or Bearer token (mobile). */
export async function currentUser(): Promise<CurrentUser | null> {
  const h = await headers();
  const auth = h.get('authorization');
  const bearer = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  const token = bearer ?? (await cookies()).get(SESSION_COOKIE)?.value;
  return verifySession(token);
}

export async function requirePageRole(...roles: SessionUser['role'][]): Promise<CurrentUser> {
  const u = await currentUser();
  if (!u) redirect('/login');
  if (!roles.includes(u.role)) redirect(homeFor(u.role));
  return u;
}

export function homeFor(role: SessionUser['role']) {
  return role === 'admin' ? '/admin' : role === 'client' ? '/client' : '/driver';
}
