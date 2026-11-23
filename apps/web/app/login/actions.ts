'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { devLogin, supabasePasswordLogin, verifySession, config } from '@snow/server';
import { SESSION_COOKIE, homeFor } from '@/lib/session';

async function setSession(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config().publicBaseUrl.startsWith('https://'),
    path: '/',
    maxAge: 14 * 24 * 3600,
  });
  const user = await verifySession(token);
  redirect(user ? homeFor(user.role) : '/login');
}

export async function devLoginAction(form: FormData) {
  let token: string;
  try {
    token = await devLogin(String(form.get('userId')));
  } catch (e: any) {
    redirect(`/login?error=${encodeURIComponent(e.message)}`);
  }
  await setSession(token);
}

export async function passwordLoginAction(form: FormData) {
  let token: string;
  try {
    token = await supabasePasswordLogin(String(form.get('email')), String(form.get('password')));
  } catch (e: any) {
    redirect(`/login?error=${encodeURIComponent(e.message)}`);
  }
  await setSession(token);
}

export async function logoutAction() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect('/login');
}
