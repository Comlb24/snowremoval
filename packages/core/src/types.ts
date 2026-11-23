export const ROLES = ['admin', 'driver', 'client'] as const;
export type Role = (typeof ROLES)[number];

export const CHANNELS = ['sms', 'voice', 'email'] as const;
export type Channel = (typeof CHANNELS)[number];
export const CHANNEL_LABELS: Record<Channel, string> = { sms: 'SMS', voice: 'Voice call', email: 'Email' };

export const ROUTE_STATUSES = ['draft', 'published', 'in_progress', 'paused', 'completed', 'cancelled'] as const;
export type RouteStatus = (typeof ROUTE_STATUSES)[number];

/** Route states in which clients may receive automatic notifications. */
export const NOTIFYING_ROUTE_STATUSES: readonly RouteStatus[] = ['published', 'in_progress'];

export const STOP_STATUSES = ['pending', 'in_progress', 'completed', 'blocked', 'removed'] as const;
export type StopStatus = (typeof STOP_STATUSES)[number];

/** Stops that will not be serviced (any more) and must never be notified. */
export const CLOSED_STOP_STATUSES: readonly StopStatus[] = ['completed', 'blocked', 'removed'];

export const NOTIFICATION_KINDS = ['initial', 'update', 'manual'] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const NOTIFICATION_STATUSES = [
  'scheduled', // waiting for its send time
  'sending', // claimed by a worker
  'sent', // accepted by the provider (or simulated)
  'delivered', // provider confirmed delivery / call completed
  'failed', // provider rejected or delivery failed
  'cancelled', // replaced or no longer relevant
] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

/** Notifications the client has (most likely) received. */
export const COMMUNICATED_STATUSES: readonly NotificationStatus[] = ['sent', 'delivered'];

export const BLOCK_REASONS = ['Vehicle in driveway', 'Gate locked', 'Unsafe conditions', 'Other'] as const;

export interface ServiceWindow {
  /** ISO UTC */
  start: string;
  /** ISO UTC */
  end: string;
}

export const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  published: 'Published',
  in_progress: 'In progress',
  paused: 'Paused',
  completed: 'Completed',
  cancelled: 'Cancelled',
  pending: 'Not started',
  blocked: 'Blocked',
  removed: 'Removed',
  scheduled: 'Scheduled',
  sending: 'Sending',
  sent: 'Sent',
  delivered: 'Delivered',
  failed: 'Failed',
};

/** Colour tone for a status. Always shown next to the text label, never alone. */
export function statusTone(status: string): 'neutral' | 'info' | 'success' | 'warning' | 'danger' {
  switch (status) {
    case 'completed':
    case 'delivered':
      return 'success';
    case 'in_progress':
    case 'published':
    case 'sent':
    case 'sending':
    case 'scheduled':
      return 'info';
    case 'blocked':
    case 'paused':
      return 'warning';
    case 'failed':
    case 'cancelled':
      return 'danger';
    default:
      return 'neutral';
  }
}
