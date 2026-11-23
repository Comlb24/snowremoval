import { NextResponse } from 'next/server';
import { asSystem, config } from '@snow/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const c = config();
  await asSystem((tx) => tx.query('select 1'));
  return NextResponse.json({ ok: true, env: c.appEnv, messaging: c.messagingMode, routing: c.routingMode, storage: c.storageMode, auth: c.authMode, database: c.databaseUrl ? 'postgres' : 'embedded' });
}
