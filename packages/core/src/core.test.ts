import { describe, expect, it } from 'vitest';
import {
  computeSchedule, windowFor, zonedToUtc, formatTime, formatWindow, planNotifications, suggestOrder, pathCost,
  smsMessage, voiceMessage, normalizePhone, redactPhone, redactText, previewImport,
  type ExistingNotification, type PlannerStop, type ScheduleStopInput,
} from './index';

const TZ = 'America/Moncton';
const stop = (id: string, driveMinutes: number, serviceMinutes: number, extra: Partial<ScheduleStopInput> = {}): ScheduleStopInput => ({
  id, driveMinutes, serviceMinutes, status: 'pending', ...extra,
});

describe('arrival windows', () => {
  it('matches the spec example: arrival 10 a.m. -> window 9–11, notify at 8', () => {
    const start = zonedToUtc('2026-12-01', '09:40', TZ);
    const [s] = computeSchedule({ plannedStart: start, stops: [stop('a', 20, 15)] });
    expect(formatTime(s.arrival!, TZ)).toBe('10:00 a.m.');
    expect(formatWindow(s.window!, TZ)).toBe('9:00 a.m. – 11:00 a.m.');
    expect(formatTime(s.notifyAt!, TZ)).toBe('8:00 a.m.');
  });

  it('adds driving and service time of preceding stops', () => {
    const start = zonedToUtc('2026-12-01', '07:00', TZ);
    const res = computeSchedule({ plannedStart: start, stops: [stop('a', 10, 20), stop('b', 15, 30), stop('c', 5, 10)] });
    expect(res.map((r) => formatTime(r.arrival!, TZ))).toEqual(['7:10 a.m.', '7:45 a.m.', '8:20 a.m.']);
  });

  it('manual reordering changes the estimates', () => {
    // matrix: 0=start, 1=A, 2=B
    const m = [[0, 10, 40], [10, 0, 30], [40, 30, 0]];
    const start = zonedToUtc('2026-12-01', '07:00', TZ);
    const order1 = computeSchedule({ plannedStart: start, stops: [stop('A', m[0][1], 15), stop('B', m[1][2], 15)] });
    const order2 = computeSchedule({ plannedStart: start, stops: [stop('B', m[0][2], 15), stop('A', m[2][1], 15)] });
    expect(formatTime(order1[1].arrival!, TZ)).toBe('7:55 a.m.'); // B second
    expect(formatTime(order2[0].arrival!, TZ)).toBe('7:40 a.m.'); // B first
    expect(order1[0].arrival!.getTime()).not.toBe(order2[1].arrival!.getTime());
  });

  it('converts local start times correctly across daylight saving changes', () => {
    // Moncton: AST (UTC-4) in winter, ADT (UTC-3) in summer. 2026 changes: Mar 8 and Nov 1.
    expect(zonedToUtc('2026-03-07', '07:00', TZ).toISOString()).toBe('2026-03-07T11:00:00.000Z');
    expect(zonedToUtc('2026-03-08', '07:00', TZ).toISOString()).toBe('2026-03-08T10:00:00.000Z');
    expect(zonedToUtc('2026-10-31', '07:00', TZ).toISOString()).toBe('2026-10-31T10:00:00.000Z');
    expect(zonedToUtc('2026-11-01', '07:00', TZ).toISOString()).toBe('2026-11-01T11:00:00.000Z');
  });

  it('keeps a true two-hour window when the clocks change inside it', () => {
    // Spring forward at 2:00 a.m. local on Mar 8 2026 (06:00Z).
    const { window, notifyAt } = windowFor(new Date('2026-03-08T06:00:00Z'));
    expect(Date.parse(window.end) - Date.parse(window.start)).toBe(2 * 3600_000);
    expect(formatWindow(window, TZ)).toBe('1:00 a.m. – 4:00 a.m.'); // wall clock skips 2–3 a.m.
    expect(formatTime(notifyAt, TZ)).toBe('12:00 a.m.');
    // Fall back at 2:00 a.m. ADT on Nov 1 2026 (05:00Z).
    const fb = windowFor(new Date('2026-11-01T05:00:00Z'));
    expect(formatWindow(fb.window, TZ)).toBe('1:00 a.m. – 2:00 a.m.'); // 1:00 ADT -> 2:00 AST, 2 real hours
    expect(Date.parse(fb.window.end) - Date.parse(fb.window.start)).toBe(2 * 3600_000);
  });

  it('displays summer and winter routes in local time', () => {
    const s = computeSchedule({ plannedStart: zonedToUtc('2026-07-01', '09:40', TZ), stops: [stop('a', 20, 10)] });
    expect(formatTime(s[0].arrival!, TZ)).toBe('10:00 a.m.');
  });

  it('recalculates upcoming stops from real progress (delayed route)', () => {
    const start = zonedToUtc('2026-12-01', '07:00', TZ);
    const finished = zonedToUtc('2026-12-01', '08:30', TZ).toISOString(); // stop a took far longer
    const res = computeSchedule({
      plannedStart: start,
      now: zonedToUtc('2026-12-01', '08:31', TZ),
      shiftStartedAt: start.toISOString(),
      stops: [stop('a', 10, 20, { status: 'completed', startedAt: zonedToUtc('2026-12-01', '07:10', TZ).toISOString(), finishedAt: finished }), stop('b', 15, 30)],
    });
    expect(formatTime(res[1].arrival!, TZ)).toBe('8:45 a.m.');
    expect(res[0].upcoming).toBe(false);
  });

  it('an early shift start does not move estimates earlier; a late one moves them later', () => {
    const start = zonedToUtc('2026-12-01', '07:00', TZ);
    const base = computeSchedule({ plannedStart: start, stops: [stop('a', 10, 20)] })[0].arrival!;
    const early = computeSchedule({ plannedStart: start, now: zonedToUtc('2026-12-01', '05:00', TZ), shiftStartedAt: zonedToUtc('2026-12-01', '05:00', TZ).toISOString(), stops: [stop('a', 10, 20)] })[0].arrival!;
    const late = computeSchedule({ plannedStart: start, now: zonedToUtc('2026-12-01', '07:30', TZ), shiftStartedAt: zonedToUtc('2026-12-01', '07:30', TZ).toISOString(), stops: [stop('a', 10, 20)] })[0].arrival!;
    expect(early.getTime()).toBe(base.getTime());
    expect(formatTime(late, TZ)).toBe('7:40 a.m.');
  });

  it('a crew running ahead of plan does not pull upcoming estimates earlier', () => {
    const start = zonedToUtc('2026-12-01', '07:00', TZ);
    const plan = computeSchedule({ plannedStart: start, stops: [stop('a', 10, 20), stop('b', 15, 30)] });
    // Stop a finished the evening before (e.g. done early): b must stay at its planned time.
    const early = computeSchedule({
      plannedStart: start,
      now: zonedToUtc('2026-11-30', '21:30', TZ),
      stops: [stop('a', 10, 20, { status: 'completed', finishedAt: zonedToUtc('2026-11-30', '21:30', TZ).toISOString() }), stop('b', 15, 30)],
    });
    expect(early[1].arrival!.getTime()).toBe(plan[1].arrival!.getTime());
  });

  it('never estimates an upcoming arrival in the past', () => {
    const start = zonedToUtc('2026-12-01', '07:00', TZ);
    const now = zonedToUtc('2026-12-01', '09:00', TZ);
    const res = computeSchedule({ plannedStart: start, now, stops: [stop('a', 10, 20)] });
    expect(res[0].arrival!.getTime()).toBeGreaterThanOrEqual(now.getTime());
  });

  it('skips removed stops and gives no window to finished stops', () => {
    const start = zonedToUtc('2026-12-01', '07:00', TZ);
    const res = computeSchedule({ plannedStart: start, stops: [stop('a', 10, 20, { status: 'removed' }), stop('b', 10, 20)] });
    expect(res[0].window).toBeNull();
    expect(formatTime(res[1].arrival!, TZ)).toBe('7:10 a.m.');
  });
});

