// Deletes the local embedded database and photo folder, then recreates demo data.
// Usage: npm run db:reset   (development only; does nothing to Supabase)
import fs from 'node:fs';
import { config } from '../env.ts';
import { closeDb, driver } from '../db.ts';
import { seedDemoData } from '../seed.ts';

const c = config();
if (c.databaseUrl || c.appEnv === 'production') {
  console.error('db:reset only works on the local embedded database.');
  process.exit(1);
}
fs.rmSync(c.pgliteDir!, { recursive: true, force: true });
fs.rmSync(c.localStorageDir, { recursive: true, force: true });
await driver();
await seedDemoData();
await closeDb();
console.log('Local database reset with demo data at', c.pgliteDir);
