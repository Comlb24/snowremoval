// Every-minute scheduler timer inside Supabase (pg_cron + pg_net), calling the live site.
//   npm run setup:cron -- --url https://your-app.vercel.app   (create or update the timer)
//   npm run setup:cron -- --status                            (show recent runs)
// CRON_SECRET is read from apps/web/.env.local and stored in Supabase Vault (encrypted). It is never printed.
import postgres from 'postgres';
import './load-env.ts';

const JOB = 'snow-scheduler';
const SECRET_NAME = 'snow_cron_secret';
const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('DATABASE_URL is not set in apps/web/.env.local');
  process.exit(1);
}
const sql = postgres(dbUrl, { prepare: false, max: 1, onnotice: () => {} });

async function status() {
  const job = await sql`select jobid, schedule, active from cron.job where jobname = ${JOB}`.catch(() => []);
  if (!job.length) {
    console.log('✕ No timer set up yet.');
    return;
  }
  console.log(`✓ Timer "${JOB}" is ${job[0].active ? 'active' : 'PAUSED'} (schedule: ${job[0].schedule})`);
  const runs = await sql`select status, start_time from cron.job_run_details where jobid = ${job[0].jobid} order by start_time desc limit 5`;
  for (const r of runs) console.log(`  run ${new Date(r.start_time).toISOString()}  ${r.status}`);
  const calls = await sql`select status_code, timed_out, error_msg, created from net._http_response order by created desc limit 5`.catch(() => []);
  for (const c of calls) {
    const err = c.error_msg ? ` error: ${String(c.error_msg).slice(0, 120)}` : '';
    console.log(`  call ${new Date(c.created).toISOString()}  HTTP ${c.status_code ?? '-'}${c.timed_out ? ' (timed out)' : ''}${err}`);
  }
}

async function setup(url: string) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32 || /paste/.test(secret)) throw new Error('CRON_SECRET in apps/web/.env.local is missing or still the placeholder');
  const target = `${url.replace(/\/$/, '')}/api/jobs/scheduler`;
  if (!/^https:\/\//.test(target)) throw new Error('Use the https address of the live site');

  await sql.unsafe('create extension if not exists pg_cron with schema pg_catalog');
  await sql.unsafe('create extension if not exists pg_net with schema extensions');
  // Store (or replace) the secret in Vault.
  const existing = await sql`select id from vault.secrets where name = ${SECRET_NAME}`;
  if (existing.length) await sql`select vault.update_secret(${existing[0].id}::uuid, ${secret})`;
  else await sql`select vault.create_secret(${secret}, ${SECRET_NAME}, 'Bearer token for the snow removal scheduler endpoint')`;

  const command = `
    select net.http_post(
      url := '${target.replace(/'/g, "''")}',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = '${SECRET_NAME}')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 55000
    );`;
  await sql`select cron.schedule(${JOB}, '* * * * *', ${command})`;
  console.log(`✓ Timer "${JOB}" set: every minute → ${target}`);
  console.log('  The secret is stored encrypted in Supabase Vault.');
}

try {
  if (process.argv.includes('--status')) await status();
  else {
    const url = arg('url');
    if (!url) throw new Error('Usage: npm run setup:cron -- --url https://your-app.vercel.app');
    await setup(url);
  }
} catch (e: any) {
  console.error(`✕ ${String(e?.message ?? e).replace(/postgres(ql)?:\/\/\S+/g, '[connection]')}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
