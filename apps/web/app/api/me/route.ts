import { api } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const GET = api(['admin', 'driver', 'client'], async (user) => ({ user }));
