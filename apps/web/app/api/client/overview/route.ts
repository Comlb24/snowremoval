import { clientOverview } from '@snow/server';
import { api } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const GET = api(['client'], async (user) => clientOverview(user));