describe('notification planner', () => {
  const day = '2026-12-01';
  const at = (t: string) => zonedToUtc(day, t, TZ);
  const estimateAt = (arrivalLocal: string) => {
    const arrival = at(arrivalLocal);
    const { window, notifyAt } = windowFor(arrival);
    return { id: 's1', arrival, window, notifyAt, upcoming: true };
  };
  const pstop = (arrivalLocal: string, extra: Partial<PlannerStop> = {}): PlannerStop => ({
    stopId: 's1', status: 'pending', estimate: estimateAt(arrivalLocal), eligible: true, channel: 'sms', ...extra,
  });
  const sent = (w: { start: string; end: string }, sentAtLocal: string, kind: 'initial' | 'update' = 'initial', id = 'n-sent'): ExistingNotification => ({
    id, stopId: 's1', kind, status: 'sent', windowStart: w.start, windowEnd: w.end, scheduledAt: at(sentAtLocal).toISOString(), sentAt: at(sentAtLocal).toISOString(),
  });

  it('schedules one notification one hour before the window', () => {
    const r = planNotifications({ routeStatus: 'published', stops: [pstop('10:00')], existing: [], now: at('06:00') });
    expect(r.create).toHaveLength(1);
    expect(formatTime(r.create[0].scheduledAt, TZ)).toBe('8:00 a.m.');
    expect(r.create[0].immediate).toBe(false);
  });

  it('is idempotent: re-running with the scheduled row creates nothing', () => {
    const first = planNotifications({ routeStatus: 'published', stops: [pstop('10:00')], existing: [], now: at('06:00') });
    const c = first.create[0];
    const existing: ExistingNotification[] = [{ id: 'n1', stopId: 's1', kind: 'initial', status: 'scheduled', windowStart: c.window.start, windowEnd: c.window.end, scheduledAt: c.scheduledAt.toISOString(), sentAt: null }];
    const again = planNotifications({ routeStatus: 'published', stops: [pstop('10:00')], existing, now: at('06:05') });
    expect(again.create).toHaveLength(0);
    expect(again.cancel).toHaveLength(0);
  });

  it('replaces a stale scheduled notification when the estimate moves', () => {
    const w = windowFor(at('10:00')).window;
    const existing: ExistingNotification[] = [{ id: 'old', stopId: 's1', kind: 'initial', status: 'scheduled', windowStart: w.start, windowEnd: w.end, scheduledAt: at('08:00').toISOString(), sentAt: null }];
    const r = planNotifications({ routeStatus: 'published', stops: [pstop('10:30')], existing, now: at('06:00') });
    expect(r.cancel.map((c) => c.id)).toEqual(['old']);
    expect(r.create).toHaveLength(1);
    expect(formatTime(r.create[0].scheduledAt, TZ)).toBe('8:30 a.m.');
  });

  it('late publication sends exactly one immediate notification with the current estimate', () => {
    const now = at('09:30');
    const r = planNotifications({ routeStatus: 'published', stops: [pstop('10:00')], existing: [], now });
    expect(r.create).toHaveLength(1);
    expect(r.create[0].immediate).toBe(true);
    expect(r.create[0].scheduledAt.getTime()).toBe(now.getTime());
    // after it is sent, nothing more is planned (no historical back-fill)
    const after = planNotifications({ routeStatus: 'published', stops: [pstop('10:00')], existing: [sent(r.create[0].window, '09:30')], now: at('09:31') });
    expect(after.create).toHaveLength(0);
  });

  it('sends no update while the revised arrival stays inside the communicated window', () => {
    const w = windowFor(at('10:00')).window;
    const r = planNotifications({ routeStatus: 'in_progress', stops: [pstop('10:50')], existing: [sent(w, '08:00')], now: at('09:00') });
    expect(r.create).toHaveLength(0);
  });

  it('sends an updated window when the arrival falls outside the communicated one', () => {
    const w = windowFor(at('10:00')).window;
    const r = planNotifications({ routeStatus: 'in_progress', stops: [pstop('11:30')], existing: [sent(w, '08:00')], now: at('09:00') });
    expect(r.create).toHaveLength(1);
    expect(r.create[0].kind).toBe('update');
    expect(formatWindow(r.create[0].window, TZ)).toBe('10:30 a.m. – 12:30 p.m.');
  });

  it('waits a minimum gap between messages and caps repeated updates', () => {
    const w1 = windowFor(at('10:00')).window;
    const gap = planNotifications({ routeStatus: 'in_progress', stops: [pstop('11:30')], existing: [sent(w1, '08:50')], now: at('09:00') });
    expect(formatTime(gap.create[0].scheduledAt, TZ)).toBe('9:20 a.m.');

    const w2 = windowFor(at('11:30')).window;
    const w3 = windowFor(at('13:00')).window;
    const existing = [sent(w1, '08:00', 'initial', 'a'), sent(w2, '09:00', 'update', 'b'), sent(w3, '10:00', 'update', 'c')];
    const capped = planNotifications({ routeStatus: 'in_progress', stops: [pstop('15:00')], existing, now: at('11:00') });
    expect(capped.create).toHaveLength(0);
    expect(capped.suppressed).toHaveLength(1);
  });

  it('cancels pending notifications for paused or cancelled routes', () => {
    const w = windowFor(at('10:00')).window;
    const existing: ExistingNotification[] = [{ id: 'p', stopId: 's1', kind: 'initial', status: 'scheduled', windowStart: w.start, windowEnd: w.end, scheduledAt: at('08:00').toISOString(), sentAt: null }];
    for (const routeStatus of ['paused', 'cancelled', 'draft'] as const) {
      const r = planNotifications({ routeStatus, stops: [pstop('10:00')], existing, now: at('06:00') });
      expect(r.cancel.map((c) => c.id)).toEqual(['p']);
      expect(r.create).toHaveLength(0);
    }
  });

  it('never notifies completed, blocked or removed stops, or opted-out clients', () => {
    const w = windowFor(at('10:00')).window;
    const existing: ExistingNotification[] = [{ id: 'p', stopId: 's1', kind: 'initial', status: 'scheduled', windowStart: w.start, windowEnd: w.end, scheduledAt: at('08:00').toISOString(), sentAt: null }];
    for (const status of ['completed', 'blocked', 'removed', 'in_progress'] as const) {
      const r = planNotifications({ routeStatus: 'in_progress', stops: [pstop('10:00', { status })], existing, now: at('06:00') });
      expect(r.create).toHaveLength(0);
      expect(r.cancel).toHaveLength(1);
    }
    const opted = planNotifications({ routeStatus: 'published', stops: [pstop('10:00', { eligible: false })], existing, now: at('06:00') });
    expect(opted.create).toHaveLength(0);
    expect(opted.cancel).toHaveLength(1);
  });

  it('cancels notifications for stops taken off the route', () => {
    const existing: ExistingNotification[] = [{ id: 'gone', stopId: 'other', kind: 'initial', status: 'scheduled', windowStart: null, windowEnd: null, scheduledAt: at('08:00').toISOString(), sentAt: null }];
    const r = planNotifications({ routeStatus: 'published', stops: [pstop('10:00')], existing, now: at('06:00') });
    expect(r.cancel.map((c) => c.id)).toContain('gone');
  });

  it('starting a shift alone does not create messages for every client', () => {
    // Shift starts at 07:00 with windows far ahead: nothing is due, nothing immediate.
    const r = planNotifications({ routeStatus: 'in_progress', stops: [pstop('11:00'), { ...pstop('13:00'), stopId: 's2' }], existing: [], now: at('07:00') });
    expect(r.create.every((c) => !c.immediate && c.scheduledAt > at('07:00'))).toBe(true);
  });
});

