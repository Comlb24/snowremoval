import { supabasePasswordLogin, verifySession } from '@snow/server';
import { api } from '@/lib/api';

export const dynamic = 'force-dynamic';

/** Email + password sign-in through Supabase Auth (AUTH_MODE=supabase). Returns our session token. */
export const POST = api(null, async (_u, req) => {
  const { email, password } = await req.json();
  const token = await supabasePasswordLogin(String(email), String(password));
  return { token, user: await verifySession(token) };
});
