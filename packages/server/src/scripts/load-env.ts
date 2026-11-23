// Loads the web app's settings file (apps/web/.env.local) for command-line scripts.
// Values are never printed.
import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../env.ts';

const file = path.join(repoRoot(), 'apps', 'web', '.env.local');
if (fs.existsSync(file)) process.loadEnvFile(file);

export const envFileFound = fs.existsSync(file);
