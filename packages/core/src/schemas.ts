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

export const EQUIPMENT = ['snowplow', 'snowblower'] as const;
export type Equipment = (typeof EQUIPMENT)[number];
export const EQUIPMENT_LABELS: Record<Equipment, string> = { snowplow: 'Snowplow', snowblower: 'Snowblower' };
export const equipmentText = (e: readonly string[] | null | undefined) => (e ?? []).map((x) => EQUIPMENT_LABELS[x as Equipment] ?? x).join(' + ');

/** Dollar amount. Accepts "1200", "1,200.50" or "$1,200". Rounded to cents. */
export const moneySchema = z.preprocess(
  (v) => (typeof v === 'string' ? v.replace(/[$,\s]/g, '') : v),
  z.coerce.number({ message: 'Enter an amount, e.g. 250 or 250.00' }).min(0, 'Amount cannot be negative').max(10_000_000, 'Amount is too large').transform((n) => Math.round(n * 100) / 100),
);

export const paymentInputSchema = z.object({
  clientId: z.uuid(),
  amount: moneySchema.refine((n) => n > 0, 'Payment must be more than $0'),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date'),
  note: z.string().trim().max(200).default(''),
});
export type PaymentInput = z.infer<typeof paymentInputSchema>;

export const clientInputSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  phone: phoneSchema,
  email: optionalEmail,
  notifyChannel: z.enum(CHANNELS).default('sms'),
  optedOut: z.boolean().default(false),
}).refine((c) => c.notifyChannel !== 'email' || !!c.email, { message: 'Add an email address to send updates by email', path: ['email'] });
export type ClientInput = z.infer<typeof clientInputSchema>;

const optionalPhone = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined))
  .pipe(phoneSchema.optional());

/** Person living at a property who gets the service updates instead of the owner. */
export const residentInputSchema = z
  .object({
    name: z.string().trim().max(120).default(''),
    phone: optionalPhone,
    email: optionalEmail,
    notifyChannel: z.enum(CHANNELS).default('sms'),
  })
  .superRefine((r, ctx) => {
    if (!r.phone && !r.email) ctx.addIssue({ code: 'custom', message: 'Add the resident’s phone or email, or clear the resident fields', path: ['phone'] });
    else if (r.notifyChannel === 'email' && !r.email) ctx.addIssue({ code: 'custom', message: 'Add the resident’s email to send their updates by email', path: ['email'] });
    else if (r.notifyChannel !== 'email' && !r.phone) ctx.addIssue({ code: 'custom', message: 'Add the resident’s phone to send their updates by SMS or phone call', path: ['phone'] });
  });
export type ResidentInput = z.infer<typeof residentInputSchema>;

export const propertyInputSchema = z.object({
  clientId: z.uuid(),
  address: z.string().trim().min(3, 'Address is required').max(240),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  instructions: z.string().trim().max(1000).default(''),
  serviceMinutes: z.coerce.number().int().min(1, 'At least 1 minute').max(480).default(15),
  active: z.boolean().default(true),
  equipment: z.array(z.enum(EQUIPMENT)).default([]).transform((a) => [...new Set(a)]),
  /** Admin-only fields. Stored apart from the property so drivers and clients never read them. */
  quotedAmount: z.preprocess((v) => (v === '' || v === undefined ? null : v), moneySchema.nullable()).default(null),
  officeNotes: z.string().trim().max(2000).default(''),
  /** Null removes the resident (updates go to the owner). Left out: the resident stays as it is. */
  resident: residentInputSchema.nullable().optional(),
});
export type PropertyInput = z.infer<typeof propertyInputSchema>;
export type PropertyFormInput = z.input<typeof propertyInputSchema>;

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
