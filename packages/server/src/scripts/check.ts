// Checks the Supabase setup without printing any secret. Usage: npm run setup:check
import { envFileFound } from './load-env.ts';
import { loadConfig, setConfig } from '../env.ts';

const results: [boolean, string][] = [];
const ok = (cond: boolean, msg: string) => results.push([cond, msg]);

ok(envFileFound, 'Settings file apps/web/.env.local found');
const c = loadConfig();
setConfig(c);
ok(!!c.databaseUrl, 'DATABASE_URL is set');
ok(!!c.supabase, 'SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are set');
ok(!!c.supabase?.secretKey, 'SUPABASE_SECRET_KEY is set');
ok(c.authMode === 'supabase', 'AUTH_MODE=supabase');
ok(c.storageMode === 'supabase', 'STORAGE_MODE=supabase');
ok(c.sessionSecret !== 'dev-only-session-secret-change-me-0123456789' && c.sessionSecret.length >= 32, 'SESSION_SECRET is set (32+ characters)');

/** Describes a key without revealing it. */
function keyKind(v: string | null | undefined): string {
  if (!v) return 'empty';
  if (/paste|your-|here$/i.test(v)) return 'still the placeholder text';
  if (v.startsWith('sb_secret_')) return 'a secret key (sb_secret_…)';
  if (v.startsWith('sb_publishable_')) return 'a PUBLISHABLE key (sb_publishable_…)';
  if (/^eyJ/.test(v)) {
    try {
      const role = JSON.parse(Buffer.from(v.split('.')[1], 'base64url').toString()).role;
      return `a legacy "${role}" key`;
    } catch {
      return 'a legacy key (unreadable)';
    }
  }
  if (/\s/.test(v)) return 'text containing spaces (check for extra spaces or line breaks)';
  return `unrecognised text (${v.length} characters)`;
}
console.log(`  SUPABASE_PUBLISHABLE_KEY looks like: ${keyKind(c.supabase?.publishableKey)}`);
console.log(`  SUPABASE_SECRET_KEY looks like: ${keyKind(c.supabase?.secretKey)}`);
console.log(`  SESSION_SECRET: ${keyKind(process.env.SESSION_SECRET) === 'still the placeholder text' ? 'still the placeholder text' : `${(process.env.SESSION_SECRET ?? '').length} characters`}`);
console.log('');

if (c.databaseUrl) {
  const { default: postgres } = await import('postgres');
  const sql = postgres(c.databaseUrl, { prepare: false, max: 1, onnotice: () => {} });
  try {
    await sql`select 1`;
    ok(true, 'Database connection works');
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from public.schema_migrations`.catch(() => [{ n: 0 }]);
    ok(n >= 3, `Migrations applied (${n} of 3)`);
    const roleOk = await sql.begin(async (tx) => {
      await tx.unsafe(`select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000000"}', true)`);
      await tx.unsafe('set local role authenticated');
      const r = await tx.unsafe('select count(*)::int as n from public.clients');
      return r[0].n === 0;
    }).catch(() => false);
    ok(roleOk, 'Permission rules active (an unknown user sees no clients)');
    const [{ admins }] = await sql<{ admins: number }[]>`select count(*)::int as admins from public.profiles where role = 'admin' and active`.catch(() => [{ admins: 0 }]);
    ok(admins > 0, `Admin account exists (${admins})`);
  } catch (e: any) {
    ok(false, `Database connection failed: ${String(e?.message ?? e).replace(/postgres(ql)?:\/\/\S+/g, '[url]')}`);
  } finally {
    await sql.end();
  }
}

if (c.supabase?.secretKey) {
  const { supabaseAdmin } = await import('../adapters/supabase.ts');
  const { error: authErr } = await supabaseAdmin().auth.admin.listUsers({ page: 1, perPage: 1 });
  ok(!authErr, `Supabase Auth reachable with the secret key${authErr ? `: ${authErr.message}` : ''}`);
  const { data: bucket, error: bErr } = await supabaseAdmin().storage.getBucket('visit-photos');
  ok(!!bucket && !bucket.public, `Private photo bucket "visit-photos" exists${bErr ? `: ${bErr.message}` : ''}`);
}

for (const [pass, msg] of results) console.log(`${pass ? '✓' : '✕'} ${msg}`);
const failed = results.filter(([p]) => !p).length;
console.log(failed ? `\n${failed} check(s) need attention.` : '\nAll checks passed.');
process.exit(failed ? 1 : 0);
