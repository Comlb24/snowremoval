'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { devLogin, supabasePasswordLogin, verifySession, config, requestPasswordReset, completePasswordReset } from '@snow/server';
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
    const msg = config().authMode === 'dev' ? 'Email sign-in is not set up yet. Use a demo account below.' : e.message;
    redirect(`/login?error=${encodeURIComponent(msg)}`);
  }
  await setSession(token);
}

export async function logoutAction() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect('/login');
}

export async function forgotPasswordAction(form: FormData) {
  try {
    await requestPasswordReset(String(form.get('email') ?? ''));
  } catch (e: any) {
    redirect(`/forgot-password?error=${encodeURIComponent(e.message)}`);
  }
  redirect('/forgot-password?sent=1');
}

export type ResetState = { ok: boolean; error?: string };

export async function resetPasswordAction(_prev: ResetState, form: FormData): Promise<ResetState> {
  const password = String(form.get('password') ?? '');
  if (password !== String(form.get('confirm') ?? '')) return { ok: false, error: 'The two passwords do not match.' };
  try {
    await completePasswordReset(String(form.get('token') ?? ''), password);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}
