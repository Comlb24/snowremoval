import { EQUIPMENT, EQUIPMENT_LABELS } from '@snow/core';
import { btn, Field, input, Tag } from '@/components/ui';
import { COMING_SOON } from '@/lib/features';
import { phone } from '@/lib/format';
import { savePropertyAction } from '../actions';

/** Add or edit a property. Used on the Properties tab and from a client's page. */
export function PropertyForm({
  clients, property, clientId, returnTo, simulatedLocations,
}: {
  clients: { id: string; name: string }[];
  property?: any;
  clientId?: string;
  returnTo?: 'client';
  simulatedLocations: boolean;
}) {
  const p = property;
  const owner = p?.client_id ?? clientId ?? '';
  const residentChannel = p?.resident_channel ?? 'sms';
  return (
    <form action={savePropertyAction} className="space-y-5">
      {p && <input type="hidden" name="propertyId" value={p.id} />}
      {p && <input type="hidden" name="active" value={p.active ? 'on' : 'off'} />}
      {p && <input type="hidden" name="origLat" value={String(p.lat)} />}
      {p && <input type="hidden" name="origLng" value={String(p.lng)} />}
      {p && <input type="hidden" name="origAddress" value={p.address} />}
      {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Owner" hint={clients.length === 0 ? 'Add a client first.' : 'The client who owns this property.'}>
          <select name="clientId" required defaultValue={owner} className={input}>
            <option value="" disabled>Choose a client…</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Address"><input name="address" required defaultValue={p?.address ?? ''} placeholder="12 Main St, Moncton, NB" className={input} /></Field>
      </div>

      <fieldset className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <legend className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-sm font-semibold text-slate-900">
          <span className="whitespace-nowrap">Resident contact <span className="font-normal text-slate-500">(optional)</span></span>
          {p?.has_resident && <span className="whitespace-nowrap"><Tag tone="info">Updates go to resident</Tag></span>}
        </legend>
        <p className="mb-3 text-sm text-slate-600">
          For rentals or buildings where the people living there should get service updates instead of the owner.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Resident name"><input name="residentName" autoComplete="off" defaultValue={p?.resident_name ?? ''} placeholder="e.g. Alex Martin" className={input} /></Field>
          <Field label="Resident email"><input name="residentEmail" type="email" autoComplete="off" defaultValue={p?.resident_email ?? ''} placeholder="alex@example.com" className={input} /></Field>
          <Field label="Resident phone"><input name="residentPhone" type="tel" autoComplete="off" defaultValue={p?.resident_phone ? phone(p.resident_phone) : ''} placeholder="506-555-0123" className={input} /></Field>
        </div>
        <fieldset className="mt-3">
          <legend className="mb-1 text-sm font-medium text-slate-700">Send resident updates by</legend>
          <div className="flex flex-wrap gap-4">
            {[['sms', 'SMS'], ['email', 'Email'], ['voice', 'Phone call']].map(([v, l]) => {
              // Phone calls are not live yet. A resident already set to calls keeps the choice, so saving never drops it.
              const off = v === 'voice' && COMING_SOON.voiceCalls && residentChannel !== 'voice';
              return (
                <label key={v} className={`inline-flex items-center gap-2 text-sm ${off ? 'text-slate-400' : ''}`}>
                  <input type="radio" name="residentChannel" value={v} defaultChecked={v === residentChannel} disabled={off} /> {l}
                  {v === 'voice' && COMING_SOON.voiceCalls && ' (coming soon)'}
                </label>
              );
            })}
          </div>
        </fieldset>
        <p className="mt-3 text-xs text-slate-500">
          ⓘ If no resident information is filled out, updates are sent to the owner’s contact by default.
          {p?.has_resident && ' To send updates to the owner again, clear the name, email and phone.'}
        </p>
      </fieldset>

      <fieldset>
        <legend className="mb-1 text-sm font-medium text-slate-700">Recommended equipment</legend>
        <div className="flex flex-wrap gap-4">
          {EQUIPMENT.map((e) => (
            <label key={e} className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" name="equipment" value={e} defaultChecked={p?.equipment?.includes(e)} /> {EQUIPMENT_LABELS[e]}
            </label>
          ))}
        </div>
        <p className="mt-1 text-xs text-slate-500">Tick both if the driveway needs a plow and the walkway needs a blower.</p>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Driver notes" hint="Drivers see this at the stop.">
          <textarea name="instructions" rows={3} defaultValue={p?.instructions ?? ''} placeholder="Gate code, where to push snow…" className={input} />
        </Field>
        <Field label="Office notes" hint="Only admins see this.">
          <textarea name="officeNotes" rows={3} defaultValue={p?.office_notes ?? ''} placeholder="Billing or customer notes…" className={input} />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Quoted amount (CAD)" hint="Only admins see this. Leave empty if not quoted yet.">
          <input name="quotedAmount" inputMode="decimal" defaultValue={p?.quoted_amount ?? ''} placeholder="e.g. 650.00" className={input} />
        </Field>
        <Field label="Service time (minutes)" hint="Used to estimate arrival times.">
          <input name="serviceMinutes" type="number" min={1} max={480} defaultValue={p?.service_minutes ?? 15} className={input} />
        </Field>
      </div>

      <details className="text-sm" open={!!p && p.location_source === 'manual'}>
        <summary className="cursor-pointer text-slate-600">
          Map location {p ? <>({p.location_source === 'simulated' ? <Tag tone="warning">Simulated</Tag> : p.location_source})</> : '(optional)'}
        </summary>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <input name="lat" placeholder="Latitude" defaultValue={p?.lat ?? ''} className={input} />
          <input name="lng" placeholder="Longitude" defaultValue={p?.lng ?? ''} className={input} />
        </div>
        <p className="mt-1 text-xs text-slate-500">
          {p ? 'Clear both boxes to look up the address again' : 'Leave empty to look up the address'}
          {simulatedLocations ? '. In development the location is simulated (made up near Moncton).' : '.'}
        </p>
      </details>

      <button className={btn()} disabled={clients.length === 0}>{p ? 'Save property' : 'Add property'}</button>
    </form>
  );
}
