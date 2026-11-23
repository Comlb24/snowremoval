import { NextResponse } from 'next/server';
import { revealPhone } from '@snow/server';
import { api } from '@/lib/api';

export const dynamic = 'force-dynamic';

/** Reveal the client's phone for one stop. POST (not GET) so it is never cached or prefetched. Logged. */
export const POST = api(['driver'], async (user, _req, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const r = await revealPhone(user, id);
  return NextResponse.json(r, { headers: { 'Cache-Control': 'no-store' } });
});
