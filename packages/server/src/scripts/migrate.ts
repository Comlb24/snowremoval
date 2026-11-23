// Applies supabase/migrations/*.sql to DATABASE_URL (your Supabase project), in order, once each.
// Usage: npm run db:migrate
import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import { envFileFound } from './load-env.ts';
import { repoRoot } from '../env.ts';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(envFileFound ? 'DATABASE_URL is empty in apps/web/.env.local' : 'apps/web/.env.local not found (see docs/env.example)');
  process.exit(1);
}

const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} });
try {
  await sql.unsafe(`create table if not exists public.schema_migrations (name text primary key, applied_at timestamptz not null default now())`);
  await sql.unsafe(`revoke all on public.schema_migrations from anon, authenticated`);
  await sql.unsafe(`alter table public.schema_migrations enable row level security`);
  const done = new Set((await sql<{ name: string }[]>`select name from public.schema_migrations`).map((r) => r.name));
  // Migrations already applied by Supabase itself (CLI or the GitHub integration) are recorded
  // in supabase_migrations.schema_migrations by version (the timestamp prefix of the file name).
  const supabaseVersions = new Set(
    (await sql<{ version: string }[]>`select version from supabase_migrations.schema_migrations`.catch(() => [])).map((r) => String(r.version)),
  );
  const dir = path.join(repoRoot(), 'supabase', 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  let applied = 0;
  for (const f of files) {
    if (done.has(f)) {
      console.log(`✓ already applied  ${f}`);
      continue;
    }
    if (supabaseVersions.has(f.split('_')[0])) {
      await sql.unsafe('insert into public.schema_migrations (name) values ($1) on conflict do nothing', [f]);
      console.log(`✓ applied by Supabase  ${f}`);
      continue;
    }
    await sql.begin(async (tx) => {
      await tx.unsafe(fs.readFileSync(path.join(dir, f), 'utf8'));
      await tx.unsafe('insert into public.schema_migrations (name) values ($1)', [f]);
    });
    console.log(`✓ applied          ${f}`);
    applied++;
  }
  console.log(applied ? `Done: ${applied} migration(s) applied.` : 'Database is up to date.');
} catch (e: any) {
  console.error(`✕ Migration failed: ${e?.message ?? e}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
