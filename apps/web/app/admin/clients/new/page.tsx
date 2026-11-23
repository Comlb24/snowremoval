import { COMING_SOON } from '@/lib/features';
import { requirePageRole } from '@/lib/session';
import { btn, Card, Field, input, Notice, PageHeader } from '@/components/ui';
import { createClientAction } from '../../actions';

export default async function NewClientPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requirePageRole('admin');
  const { error } = await searchParams;
  return (
    <>
      <PageHeader title="Add client" sub="Contact details first. You add their properties on the next screen." />
      {error && <div className="mb-4"><Notice tone="danger">{error}</Notice></div>}
      <form action={createClientAction} className="max-w-xl space-y-4">
        <Card title="Client">
          <div className="space-y-3">
            <Field label="Name"><input name="name" required className={input} /></Field>
            <Field label="Phone"><input name="phone" required type="tel" placeholder="506-555-0123" className={input} /></Field>
            <Field label="Email (optional)" hint="Needed if updates go by email."><input name="email" type="email" className={input} /></Field>
            <fieldset>
              <legend className="mb-1 text-sm font-medium text-slate-700">Send service updates by</legend>
              <label className="mr-4 inline-flex items-center gap-2 text-sm"><input type="radio" name="notifyChannel" value="sms" defaultChecked /> SMS (default)</label>
              <label className="mr-4 inline-flex items-center gap-2 text-sm"><input type="radio" name="notifyChannel" value="email" /> Email</label>
              <label className={`inline-flex items-center gap-2 text-sm ${COMING_SOON.voiceCalls ? 'text-slate-400' : ''}`}><input type="radio" name="notifyChannel" value="voice" disabled={COMING_SOON.voiceCalls} /> Automated voice call{COMING_SOON.voiceCalls && ' (coming soon)'}</label>
            </fieldset>
          </div>
        </Card>
        <div>
          <button className={btn()}>Save and add properties</button>
        </div>
      </form>
    </>
  );
}
