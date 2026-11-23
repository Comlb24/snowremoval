import { driverRoute, endShift, startShift } from '@snow/server';
import { api } from '@/lib/api';

export const dynamic = 'force-dynamic';

/** POST { action: 'start' | 'end' } */
export const POST = api(['driver'], async (user, req, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const { action } = await req.json();
  if (action === 'start') await startShift(user, id);
  else if (action === 'end') await endShift(user, id);
  else throw new Error('Unknown action');
  return driverRoute(user, id);
});
