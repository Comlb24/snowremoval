import { SignJWT, jwtVerify } from 'jose';
import { config } from './env';
import { asSystem, type SessionUser } from './db';

const SESSION_DAYS = 14;
const key = () => new TextEncoder().encode(config().sessionSecret);

export class AuthError extends Error {
  status = 401;
}
export class ForbiddenError extends Error {
  status = 403;
}

/** Our own short session token, used by web (cookie) and mobile (Bearer header). */
export async function createSessionToken(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .setIssuer('snow-removal')
    .sign(key());
}

/** Verify the token, then read the role from the database (so deactivation and role changes apply at once). */
export async function verifySession(token: string | null | undefined): Promise<(SessionUser & { fullName: string }) | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { issuer: 'snow-removal', algorithms: ['HS256'] });
    if (!payload.sub) return null;
    const rows = await asSystem((tx) =>
      tx.query<{ id: string; role: SessionUser['role']; full_name: string }>('select id, role, full_name from profiles where id = $1 and active', [payload.sub]),
    );
    const p = rows[0];
    return p ? { id: p.id, role: p.role, fullName: p.full_name } : null;
  } catch {
    return null;
  }
}

export function requireRole<T extends SessionUser>(user: T | null, ...roles: SessionUser['role'][]): T {
  if (!user) throw new AuthError('Please sign in');
  if (!roles.includes(user.role)) throw new ForbiddenError('You do not have access to this');
  return user;
}

export function devLoginEnabled() {
  const c = config();
  return c.authMode === 'dev' && c.appEnv !== 'production';
}

/** Development sign-in: lists the demo accounts. Disabled in production. */
export async function listDevUsers() {
  if (!devLoginEnabled()) return [];
  return asSystem((tx) =>
    tx.query<{ id: string; role: string; full_name: string }>(
      `select id, role, full_name from profiles where active order by case role when 'admin' then 0 when 'driver' then 1 else 2 end, full_name`,
    ),
  );
}

export async function devLogin(userId: string): Promise<string> {
  if (!devLoginEnabled()) throw new AuthError('Development sign-in is disabled');
  const rows = await asSystem((tx) => tx.query('select id from profiles where id = $1 and active', [userId]));
  if (!rows.length) throw new AuthError('Unknown user');
  return createSessionToken(userId);
}

/** Supabase Auth sign-in (email + password), then our own session token. */
export async function supabasePasswordLogin(email: string, password: string): Promise<string> {
  if (config().authMode !== 'supabase' || !config().supabase) throw new AuthError('Supabase sign-in is not configured');
  const { supabaseSignIn } = await import('./adapters/supabase');
  const userId = await supabaseSignIn(email.trim().toLowerCase(), password);
  if (!userId) throw new AuthError('Email or password is not correct');
  const rows = await asSystem((tx) => tx.query('select id from profiles where id = $1 and active', [userId]));
  if (!rows.length) throw new ForbiddenError('This account has no access yet. Ask the admin.');
  return createSessionToken(userId);
}

/** Password reset works only with Supabase email sign-in (not with the development demo accounts). */
export function passwordResetAvailable() {
  const c = config();
  return c.authMode === 'supabase' && !!c.supabase;
}

/**
 * Send a password-reset email. The same answer is given whether or not the email has an account,
 * so the form cannot be used to find out who is a customer. The link opens /reset-password.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  if (!passwordResetAvailable()) throw new AuthError('Password reset is not set up on this server yet');
  const { supabasePublic } = await import('./adapters/supabase');
  const { error } = await supabasePublic().auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo: `${config().publicBaseUrl}/reset-password`,
  });
  if (error && (error.status === 429 || /rate limit/i.test(error.message))) {
    throw new AuthError('Too many reset requests. Wait a few minutes and try again.');
  }
  if (error) console.warn('[auth] password reset email failed:', error.message);
}

/** Set a new password using the one-time access token from the reset email link. */
export async function completePasswordReset(accessToken: string, newPassword: string): Promise<void> {
  if (!passwordResetAvailable()) throw new AuthError('Password reset is not set up on this server yet');
  if (newPassword.length < 8) throw new AuthError('Use at least 8 characters.');
  const { supabaseAdmin } = await import('./adapters/supabase');
  const admin = supabaseAdmin();
  const { data, error } = await admin.auth.getUser(accessToken);
  if (error || !data.user) throw new AuthError('This reset link has expired. Ask for a new one.');
  const res = await admin.auth.admin.updateUserById(data.user.id, { password: newPassword });
  if (res.error) throw new AuthError(`Could not save the new password: ${res.error.message}`);
}
