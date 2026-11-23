import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../env';

/**
 * Supabase clients (official SDK). Works with both key styles:
 * new publishable/secret keys (sb_publishable_…, sb_secret_…) and legacy anon/service_role keys.
 * The secret key is used only on the server.
 */
const opts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
let adminClient: SupabaseClient | null = null;
let publicClient: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  const sb = config().supabase;
  if (!sb?.secretKey) throw new Error('SUPABASE_SECRET_KEY is not set');
  adminClient ??= createClient(sb.url, sb.secretKey, opts);
  return adminClient;
}

export function supabasePublic(): SupabaseClient {
  const sb = config().supabase;
  if (!sb) throw new Error('SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are not set');
  publicClient ??= createClient(sb.url, sb.publishableKey, opts);
  return publicClient;
}

/** Create a confirmed Supabase Auth user with a password. Returns the new user id. */
export async function createSupabaseUser(email: string, password: string, fullName: string): Promise<string> {
  const { data, error } = await supabaseAdmin().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error || !data.user) throw new Error(`Could not create the account: ${error?.message ?? 'unknown error'}`);
  return data.user.id;
}

/** Email + password check. Returns the user id, or null when the details are wrong. */
export async function supabaseSignIn(email: string, password: string): Promise<string | null> {
  const { data, error } = await supabasePublic().auth.signInWithPassword({ email, password });
  if (error || !data.user) return null;
  // We only needed to check the password; our own session token is issued afterwards.
  await supabasePublic().auth.signOut().catch(() => {});
  return data.user.id;
}
