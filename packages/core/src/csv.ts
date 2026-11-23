import { CHANNELS, type Channel } from './types';
import { normalizePhone } from './phone';

/** Minimal RFC 4180 CSV parser (quotes, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

export const CSV_COLUMNS = ['client_name', 'phone', 'email', 'notify_method', 'address', 'latitude', 'longitude', 'instructions', 'service_minutes'] as const;
export const CSV_REQUIRED = ['client_name', 'phone', 'address'] as const;
export const CSV_TEMPLATE =
  CSV_COLUMNS.join(',') + '\nJane Doe,506-555-0101,jane@example.com,sms,"12 Main St, Moncton, NB",46.0878,-64.7782,Gate code 1234,15\n';

export interface ImportRow {
  line: number;
  clientName: string;
  phone: string | null;
  email: string | null;
  notifyChannel: Channel;
  address: string;
  lat: number | null;
  lng: number | null;
  instructions: string;
  serviceMinutes: number;
  errors: string[];
  warnings: string[];
  /** Rows with the same name + phone become one client with several properties. */
  clientKey: string;
}

export interface ImportPreview {
  rows: ImportRow[];
  headerErrors: string[];
  validCount: number;
  clientCount: number;
}

export function previewImport(text: string): ImportPreview {
  const table = parseCsv(text);
  const headerErrors: string[] = [];
  if (!table.length) return { rows: [], headerErrors: ['The file is empty'], validCount: 0, clientCount: 0 };
  const header = table[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  for (const r of CSV_REQUIRED) if (!header.includes(r)) headerErrors.push('Missing column: ' + r);
  if (headerErrors.length) return { rows: [], headerErrors, validCount: 0, clientCount: 0 };
  const get = (r: string[], c: string) => {
    const i = header.indexOf(c);
    return i >= 0 ? (r[i] ?? '').trim() : '';
  };

  const seen = new Set<string>();
  const rows: ImportRow[] = table.slice(1).map((r, i) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const clientName = get(r, 'client_name');
    if (!clientName) errors.push('Name is missing');
    const rawPhone = get(r, 'phone');
    const phone = rawPhone ? normalizePhone(rawPhone) : null;
    if (!rawPhone) errors.push('Phone is missing');
    else if (!phone) errors.push('Phone is not valid');
    const email = get(r, 'email') || null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Email is not valid');
    const method = (get(r, 'notify_method') || 'sms').toLowerCase();
    const known = (CHANNELS as readonly string[]).includes(method);
    const notifyChannel: Channel = known ? (method as Channel) : 'sms';
    if (!known) warnings.push('Unknown notify method "' + method + '", using SMS');
    const address = get(r, 'address');
    if (address.length < 3) errors.push('Address is missing');
    const latS = get(r, 'latitude');
    const lngS = get(r, 'longitude');
    let lat: number | null = latS ? Number(latS) : null;
    let lng: number | null = lngS ? Number(lngS) : null;
    if ((lat !== null && (!Number.isFinite(lat) || Math.abs(lat) > 90)) || (lng !== null && (!Number.isFinite(lng) || Math.abs(lng) > 180))) {
      errors.push('Coordinates are not valid');
      lat = lng = null;
    } else if (lat === null || lng === null) {
      lat = lng = null;
      warnings.push('No coordinates: the address will be looked up');
    }
    const sm = get(r, 'service_minutes');
    let serviceMinutes = 15;
    if (sm) {
      const n = Number(sm);
      if (!Number.isInteger(n) || n < 1 || n > 480) errors.push('Service minutes must be 1–480');
      else serviceMinutes = n;
    }
    const clientKey = clientName.toLowerCase() + '|' + (phone ?? rawPhone);
    const dupKey = clientKey + '|' + address.toLowerCase();
    if (seen.has(dupKey)) errors.push('Duplicate row (same client and address)');
    seen.add(dupKey);
    return { line: i + 2, clientName, phone, email, notifyChannel, address, lat, lng, instructions: get(r, 'instructions'), serviceMinutes, errors, warnings, clientKey };
  });
  const valid = rows.filter((r) => !r.errors.length);
  return { rows, headerErrors, validCount: valid.length, clientCount: new Set(valid.map((r) => r.clientKey)).size };
}
