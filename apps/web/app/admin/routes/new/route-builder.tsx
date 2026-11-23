'use client';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { btn, Card, Field, input, Notice, Tag } from '@/components/ui';
import { createRouteAction } from '../../actions';

interface Props {
  drivers: { id: string; full_name: string }[];
  properties: { id: string; address: string; clientName: string; minutes: number; optedOut: boolean }[];
  defaults: { date: string; time: string; start: { address: string; lat: number; lng: number } };
  simulatedRouting: boolean;
}

export function RouteBuilder({ drivers, properties, defaults, simulatedRouting }: Props) {
  const router = useRouter();
  const [date, setDate] = useState(defaults.date);
  const [time, setTime] = useState(defaults.time);
  const [driverId, setDriverId] = useState(drivers[0]?.id ?? '');
  const [start, setStart] = useState(defaults.start);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  const shown = useMemo(() => properties.filter((p) => `${p.address} ${p.clientName}`.toLowerCase().includes(q.toLowerCase())), [properties, q]);
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const submit = () => {
    setError('');
    startTransition(async () => {
      const r = await createRouteAction({ serviceDate: date, plannedStartTime: time, driverId, startAddress: start.address, startLat: start.lat, startLng: start.lng, propertyIds: [...selected] });
      if (r.ok) router.push(`/admin/routes/${r.id}?msg=${encodeURIComponent('Draft created with a suggested order. Review it, then publish.')}`);
      else setError(r.error);
    });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card title="Day, driver and start">
        <div className="space-y-3">
          <Field label="Service date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={input} /></Field>
          <Field label="Planned start time" hint="Local time (America/Moncton)"><input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={input} /></Field>
          <Field label="Driver">
            <select value={driverId} onChange={(e) => setDriverId(e.target.value)} className={input}>
              {drivers.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
            </select>
          </Field>
          <Field label="Start location"><input value={start.address} onChange={(e) => setStart({ ...start, address: e.target.value })} className={input} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <input aria-label="Start latitude" value={start.lat} onChange={(e) => setStart({ ...start, lat: Number(e.target.value) })} className={input} />
            <input aria-label="Start longitude" value={start.lng} onChange={(e) => setStart({ ...start, lng: Number(e.target.value) })} className={input} />
          </div>
          {simulatedRouting && <Notice tone="warning">Travel times are simulated in development (not real road times).</Notice>}
        </div>
      </Card>

      <Card title={`Properties (${selected.size} selected)`} className="lg:col-span-2"
        actions={<div className="flex gap-2 text-sm"><button type="button" className="text-sky-700" onClick={() => setSelected(new Set(shown.map((p) => p.id)))}>Select all shown</button><button type="button" className="text-slate-600" onClick={() => setSelected(new Set())}>Clear</button></div>}>
        <input placeholder="Filter by address or client" value={q} onChange={(e) => setQ(e.target.value)} className={`${input} mb-3`} />
        <ul className="max-h-[26rem] divide-y divide-slate-100 overflow-auto">
          {shown.map((p) => (
            <li key={p.id}>
              <label className="flex cursor-pointer items-center gap-3 py-2 text-sm hover:bg-slate-50">
                <input type="checkbox" className="h-4 w-4" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
                <span className="flex-1"><span className="font-medium">{p.address}</span> <span className="text-slate-500">· {p.clientName}</span></span>
                {p.optedOut && <Tag tone="danger">Opted out</Tag>}
                <span className="text-xs text-slate-500">{p.minutes} min</span>
              </label>
            </li>
          ))}
        </ul>
        {error && <div className="mt-3"><Notice tone="danger">{error}</Notice></div>}
        <button type="button" disabled={pending || !selected.size || !driverId} onClick={submit} className={`${btn()} mt-4`}>
          {pending ? 'Working out the best order…' : 'Create draft with suggested order'}
        </button>
      </Card>
    </div>
  );
}
