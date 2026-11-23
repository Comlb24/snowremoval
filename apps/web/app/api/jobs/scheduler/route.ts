import { NextResponse } from 'next/server';
import { config, runSchedulerTick } from '@snow/server';
import { errorResponse } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Scheduler tick, called every minute by a cron (Vercel Cron, Supabase pg_cron + pg_net, or any external cron).
 * Protected by CRON_SECRET (Authorization: Bearer <secret>).
 */
async function handle(req: Request) {
  const secret = config().cronSecret;
  const auth = req.headers.get('authorization');
  if (!secret || auth !== `Bearer ${secret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return NextResponse.json(await runSchedulerTick());
  } catch (e) {
    return errorResponse(e);
  }
}

export const GET = handle;
export const POST = handle;
