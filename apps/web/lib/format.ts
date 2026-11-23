import { formatDate, formatDateTime, formatTime, formatWindow, formatPhone } from '@snow/core';
import { config } from '@snow/server';

const tz = () => config().timeZone;
const toIso = (d: Date | string) => (d instanceof Date ? d.toISOString() : d);

export const t = (d: Date | string | null | undefined) => (d ? formatTime(toIso(d), tz()) : '—');
export const dt = (d: Date | string | null | undefined) => (d ? formatDateTime(toIso(d), tz()) : '—');
export const day = (d: Date | string | null | undefined) => (d ? formatDate(typeof d === 'string' && d.length === 10 ? d + 'T12:00:00Z' : toIso(d), tz()) : '—');
export const win = (s: Date | string | null | undefined, e: Date | string | null | undefined) => (s && e ? formatWindow({ start: toIso(s), end: toIso(e) }, tz()) : '—');
export const phone = (p: string | null | undefined) => (p ? formatPhone(p) : '—');
