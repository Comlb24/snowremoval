import { day, t } from '@/lib/format';

interface Stop {
  status: string;
  routeStatus: string;
  serviceDate: string;
  windowStart: string | null;
  windowEnd: string | null;
  finishedAt: string | null;
  hasPhoto: boolean;
}

/** Client-facing status card. Large type, plain words, status as text + icon + colour. */
export function StatusView({ address, stop, active }: { address: string; stop: Stop | null; active: boolean }) {
  let icon = '○';
  let headline = 'No service scheduled right now';
  let detail = 'We will let you know when your property is on a route.';
  let tone = 'bg-slate-50 ring-slate-200 text-slate-800';

  if (!active) {
    headline = 'Service is not active for this property';
    detail = 'Please contact us if this is unexpected.';
  } else if (stop) {
    if (stop.status === 'completed') {
      icon = '✓';
      headline = 'Snow removal completed';
      detail = `Finished at ${t(stop.finishedAt)} on ${day(stop.finishedAt ?? stop.serviceDate)}.${stop.hasPhoto ? ' A photo was taken for our records.' : ''}`;
      tone = 'bg-emerald-50 ring-emerald-200 text-emerald-900';
    } else if (stop.status === 'in_progress') {
      icon = '◔';
      headline = 'Our crew is at your property now';
      detail = 'Snow removal is in progress.';
      tone = 'bg-sky-50 ring-sky-200 text-sky-900';
    } else if (stop.status === 'blocked') {
      icon = '!';
      headline = 'We could not complete the service';
      detail = 'Something blocked the driveway. We will contact you.';
      tone = 'bg-amber-50 ring-amber-200 text-amber-900';
    } else if (stop.routeStatus === 'paused') {
      icon = '‖';
      headline = 'Service is temporarily on hold';
      detail = 'We will send a new time when service resumes.';
      tone = 'bg-amber-50 ring-amber-200 text-amber-900';
    } else if (stop.windowStart) {
      icon = '◷';
      headline = 'Scheduled';
      detail = `Estimated arrival on ${day(stop.serviceDate)} between ${t(stop.windowStart)} and ${t(stop.windowEnd)}. Please move vehicles from the driveway before ${t(stop.windowStart)}`.replace(/\.?$/, '.');
      tone = 'bg-sky-50 ring-sky-200 text-sky-900';
    }
  }

  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <p className="text-sm text-slate-500">Property</p>
      <p className="mb-4 text-lg font-semibold">{address}</p>
      <div className={`rounded-xl p-4 ring-1 ${tone}`}>
        <p className="flex items-center gap-2 text-lg font-semibold"><span aria-hidden className="text-2xl">{icon}</span>{headline}</p>
        <p className="mt-1">{detail}</p>
      </div>
      {stop?.windowStart && stop.status === 'pending' && (
        <p className="mt-3 text-sm text-slate-600">Arrival times are estimates and may change with weather and road conditions.</p>
      )}
    </div>
  );
}
