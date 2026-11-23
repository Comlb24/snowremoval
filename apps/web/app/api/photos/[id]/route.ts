import { NextResponse } from 'next/server';
import { getPhoto } from '@snow/server';
import { api } from '@/lib/api';

export const dynamic = 'force-dynamic';

/** Private photo. Access is decided by the database policies (admin, assigned driver, owning client). */
export const GET = api(['admin', 'driver', 'client'], async (user, _req, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const p = await getPhoto(user, id);
  if (!p) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return new Response(p.bytes as unknown as BodyInit, { headers: { 'Content-Type': p.contentType, 'Cache-Control': 'private, no-store' } });
});