describe('stop ordering', () => {
  it('suggests a short order and never worse than the input order', () => {
    // points on a line at km 0 (start), 5, 1, 3
    const pos = [0, 5, 1, 3];
    const m = pos.map((a) => pos.map((b) => Math.abs(a - b)));
    const order = suggestOrder(m);
    expect(order).toEqual([2, 3, 1]);
    expect(pathCost(order, m)).toBeLessThanOrEqual(pathCost([1, 2, 3], m));
  });
});

describe('message templates', () => {
  const input = { name: 'Jane Doe', address: '12 Main St', window: windowFor(zonedToUtc('2026-12-01', '10:00', TZ)).window, businessName: 'Demo Snow Co.' };
  it('SMS follows the template', () => {
    expect(smsMessage(input)).toBe('Hi Jane, snow removal at 12 Main St is expected today between 9:00 a.m. and 11:00 a.m. Please move vehicles from the driveway before 9:00 a.m. Arrival times are approximate.');
  });
  it('voice follows the template', () => {
    expect(voiceMessage(input)).toContain('automated service update from Demo Snow Co.');
    expect(voiceMessage(input)).toContain('may change with weather and road conditions. Thank you.');
  });
});

describe('phone numbers', () => {
  it('normalises and redacts', () => {
    expect(normalizePhone('(506) 555-0123')).toBe('+15065550123');
    expect(normalizePhone('1-506-555-0123')).toBe('+15065550123');
    expect(normalizePhone('555')).toBeNull();
    expect(redactPhone('+15065550123')).toBe('***23');
    expect(redactText('Failed to send to +15065550123 today')).toBe('Failed to send to ***23 today');
  });
});

describe('CSV import preview', () => {
  it('groups several properties under one client and validates rows', () => {
    const csv = [
      'client_name,phone,email,notify_method,address,latitude,longitude,instructions,service_minutes',
      'Jane Doe,506-555-0101,,sms,"12 Main St, Moncton",46.08,-64.77,,15',
      'Jane Doe,506-555-0101,,voice,"99 Elm St, Moncton",46.09,-64.78,Back lane,20',
      'Bad Phone,12,,sms,1 Oak St,,,,',
      'Jane Doe,506-555-0101,,sms,"12 Main St, Moncton",46.08,-64.77,,15',
    ].join('\n');
    const p = previewImport(csv);
    expect(p.validCount).toBe(2);
    expect(p.clientCount).toBe(1);
    expect(p.rows[2].errors).toContain('Phone is not valid');
    expect(p.rows[3].errors[0]).toMatch(/Duplicate/);
    expect(p.rows[1].notifyChannel).toBe('voice');
  });
  it('reports missing columns', () => {
    expect(previewImport('name,address\nx,y').headerErrors.length).toBeGreaterThan(0);
  });
});
