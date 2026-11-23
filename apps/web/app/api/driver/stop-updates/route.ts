import { recordStopUpdate } from '@snow/server';
import { api } from '@/lib/api';

export const dynamic = 'force-dynamic';

/** Idempotent: the same clientUuid sent again returns { result: 'duplicate' } and changes nothing. */
export const POST = api(['driver'], async (user, req) => recordStopUpdate(user, await req.json()));
