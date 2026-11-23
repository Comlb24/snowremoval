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
