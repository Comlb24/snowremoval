import { formatTime, DEFAULT_TIME_ZONE } from './time';
import type { ServiceWindow } from './types';

export interface TemplateInput {
  name: string;
  address: string;
  window: ServiceWindow;
  businessName: string;
  timeZone?: string;
}

function parts(i: TemplateInput) {
  const tz = i.timeZone ?? DEFAULT_TIME_ZONE;
  return { start: formatTime(i.window.start, tz), end: formatTime(i.window.end, tz), first: i.name.trim().split(/\s+/)[0] || i.name };
}

const tidy = (s: string) => s.replace(/\.\./g, '.');

export function smsMessage(i: TemplateInput, isUpdate = false): string {
  const p = parts(i);
  const lead = isUpdate ? 'Updated time: ' : '';
  return tidy(`${lead}Hi ${p.first}, snow removal at ${i.address} is expected today between ${p.start} and ${p.end}. Please move vehicles from the driveway before ${p.start}. Arrival times are approximate.`);
}

export function voiceMessage(i: TemplateInput, isUpdate = false): string {
  const p = parts(i);
  const lead = isUpdate ? 'This is an updated time. ' : '';
  return tidy(`Hello, this is an automated service update from ${i.businessName}. ${lead}Snow removal at ${i.address} is expected today between ${p.start} and ${p.end}. Please move vehicles from the driveway before ${p.start}. Arrival times are approximate and may change with weather and road conditions. Thank you.`);
}

/** Email: a subject line plus a plain-text body. */
export function emailMessage(i: TemplateInput, isUpdate = false): { subject: string; body: string } {
  const p = parts(i);
  const subject = `${isUpdate ? 'Updated time: ' : ''}Snow removal at ${i.address} today, ${p.start} to ${p.end}`;
  const body = tidy(
    `Hi ${p.first},\n\n` +
      `${isUpdate ? 'We have an updated time for you. ' : ''}Snow removal at ${i.address} is expected today between ${p.start} and ${p.end}.\n\n` +
      `Please move vehicles from the driveway before ${p.start}. Arrival times are approximate and may change with weather and road conditions.\n\n` +
      `Thank you,\n${i.businessName}`,
  );
  return { subject, body };
}

/** Sent when the driver taps "On my way" for a stop. */
export function onMyWayMessage(i: { name: string; address: string; businessName: string }, channel: 'sms' | 'voice' | 'email') {
  const first = i.name.trim().split(/\s+/)[0] || i.name;
  const core = `your driver from ${i.businessName} is on the way to ${i.address} now. Please move any vehicles from the driveway.`;
  if (channel === 'email') {
    return { subject: `Your snow removal driver is on the way to ${i.address}`, body: tidy(`Hi ${first},\n\n${core[0].toUpperCase()}${core.slice(1)}\n\nThank you,\n${i.businessName}`) };
  }
  if (channel === 'voice') return { subject: null, body: tidy(`Hello, this is an automated service update. ${core[0].toUpperCase()}${core.slice(1)} Thank you.`) };
  return { subject: null, body: tidy(`Hi ${first}, ${core} Reply STOP to opt out.`) };
}

/** Subject line for a message an admin sends by hand. */
export const manualEmailSubject = (businessName: string) => `Service update from ${businessName}`;
