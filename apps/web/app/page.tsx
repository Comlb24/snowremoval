import { redirect } from 'next/navigation';
import { currentUser, homeFor } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const u = await currentUser();
  redirect(u ? homeFor(u.role) : '/login');
}
