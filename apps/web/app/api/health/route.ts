import { NextResponse } from 'next/server';
import { asSystem, config } from '@snow/server';

export const dynamic = 'force-dynamic';

/** Remove anything that could reveal connection details (URLs, hosts, user names). */
function safe(msg: string) {
  return msg
    .replace(/postgres(ql)?:\/\/\S+/gi, '[connection string]')
    .replace(/[\w.-]+\.supabase\.(co|com)/gi, '[supabase host]')
    .replace(/postgres\.[a-z0-9]+/gi, '[db user]')
    .slice(0, 200);
}

/** Status check: which mode the app runs in and whether the database answers. Never shows secrets. */
export async function GET() {
  let c;
  try {
    c = config();
  } catch (e) {
    return NextResponse.json({ ok: false, stage: 'settings', error: safe((e as Error).message) }, { status: 500 });
  }
  const info = { env: c.appEnv, messaging: c.messagingMode, email: c.emailMode, routing: c.routingMode, storage: c.storageMode, auth: c.authMode, database: c.databaseUrl ? 'postgres' : 'embedded' };
  if (c.databaseUrl) {
    try {
      const u = new URL(c.databaseUrl);
      Object.assign(info, { databasePort: u.port || '5432', databasePooler: u.hostname.includes('pooler') });
    } catch {
      return NextResponse.json({ ok: false, stage: 'database', error: 'DATABASE_URL is not a valid connection string (check for spaces, quotes or [YOUR-PASSWORD])', ...info }, { status: 500 });
    }
  }
  try {
    await asSystem((tx) => tx.query('select 1'));
    return NextResponse.json({ ok: true, ...info });
  } catch (e) {
    return NextResponse.json({ ok: false, stage: 'database', error: safe((e as Error).message), ...info }, { status: 500 });
  }
}
