import { NextResponse } from 'next/server';
import { sendOnMyWay } from '@snow/server';
import { api } from '@/lib/api';

export const dynamic = 'force-dynamic';

/** Driver taps "On my way": text the client now. Sent once per stop; repeats return the first send time. */
export const POST = api(['driver'], async (user, _req, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const r = await sendOnMyWay(user, id);
  return NextResponse.json(r, { headers: { 'Cache-Control': 'no-store' } });
});
