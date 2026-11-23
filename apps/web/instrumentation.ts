/**
 * Runs once when the server starts.
 * Local development: creates demo data in an empty database and runs the notification scheduler
 * every minute inside the server process. In production, set CRON_SECRET and call
 * /api/jobs/scheduler every minute from a cron instead (see README).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const S = await import('@snow/server');
  const c = S.config();
  if (c.appEnv === 'production' && process.env.RUN_SCHEDULER_IN_PROCESS !== 'true') return;
  await S.ensureDemoData();
  const g = globalThis as unknown as { __snowScheduler?: NodeJS.Timeout };
  if (g.__snowScheduler) return;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await S.runSchedulerTick();
      if (r.sent || r.failed || r.created || r.cancelled) S.log.info('scheduler', r);
    } catch (e: any) {
      S.log.error(`scheduler failed: ${e?.message ?? e}`);
    } finally {
      running = false;
    }
  };
  g.__snowScheduler = setInterval(tick, 60_000);
  void tick();
  S.log.info(`Scheduler running every 60 s (messaging: ${c.messagingMode}, routing: ${c.routingMode})`);
}
