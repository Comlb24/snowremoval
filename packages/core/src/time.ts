import { fromZonedTime, formatInTimeZone } from 'date-fns-tz';

export const DEFAULT_TIME_ZONE = 'America/Moncton';

/** Convert a local date ("2026-12-01") + time ("07:00") in a zone to a UTC Date. */
export function zonedToUtc(date: string, time: string, tz: string = DEFAULT_TIME_ZONE): Date {
  return fromZonedTime(`${date}T${time.length === 5 ? time + ':00' : time}`, tz);
}

export function addMinutes(d: Date, minutes: number): Date {
  return new Date(d.getTime() + minutes * 60_000);
}

export function minutesBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 60_000;
}

/** "10:00 a.m." style label in the given zone. */
export function formatTime(d: Date | string, tz: string = DEFAULT_TIME_ZONE): string {
  const s = formatInTimeZone(typeof d === 'string' ? new Date(d) : d, tz, 'h:mm a');
  return s.replace('AM', 'a.m.').replace('PM', 'p.m.');
}

export function formatDate(d: Date | string, tz: string = DEFAULT_TIME_ZONE): string {
  return formatInTimeZone(typeof d === 'string' ? new Date(d) : d, tz, 'EEE, MMM d');
}

export function formatDateTime(d: Date | string, tz: string = DEFAULT_TIME_ZONE): string {
  return `${formatDate(d, tz)}, ${formatTime(d, tz)}`;
}

/** Local calendar date ("YYYY-MM-DD") for an instant in a zone. */
export function localDate(d: Date | string, tz: string = DEFAULT_TIME_ZONE): string {
  return formatInTimeZone(typeof d === 'string' ? new Date(d) : d, tz, 'yyyy-MM-dd');
}

export function localTime(d: Date | string, tz: string = DEFAULT_TIME_ZONE): string {
  return formatInTimeZone(typeof d === 'string' ? new Date(d) : d, tz, 'HH:mm');
}

export function formatWindow(w: { start: string | Date; end: string | Date }, tz: string = DEFAULT_TIME_ZONE): string {
  return `${formatTime(w.start, tz)} – ${formatTime(w.end, tz)}`;
}
