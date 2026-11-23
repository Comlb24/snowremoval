import { NextResponse } from 'next/server';
import { devLoginEnabled, listDevUsers } from '@snow/server';

export const dynamic = 'force-dynamic';

/** Development only: demo accounts for the mobile sign-in screen. Empty in production. */
export async function GET() {
  return NextResponse.json({ devLogin: devLoginEnabled(), users: (await listDevUsers()).map((u) => ({ id: u.id, role: u.role, name: u.full_name })) });
}
