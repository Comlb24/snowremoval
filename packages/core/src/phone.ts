/** Normalise a North American phone number to E.164 (+1XXXXXXXXXX). Returns null if invalid. */
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+') && !trimmed.startsWith('+1')) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  const d = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (d.length !== 10 || /^[01]/.test(d)) return null;
  return `+1${d}`;
}

/** Display form: (506) 555-0123 */
export function formatPhone(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}

/** Safe for logs: keeps only the last 2 digits. */
export function redactPhone(value: string | null | undefined): string {
  if (!value) return '';
  const d = value.replace(/\D/g, '');
  return `***${d.slice(-2)}`;
}

const PHONE_PATTERN = /\+?\d[\d\s().-]{7,}\d/g;

/** Remove anything that looks like a phone number from free text (log lines, errors). */
export function redactText(text: string): string {
  return text.replace(PHONE_PATTERN, (m) => redactPhone(m));
}
