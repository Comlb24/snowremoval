import { myRoutes } from '@snow/server';
import { api } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const GET = api(['driver'], async (user) => ({ routes: await myRoutes(user) }));
