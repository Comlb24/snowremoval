import type { Channel, NotificationKind, NotificationStatus, RouteStatus, ServiceWindow, StopStatus } from './types';
import { NOTIFYING_ROUTE_STATUSES } from './types';
import type { StopEstimate } from './eta';
import { addMinutes } from './time';

export const MAX_UPDATES_PER_STOP = 2;
export const MIN_MINUTES_BETWEEN_MESSAGES = 30;

export interface PlannerStop {
  stopId: string;
  status: StopStatus;
  estimate: StopEstimate;
  /** False when the client opted out, has no phone or email for their channel, or the property is inactive. */
  eligible: boolean;
  channel: Channel;
  /** Phone or email the message goes to. When given, a waiting message to another address is replaced. */
  to?: string | null;
}

export interface ExistingNotification {
  id: string;
  stopId: string | null;
  kind: NotificationKind;
  status: NotificationStatus;
  windowStart: string | null;
  windowEnd: string | null;
  scheduledAt: string;
  sentAt: string | null;
  channel?: Channel;
  to?: string | null;
}

export interface PlannedNotification {
  stopId: string;
  kind: 'initial' | 'update';
  channel: Channel;
  window: ServiceWindow;
  scheduledAt: Date;
  /** True when the normal send time already passed (late publish) or this is an update. */
  immediate: boolean;
  dedupeKey: string;
}

export interface PlannerResult {
  cancel: { id: string; reason: string }[];
  create: PlannedNotification[];
  /** Stops where an update was needed but held back by the repeat limit. */
  suppressed: { stopId: string; reason: string }[];
}

export interface PlannerInput {
  routeStatus: RouteStatus;
  stops: PlannerStop[];
  existing: ExistingNotification[];
  now: Date;
  maxUpdates?: number;
  minGapMinutes?: number;
}

const IN_FLIGHT: NotificationStatus[] = ['sending', 'sent', 'delivered'];

/**
 * Decide which automatic notifications should exist for a route right now.
 * Pure: the caller applies the result (cancel rows, insert rows). Running it again with
 * the same state produces no changes, so it is safe to run on every tick and every edit.
 */
export function planNotifications(input: PlannerInput): PlannerResult {
  const { now } = input;
  const maxUpdates = input.maxUpdates ?? MAX_UPDATES_PER_STOP;
  const minGap = input.minGapMinutes ?? MIN_MINUTES_BETWEEN_MESSAGES;
  const result: PlannerResult = { cancel: [], create: [], suppressed: [] };
  const routeActive = NOTIFYING_ROUTE_STATUSES.includes(input.routeStatus);
  const stopIds = new Set(input.stops.map((s) => s.stopId));

  // Stops removed from the route entirely: cancel anything still waiting.
  for (const n of input.existing) {
    if (n.kind !== 'manual' && n.status === 'scheduled' && n.stopId && !stopIds.has(n.stopId)) {
      result.cancel.push({ id: n.id, reason: 'Stop removed from route' });
    }
  }

  for (const stop of input.stops) {
    const mine = input.existing.filter((n) => n.stopId === stop.stopId && n.kind !== 'manual');
    const pending = mine.filter((n) => n.status === 'scheduled');
    const cancelAll = (reason: string) => pending.forEach((n) => result.cancel.push({ id: n.id, reason }));

    if (!routeActive) { cancelAll(`Route ${input.routeStatus}`); continue; }
    if (stop.status !== 'pending' || !stop.estimate.upcoming || !stop.estimate.window || !stop.estimate.arrival) {
      cancelAll(`Stop ${stop.status}`); continue;
    }
    if (!stop.eligible) { cancelAll('Client not eligible (opted out, inactive or no contact details)'); continue; }

    const communicated = mine
      .filter((n) => IN_FLIGHT.includes(n.status) && n.windowStart && n.windowEnd)
      .sort((a, b) => (a.sentAt ?? a.scheduledAt).localeCompare(b.sentAt ?? b.scheduledAt));
    const last = communicated[communicated.length - 1];
    const window = stop.estimate.window;
    const arrival = stop.estimate.arrival;

    let desired: PlannedNotification | null = null;
    if (!last) {
      const notifyAt = stop.estimate.notifyAt!;
      const late = notifyAt.getTime() <= now.getTime();
      desired = {
        stopId: stop.stopId, kind: 'initial', channel: stop.channel, window,
        scheduledAt: late ? now : notifyAt, immediate: late,
        dedupeKey: `${stop.stopId}:initial:${window.start}`,
      };
    } else {
      const inside = arrival.getTime() >= Date.parse(last.windowStart!) && arrival.getTime() <= Date.parse(last.windowEnd!);
      if (!inside) {
        const updatesSent = communicated.filter((n) => n.kind === 'update').length;
        if (updatesSent >= maxUpdates) {
          result.suppressed.push({ stopId: stop.stopId, reason: `Update limit reached (${maxUpdates})` });
        } else {
          const earliest = addMinutes(new Date(last.sentAt ?? last.scheduledAt), minGap);
          const at = earliest > now ? earliest : now;
          desired = {
            stopId: stop.stopId, kind: 'update', channel: stop.channel, window,
            scheduledAt: at, immediate: true,
            dedupeKey: `${stop.stopId}:update:${communicated.length}:${window.start}`,
          };
        }
      }
    }

    if (!desired) { cancelAll('Estimate still inside communicated window'); continue; }

    // A waiting message is kept only if it still matches: same time window, and the client's current channel and address.
    const sameContact = (n: ExistingNotification) => (n.channel === undefined || n.channel === stop.channel) && (n.to === undefined || stop.to === undefined || n.to === stop.to);
    const keep = pending.find(
      (n) => n.kind === desired!.kind && n.windowStart === desired!.window.start && n.windowEnd === desired!.window.end && sameContact(n),
    );
    for (const n of pending) if (n !== keep) result.cancel.push({ id: n.id, reason: sameContact(n) ? 'Replaced by newer estimate' : 'Contact method changed' });
    if (!keep) result.create.push(desired);
  }
  return result;
}
