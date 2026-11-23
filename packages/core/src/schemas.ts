import { z } from 'zod';
import { CHANNELS, BLOCK_REASONS } from './types';
import { normalizePhone } from './phone';

export const phoneSchema = z
  .string()
  .trim()
  .min(1, 'Phone is required')
  .transform((v, ctx) => {
    const p = normalizePhone(v);
    if (!p) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid phone number, e.g. 506-555-0123' });
      return z.NEVER;
    }
    return p;
  });

const optionalEmail = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined))
  .pipe(z.email('Enter a valid email').optional());

export const clientInputSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  phone: phoneSchema,
  email: optionalEmail,
  notifyChannel: z.enum(CHANNELS).default('sms'),
  optedOut: z.boolean().default(false),
});
export type ClientInput = z.infer<typeof clientInputSchema>;

export const propertyInputSchema = z.object({
  clientId: z.uuid(),
  address: z.string().trim().min(3, 'Address is required').max(240),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  instructions: z.string().trim().max(1000).default(''),
  serviceMinutes: z.coerce.number().int().min(1, 'At least 1 minute').max(480).default(15),
  active: z.boolean().default(true),
});
export type PropertyInput = z.infer<typeof propertyInputSchema>;

export const routeDraftSchema = z.object({
  serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date'),
  plannedStartTime: z.string().regex(/^\d{2}:\d{2}$/, 'Pick a start time'),
  driverId: z.uuid('Pick a driver'),
  startAddress: z.string().trim().min(3, 'Enter a start location'),
  startLat: z.coerce.number(),
  startLng: z.coerce.number(),
  propertyIds: z.array(z.uuid()).min(1, 'Pick at least one property'),
});
export type RouteDraftInput = z.infer<typeof routeDraftSchema>;

export const STOP_UPDATE_STATUSES = ['in_progress', 'completed', 'blocked'] as const;
export type StopUpdateStatus = (typeof STOP_UPDATE_STATUSES)[number];

/** A driver's stop update. clientUuid makes retries idempotent. */
export const stopUpdateSchema = z.object({
  clientUuid: z.uuid(),
  stopId: z.uuid(),
  status: z.enum(STOP_UPDATE_STATUSES),
  note: z.string().trim().max(500).optional(),
  blockReason: z.enum(BLOCK_REASONS).optional(),
  occurredAt: z.iso.datetime({ offset: true }),
});
export type StopUpdateInput = z.infer<typeof stopUpdateSchema>;

export const manualMessageSchema = z.object({
  target: z.discriminatedUnion('type', [
    z.object({ type: z.literal('client'), clientId: z.uuid() }),
    z.object({ type: z.literal('route'), routeId: z.uuid() }),
  ]),
  body: z.string().trim().min(1, 'Write a message').max(480),
});
export type ManualMessageInput = z.infer<typeof manualMessageSchema>;
