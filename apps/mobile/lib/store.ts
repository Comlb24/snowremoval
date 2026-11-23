import * as SQLite from 'expo-sqlite';

/**
 * Local storage on the phone:
 *  - kv: cached routes (so the driver can keep working without signal)
 *  - outbox: stop updates and photos waiting to be sent, oldest first
 */
let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function db() {
  dbPromise ??= (async () => {
    const d = await SQLite.openDatabaseAsync('snow.db');
    await d.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS outbox (
        id TEXT PRIMARY KEY NOT NULL,
        kind TEXT NOT NULL,
        payload TEXT NOT NULL,
        file_uri TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        failed INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
    `);
    return d;
  })();
  return dbPromise;
}

export async function kvGet<T>(key: string): Promise<{ value: T; updatedAt: string } | null> {
  const row = await (await db()).getFirstAsync<{ value: string; updated_at: string }>('SELECT value, updated_at FROM kv WHERE key = ?', key);
  return row ? { value: JSON.parse(row.value) as T, updatedAt: row.updated_at } : null;
}

export async function kvSet(key: string, value: unknown) {
  await (await db()).runAsync('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, ?)', key, JSON.stringify(value), new Date().toISOString());
}

export async function clearLocalData() {
  const d = await db();
  await d.execAsync('DELETE FROM kv; DELETE FROM outbox;');
}

export interface OutboxItem {
  id: string; // = clientUuid sent to the server (idempotency key)
  kind: 'stop_update' | 'photo';
  payload: any;
  file_uri: string | null;
  attempts: number;
  last_error: string | null;
  failed: number;
  created_at: string;
}

export async function outboxAdd(item: Pick<OutboxItem, 'id' | 'kind' | 'payload' | 'file_uri'>) {
  await (await db()).runAsync(
    'INSERT OR IGNORE INTO outbox (id, kind, payload, file_uri, created_at) VALUES (?, ?, ?, ?, ?)',
    item.id, item.kind, JSON.stringify(item.payload), item.file_uri, new Date().toISOString(),
  );
}

export async function outboxList(): Promise<OutboxItem[]> {
  const rows = await (await db()).getAllAsync<any>('SELECT * FROM outbox ORDER BY created_at, rowid');
  return rows.map((r) => ({ ...r, payload: JSON.parse(r.payload) }));
}

export async function outboxDelete(id: string) {
  await (await db()).runAsync('DELETE FROM outbox WHERE id = ?', id);
}

export async function outboxMark(id: string, error: string, failed: boolean) {
  await (await db()).runAsync('UPDATE outbox SET attempts = attempts + 1, last_error = ?, failed = ? WHERE id = ?', error, failed ? 1 : 0, id);
}
