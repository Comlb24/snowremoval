import { randomUUID } from 'node:crypto';
import { redactEmail, redactPhone, type Channel } from '@snow/core';
import { config } from '../env';
import { log } from '../log';

export interface SendRequest {
  channel: Channel;
  to: string;
  /** SMS text, the script read aloud for a voice call, or the plain-text email body. */
  body: string;
  /** Email only. */
  subject?: string | null;
  notificationId: string;
}

export type SendResult =
  | { ok: true; providerRef: string; simulated: boolean }
  | { ok: false; error: string; simulated: boolean; retryable: boolean };

export interface Messenger {
  name: 'simulated' | 'twilio' | 'resend';
  simulated: boolean;
  send(req: SendRequest): Promise<SendResult>;
}

/**
 * Development messenger: records the message, sends nothing.
 * Numbers ending in 0000, and email addresses starting with "fail", simulate a delivery failure
 * so the "failed" path can be tested.
 */
export const simulatedMessenger: Messenger = {
  name: 'simulated',
  simulated: true,
  async send(req) {
    if (req.channel === 'email' ? /^fail/i.test(req.to) : /0000$/.test(req.to)) {
      return { ok: false, error: `Simulated failure: ${req.channel === 'email' ? 'email address' : 'number'} unreachable`, simulated: true, retryable: false };
    }
    log.info(`SIMULATED ${req.channel} to ${req.channel === 'email' ? redactEmail(req.to) : redactPhone(req.to)} (notification ${req.notificationId})`);
    return { ok: true, providerRef: `sim_${randomUUID()}`, simulated: true };
  },
};

function escapeXml(s: string) {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);
}

/** Twilio SMS + text-to-speech calls. Only ever constructed when live mode is fully configured in production. */
export function twilioMessenger(): Messenger {
  const c = config();
  if (c.appEnv !== 'production' || c.messagingMode !== 'live' || !c.twilio) {
    throw new Error('Refusing to create the live Twilio messenger outside production live mode');
  }
  const tw = c.twilio;
  let clientPromise: Promise<any> | null = null;
  const client = () => (clientPromise ??= import('twilio').then((m) => (m.default ?? m)(tw.accountSid, tw.authToken)));
  const callbackUrl = c.publicBaseUrl.startsWith('https://') ? `${c.publicBaseUrl}/api/webhooks/twilio` : undefined;

  return {
    name: 'twilio',
    simulated: false,
    async send(req) {
      // Second guard, checked on every send.
      if (config().appEnv !== 'production' || config().messagingMode !== 'live') {
        return { ok: false, error: 'Live sending is disabled outside production', simulated: false, retryable: false };
      }
      try {
        if (req.channel === 'email') return { ok: false, error: 'Email is not sent through Twilio', simulated: false, retryable: false };
        const tc = await client();
        if (req.channel === 'sms') {
          const msg = await tc.messages.create({
            to: req.to,
            body: req.body,
            ...(tw.messagingServiceSid ? { messagingServiceSid: tw.messagingServiceSid } : { from: tw.fromNumber }),
            ...(callbackUrl ? { statusCallback: callbackUrl } : {}),
          });
          return { ok: true, providerRef: msg.sid, simulated: false };
        }
        const call = await tc.calls.create({
          to: req.to,
          from: tw.fromNumber,
          twiml: `<Response><Say>${escapeXml(req.body)}</Say></Response>`,
          ...(callbackUrl ? { statusCallback: callbackUrl, statusCallbackEvent: ['completed'] } : {}),
        });
        return { ok: true, providerRef: call.sid, simulated: false };
      } catch (e: any) {
        const status = Number(e?.status ?? 0);
        return { ok: false, error: `Twilio error ${e?.code ?? ''}: ${String(e?.message ?? e)}`.slice(0, 300), simulated: false, retryable: status >= 500 || status === 429 };
      }
    },
  };
}

/** Email through Resend's HTTP API. Only ever constructed when live email is fully configured in production. */
export function resendMessenger(): Messenger {
  const c = config();
  if (c.appEnv !== 'production' || c.emailMode !== 'live' || !c.email) {
    throw new Error('Refusing to create the live email sender outside production live mode');
  }
  const em = c.email;
  return {
    name: 'resend',
    simulated: false,
    async send(req) {
      if (config().appEnv !== 'production' || config().emailMode !== 'live') {
        return { ok: false, error: 'Live sending is disabled outside production', simulated: false, retryable: false };
      }
      if (req.channel !== 'email') return { ok: false, error: 'Only email is sent through Resend', simulated: false, retryable: false };
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${em.apiKey}`,
            'Content-Type': 'application/json',
            // Resend ignores a repeat with the same key, so a retry never sends twice.
            'Idempotency-Key': req.notificationId,
          },
          body: JSON.stringify({ from: em.from, to: [req.to], subject: req.subject || 'Service update', text: req.body, ...(em.replyTo ? { reply_to: em.replyTo } : {}) }),
          signal: AbortSignal.timeout(15_000),
        });
        const data: any = await res.json().catch(() => ({}));
        if (res.ok && data?.id) return { ok: true, providerRef: String(data.id), simulated: false };
        return { ok: false, error: `Email error ${res.status}: ${String(data?.message ?? res.statusText)}`.slice(0, 300), simulated: false, retryable: res.status >= 500 || res.status === 429 };
      } catch (e: any) {
        return { ok: false, error: `Email error: ${String(e?.message ?? e)}`.slice(0, 300), simulated: false, retryable: true };
      }
    },
  };
}

let override: Messenger | null = null;
/** For tests. */
export function setMessenger(m: Messenger | null) {
  override = m;
}

/** The sender for one channel: email goes through the email provider, SMS and calls through Twilio. */
export function getMessenger(channel: Channel = 'sms'): Messenger {
  if (override) return override;
  if (channel === 'email') return config().emailMode === 'live' ? resendMessenger() : simulatedMessenger;
  return config().messagingMode === 'live' ? twilioMessenger() : simulatedMessenger;
}

/** Validate an incoming Twilio webhook (X-Twilio-Signature) with the official SDK helper. */
export async function validateTwilioSignature(signature: string, url: string, params: Record<string, string>): Promise<boolean> {
  const tw = config().twilio;
  if (!tw) return false;
  const m: any = await import('twilio');
  const validate = (m.default ?? m).validateRequest as (token: string, sig: string, url: string, params: Record<string, string>) => boolean;
  return validate(tw.authToken, signature, url, params);
}
