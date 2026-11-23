import type { StopStatus, ServiceWindow } from './types';
import { addMinutes } from './time';

/** Half of the two-hour service window. */
export const WINDOW_HALF_MINUTES = 60;
/** Clients are notified this long before their window begins. */
export const NOTIFY_LEAD_MINUTES = 60;
/** Estimated arrivals are rounded to this step before the window is built, so messages read "9:15 – 11:15", not "9:07 – 11:07". */
export const ROUND_MINUTES = 15;

export interface ScheduleStopInput {
  id: string;
  /** Minutes spent at the property. */
  serviceMinutes: number;
  /** Driving minutes from the previous point (the start location for the first stop). */
  driveMinutes: number;
  status: StopStatus;
  /** ISO time the driver marked the stop in progress. */
  startedAt?: string | null;
  /** ISO time the stop was completed or blocked. */
  finishedAt?: string | null;
}

export interface ScheduleInput {
  plannedStart: Date;
  stops: ScheduleStopInput[];
  /** Current time. When given, upcoming arrivals are never earlier than now (progress-aware recalculation). */
  now?: Date;
  /** ISO time the driver started the shift, if started. */
  shiftStartedAt?: string | null;
}

export interface StopEstimate {
  id: string;
  /** Estimated (or actual, for started stops) arrival. Null for removed stops. */
  arrival: Date | null;
  /** Two-hour window around the rounded estimate. Null for stops no longer upcoming. */
  window: ServiceWindow | null;
  /** When the client should be told about the window. */
  notifyAt: Date | null;
  /** True when the stop is still to be visited. */
  upcoming: boolean;
}

export function roundToStep(d: Date, stepMinutes = ROUND_MINUTES): Date {
  const step = stepMinutes * 60_000;
  return new Date(Math.round(d.getTime() / step) * step);
}

export function windowFor(arrival: Date): { window: ServiceWindow; notifyAt: Date } {
  const center = roundToStep(arrival);
  const start = addMinutes(center, -WINDOW_HALF_MINUTES);
  const end = addMinutes(center, WINDOW_HALF_MINUTES);
  return {
    window: { start: start.toISOString(), end: end.toISOString() },
    notifyAt: addMinutes(start, -NOTIFY_LEAD_MINUTES),
  };
}

const maxDate = (a: Date, b?: Date) => (b && b > a ? b : a);

/**
 * Estimate arrival at each stop:
 *   planned start + driving time + service duration at preceding stops.
 * With `now`, the estimate follows real progress: finished stops use their real finish time,
 * a stop in progress ends no earlier than now, and no upcoming arrival is placed in the past.
 */
export function computeSchedule(input: ScheduleInput): StopEstimate[] {
  const { now } = input;
  const anyStarted = input.stops.some((s) => s.status !== 'pending' && s.status !== 'removed');
  let cursor: Date;
  // An early shift start never pulls estimates before the planned start: clients plan around the
  // published schedule, and starting a shift must not trigger messages to every client at once.
  if (input.shiftStartedAt) cursor = maxDate(input.plannedStart, new Date(input.shiftStartedAt));
  else cursor = anyStarted ? input.plannedStart : maxDate(input.plannedStart, now);

  // The published plan (no progress). Upcoming stops are never estimated earlier than this:
  // a crew running ahead must not tell clients to expect them earlier than planned
  // (vehicles would still be in the driveway). Delays still move estimates later.
  const planned = new Map<string, number>();
  if (now || anyStarted || input.shiftStartedAt) {
    let t = input.plannedStart;
    for (const s of input.stops) {
      if (s.status === 'removed') continue;
      t = addMinutes(t, s.driveMinutes);
      planned.set(s.id, t.getTime());
      t = addMinutes(t, s.serviceMinutes);
    }
  }

  const out: StopEstimate[] = [];
  for (const s of input.stops) {
    if (s.status === 'removed') {
      out.push({ id: s.id, arrival: null, window: null, notifyAt: null, upcoming: false });
      continue;
    }
    if (s.status === 'completed' || s.status === 'blocked') {
      const arrival = s.startedAt ? new Date(s.startedAt) : addMinutes(cursor, s.driveMinutes);
      cursor = s.finishedAt ? new Date(s.finishedAt) : addMinutes(arrival, s.status === 'blocked' ? 0 : s.serviceMinutes);
      out.push({ id: s.id, arrival, window: null, notifyAt: null, upcoming: false });
      continue;
    }
    if (s.status === 'in_progress') {
      const arrival = s.startedAt ? new Date(s.startedAt) : maxDate(addMinutes(cursor, s.driveMinutes), now);
      cursor = maxDate(addMinutes(arrival, s.serviceMinutes), now);
      out.push({ id: s.id, arrival, window: null, notifyAt: null, upcoming: false });
      continue;
    }
    // pending
    const p = planned.get(s.id);
    const arrival = maxDate(maxDate(addMinutes(cursor, s.driveMinutes), now), p ? new Date(p) : undefined);
    cursor = addMinutes(arrival, s.serviceMinutes);
    const { window, notifyAt } = windowFor(arrival);
    out.push({ id: s.id, arrival, window, notifyAt, upcoming: true });
  }
  return out;
}

/** Total route minutes (drive + service) for active stops — for route previews. */
export function routeDurationMinutes(stops: Pick<ScheduleStopInput, 'driveMinutes' | 'serviceMinutes' | 'status'>[]): number {
  return stops.filter((s) => s.status !== 'removed').reduce((sum, s) => sum + s.driveMinutes + s.serviceMinutes, 0);
}
