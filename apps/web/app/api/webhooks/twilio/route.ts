import { NextResponse } from 'next/server';
import { applyProviderStatus, config, validateTwilioSignature } from '@snow/server';

export const dynamic = 'force-dynamic';

/** Twilio delivery status callback (SMS and calls). Signature checked with the official SDK helper. */
export async function POST(req: Request) {
  const form = await req.formData();
  const params: Record<string, string> = {};
  form.forEach((v, k) => (params[k] = String(v)));
  const url = `${config().publicBaseUrl}/api/webhooks/twilio`;
  const ok = await validateTwilioSignature(req.headers.get('x-twilio-signature') ?? '', url, params);
  if (!ok) return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
  const ref = params.MessageSid ?? params.CallSid;
  const status = params.MessageStatus ?? params.CallStatus;
  if (ref && status) await applyProviderStatus(ref, status, params.ErrorCode);
  return new Response('<Response/>', { headers: { 'Content-Type': 'text/xml' } });
}
