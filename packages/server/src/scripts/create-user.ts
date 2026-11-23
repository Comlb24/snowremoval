// Creates a sign-in account. Run it in your own terminal: it asks you to choose a password
// (typing is hidden) and never prints it.
// Usage: npm run user:create -- --role admin --name "Your Name" --email you@example.com
import './load-env.ts';
import { loadConfig, setConfig } from '../env.ts';
import { createAccount } from '../services/admin.ts';
import { closeDb } from '../db.ts';

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const role = (arg('role') ?? 'admin') as 'admin' | 'driver';
const name = arg('name');
const email = arg('email');
if (!name || !email || !['admin', 'driver'].includes(role)) {
  console.error('Usage: npm run user:create -- --role admin --name "Your Name" --email you@example.com');
  process.exit(1);
}

/** Read a line from the terminal without showing what is typed. */
function askHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) return reject(new Error('Run this command in a terminal so you can type the password.'));
    process.stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const onData = (ch: string) => {
      for (const c of ch) {
        if (c === '\r' || c === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          return resolve(value);
        }
        if (c === '\u0003') {
          stdin.setRawMode(false);
          process.stdout.write('\n');
          process.exit(130);
        }
        if (c === '\u007f' || c === '\b') value = value.slice(0, -1);
        else value += c;
      }
    };
    stdin.on('data', onData);
  });
}

const c = loadConfig();
setConfig(c);
if (!c.databaseUrl) {
  console.error('DATABASE_URL is not set in apps/web/.env.local');
  process.exit(1);
}

try {
  let password = '';
  for (;;) {
    password = await askHidden('Choose a password (8+ characters, typing is hidden): ');
    if (password.length < 8) {
      console.log('  Too short. Use at least 8 characters.');
      continue;
    }
    const again = await askHidden('Type it again to confirm: ');
    if (again !== password) {
      console.log('  The two passwords do not match. Try again.');
      continue;
    }
    break;
  }
  const id = await createAccount(role, { fullName: name, email, password });
  console.log(`✓ Created ${role} ${email} (id ${id})`);
  console.log('  Sign in at http://localhost:3100 with this email and your password.');
} catch (e: any) {
  console.error(`✕ ${e?.message ?? e}`);
  process.exitCode = 1;
} finally {
  await closeDb();
}
