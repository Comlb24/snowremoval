import { config, listAdmins } from '@snow/server';
import { requirePageRole } from '@/lib/session';
import { btn, Card, Field, input, Notice, PageHeader, Tag } from '@/components/ui';
import { createAdminAction, setAdminActiveAction } from '../actions';

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ msg?: string; error?: string }> }) {
  const user = await requirePageRole('admin');
  const sp = await searchParams;
  const admins = await listAdmins(user);
  const devMode = config().authMode !== 'supabase';
  return (
    <>
      <PageHeader title="Team Members" sub="People with admin access can manage clients, routes, drivers and messages." />
      {sp.msg && <div className="mb-4"><Notice tone="success">{sp.msg}</Notice></div>}
      {sp.error && <div className="mb-4"><Notice tone="danger">{sp.error}</Notice></div>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Admins" className="lg:col-span-2">
          <ul className="divide-y divide-slate-100">
            {admins.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                <div className="flex-1">
                  <div className="font-medium">
                    {a.full_name} {a.id === user.id && <Tag tone="info">You</Tag>} {!a.active && <Tag>No access</Tag>}
                  </div>
                  <div className="text-slate-500">{a.email ?? 'No email'}</div>
                </div>
                {a.id !== user.id && (
                  <form action={setAdminActiveAction}>
                    <input type="hidden" name="adminId" value={a.id} />
                    <input type="hidden" name="active" value={a.active ? 'false' : 'true'} />
                    <button className={btn(a.active ? 'ghost' : 'secondary', 'sm')}>{a.active ? 'Remove access' : 'Restore access'}</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Add admin">
          <form action={createAdminAction} className="space-y-3">
            <Field label="Full name"><input name="fullName" required className={input} /></Field>
            <Field label="Email" hint="They use this email to sign in."><input name="email" type="email" required autoComplete="off" className={input} /></Field>
            <Field
              label="Password"
              hint={devMode ? 'Not used in local test mode: test accounts sign in without a password.' : '8+ characters. Give it to them privately.'}
            >
              <input name="password" type="text" required={!devMode} minLength={8} autoComplete="off" className={input} />
            </Field>
            <button className={btn()}>Give admin access</button>
          </form>
        </Card>
      </div>
    </>
  );
}
