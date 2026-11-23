import { config } from '@snow/server';
import { requirePageRole } from '@/lib/session';
import { btn, Card, Field, input, Notice, PageHeader } from '@/components/ui';
import { createClientAction } from '../../actions';

export default async function NewClientPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requirePageRole('admin');
  const { error } = await searchParams;
  const sim = config().routingMode === 'mock';
  return (
    <>
      <PageHeader title="Add client" sub="Client details and their first property. You can add more properties after." />
      {error && <div className="mb-4"><Notice tone="danger">{error}</Notice></div>}
      <form action={createClientAction} className="grid gap-4 lg:grid-cols-2">
        <Card title="Client">
          <div className="space-y-3">
            <Field label="Name"><input name="name" required className={input} /></Field>
            <Field label="Phone"><input name="phone" required type="tel" placeholder="506-555-0123" className={input} /></Field>
            <Field label="Email (optional)"><input name="email" type="email" className={input} /></Field>
            <fieldset>
              <legend className="mb-1 text-sm font-medium text-slate-700">Send service updates by</legend>
              <label className="mr-4 inline-flex items-center gap-2 text-sm"><input type="radio" name="notifyChannel" value="sms" defaultChecked /> SMS (default)</label>
              <label className="inline-flex items-center gap-2 text-sm"><input type="radio" name="notifyChannel" value="voice" /> Automated voice call</label>
            </fieldset>
          </div>
        </Card>
        <Card title="Property">
          <div className="space-y-3">
            <Field label="Address"><input name="address" required placeholder="12 Main St, Moncton, NB" className={input} /></Field>
            <Field label="Driveway instructions"><textarea name="instructions" rows={3} className={input} placeholder="Gate code, where to push snow…" /></Field>
            <Field label="Service time (minutes)"><input name="serviceMinutes" type="number" min={1} max={480} defaultValue={15} className={input} /></Field>
            <details className="text-sm">
              <summary className="cursor-pointer text-slate-600">Enter coordinates yourself (optional)</summary>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <input name="lat" placeholder="Latitude" className={input} />
                <input name="lng" placeholder="Longitude" className={input} />
              </div>
            </details>
            <p className="text-xs text-slate-500">
              Leave coordinates empty to look up the address{sim ? '. In development the location is simulated (made up near Moncton).' : '.'}
            </p>
          </div>
        </Card>
        <div className="lg:col-span-2">
          <button className={btn()}>Save client</button>
        </div>
      </form>
    </>
  );
}
