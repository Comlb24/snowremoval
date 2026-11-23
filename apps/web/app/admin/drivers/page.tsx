import Link from 'next/link';
import { config, listDrivers } from '@snow/server';
import { requirePageRole } from '@/lib/session';
import { btn, Card, Field, input, Notice, PageHeader, Status, Tag } from '@/components/ui';
import { dt } from '@/lib/format';
import { createDriverAction, setDriverActiveAction } from '../actions';

export default async function DriversPage({ searchParams }: { searchParams: Promise<{ msg?: string; error?: string }> }) {
  const user = await requirePageRole('admin');
  const sp = await searchParams;
  const drivers = await listDrivers(user);
  return (
    <>
      <PageHeader title="Drivers" />
      {sp.msg && <div className="mb-4"><Notice tone="success">{sp.msg}</Notice></div>}
      {sp.error && <div className="mb-4"><Notice tone="danger">{sp.error}</Notice></div>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <ul className="divide-y divide-slate-100">
            {drivers.map((d: any) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                <div className="flex-1">
                  <div className="font-medium">{d.full_name} {!d.active && <Tag>Inactive</Tag>}</div>
                  <div className="text-slate-500">{d.email} · last shift {dt(d.last_shift)}</div>
                </div>
                {d.current_route ? (
                  <Link href={`/admin/routes/${d.current_route.id}`} className="hover:underline">Today: <Status status={d.current_route.status} /></Link>
                ) : (
                  <span className="text-slate-500">No route today</span>
                )}
                <form action={setDriverActiveAction}>
                  <input type="hidden" name="driverId" value={d.id} />
                  <input type="hidden" name="active" value={d.active ? 'false' : 'true'} />
                  <button className={btn(d.active ? 'ghost' : 'secondary', 'sm')}>{d.active ? 'Deactivate' : 'Activate'}</button>
                </form>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Add driver">
          <form action={createDriverAction} className="space-y-3">
            <Field label="Full name"><input name="fullName" required className={input} /></Field>
            <Field label="Email" hint="Used to sign in to the mobile app."><input name="email" type="email" required className={input} /></Field>
            {config().authMode === 'supabase' && (
              <Field label="Temporary password" hint="8+ characters. Give it to the driver privately; they use it to sign in.">
                <input name="password" type="text" required minLength={8} autoComplete="off" className={input} />
              </Field>
            )}
            <button className={btn()}>Add driver</button>
          </form>
        </Card>
      </div>
    </>
  );
}
