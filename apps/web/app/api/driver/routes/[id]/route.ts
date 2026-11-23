import { NextResponse } from 'next/server';
import { driverRoute } from '@snow/server';
import { api } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const GET = api(['driver'], async (user, _req, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const r = await driverRoute(user, id);
  return r ?? NextResponse.json({ error: 'Route not found' }, { status: 404 });
});
