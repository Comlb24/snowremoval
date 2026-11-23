import { requirePageRole } from '@/lib/session';
import { Card } from '@/components/ui';
import { logoutAction } from '../login/actions';

export const dynamic = 'force-dynamic';

export default async function DriverWebPage() {
  const u = await requirePageRole('driver');
  return (
    <main className="mx-auto max-w-md px-4 py-12">
      <Card title={`Hi ${u.fullName}`}>
        <p className="text-sm text-slate-700">Drivers use the mobile app to see routes and complete stops. Open the Snow Removal app on your phone and sign in.</p>
        <form action={logoutAction} className="mt-4">
          <button className="text-sm text-sky-700 underline">Sign out</button>
        </form>
      </Card>
    </main>
  );
}
