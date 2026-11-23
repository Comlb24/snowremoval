import { devLogin, verifySession } from '@snow/server';
import { api } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const POST = api(null, async (_u, req) => {
  const { userId } = await req.json();
  const token = await devLogin(String(userId));
  const user = await verifySession(token);
  return { token, user };
});
