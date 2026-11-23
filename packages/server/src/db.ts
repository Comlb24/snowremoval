import fs from 'node:fs';
import path from 'node:path';
import { config, repoRoot } from './env';

/** A query runner: a whole database, or one transaction. */
export interface Tx {
  query<T = Record<string, any>>(sql: string, params?: unknown[]): Promise<T[]>;
}

interface Driver {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  kind: 'pglite' | 'postgres';
}

export interface SessionUser {
  id: string;
  role: 'admin' | 'driver' | 'client';
}

const supabaseDir = () => path.join(repoRoot(), 'supabase');

async function pgliteDriver(dataDir: string | undefined): Promise<Driver> {
  const { PGlite } = await import('@electric-sql/pglite');
  if (dataDir) fs.mkdirSync(dataDir, { recursive: true });
  const db = dataDir ? new PGlite(dataDir) : new PGlite();
  await db.waitReady;
  return {
    kind: 'pglite',
    async query<T>(sql: string, params?: unknown[]) {
      return (await db.query<T>(sql, params as any[])).rows;
    },
    async exec(sql: string) {
      await db.exec(sql);
    },
    transaction<T>(fn: (tx: Tx) => Promise<T>) {
      return db.transaction(async (t) => fn({ query: async <R>(s: string, p?: unknown[]) => (await t.query<R>(s, p as any[])).rows }));
    },
    close: () => db.close(),
  };
}

async function postgresDriver(url: string): Promise<Driver> {
  const { default: postgres } = await import('postgres');
  // prepare:false keeps it compatible with Supabase's transaction pooler.
  const sql = postgres(url, { prepare: false, max: 5, onnotice: () => {} });
  return {
    kind: 'postgres',
    async query<T>(q: string, params?: unknown[]) {
      return (await sql.unsafe(q, params as any[])) as unknown as T[];
    },
    async exec(q: string) {
      await sql.unsafe(q);
    },
    async transaction<T>(fn: (tx: Tx) => Promise<T>) {
      return (await sql.begin(async (t) => fn({ query: async <R>(s: string, p?: unknown[]) => (await t.unsafe(s, p as any[])) as unknown as R[] }))) as T;
    },
    close: () => sql.end(),
  };
}

const g = globalThis as unknown as { __snowDb?: Promise<Driver> };

/** Shared database handle (one per process). Local dev uses embedded Postgres; production uses DATABASE_URL. */
export function driver(): Promise<Driver> {
  if (!g.__snowDb) {
    const c = config();
    g.__snowDb = (async () => {
      const d = c.databaseUrl ? await postgresDriver(c.databaseUrl) : await pgliteDriver(c.pgliteDir ?? undefined);
      if (d.kind === 'pglite') await migrate(d);
      return d;
    })();
  }
  return g.__snowDb;
}

/** For tests: use a fresh in-memory database. */
export async function useMemoryDb(): Promise<void> {
  if (g.__snowDb) await (await g.__snowDb).close().catch(() => {});
  g.__snowDb = (async () => {
    const d = await pgliteDriver(undefined);
    await migrate(d);
    return d;
  })();
  await g.__snowDb;
}

export async function closeDb() {
  if (g.__snowDb) await (await g.__snowDb).close().catch(() => {});
  g.__snowDb = undefined;
}

/** Apply the dev auth shim and migrations to the embedded database (Supabase uses `supabase db push`). */
async function migrate(d: Driver) {
  await d.exec(`create table if not exists public._local_migrations (name text primary key, applied_at timestamptz default now())`);
  const done = new Set((await d.query<{ name: string }>('select name from public._local_migrations')).map((r) => r.name));
  const files = [
    ['dev/auth-shim.sql', path.join(supabaseDir(), 'dev', 'auth-shim.sql')],
    ...fs
      .readdirSync(path.join(supabaseDir(), 'migrations'))
      .filter((f) => f.endsWith('.sql') && !f.includes('storage'))
      .sort()
      .map((f) => [f, path.join(supabaseDir(), 'migrations', f)]),
  ];
  for (const [name, file] of files) {
    if (done.has(name)) continue;
    await d.exec(fs.readFileSync(file, 'utf8'));
    await d.query('insert into public._local_migrations (name) values ($1)', [name]);
  }
  await d.exec('revoke all on public._local_migrations from anon, authenticated');
}

/** Run as a signed-in user. Row Level Security applies to everything inside. */
export async function asUser<T>(user: SessionUser, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const d = await driver();
  return d.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: user.id, role: 'authenticated' })]);
    await tx.query('set local role authenticated');
    return fn(tx);
  });
}

/** Run as the public (no sign-in). Only functions granted to anon work. */
export async function asAnon<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const d = await driver();
  return d.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', '', true)`);
    await tx.query('set local role anon');
    return fn(tx);
  });
}

/** Server-internal work (scheduler, recalculation). Bypasses RLS — never call with user-chosen SQL. */
export async function asSystem<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const d = await driver();
  return d.transaction(fn);
}

export function iso(v: unknown): string | null {
  if (v == null) return null;
  return (v instanceof Date ? v : new Date(String(v))).toISOString();
}
