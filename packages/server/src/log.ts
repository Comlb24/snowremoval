import { redactText } from '@snow/core';

/** Logger that strips phone numbers from every message. Never pass raw contact data to console directly. */
function write(level: 'info' | 'warn' | 'error', msg: string, extra?: Record<string, unknown>) {
  const line = redactText(msg + (extra ? ' ' + JSON.stringify(extra) : ''));
  // eslint-disable-next-line no-console
  console[level](`[snow] ${line}`);
}

export const log = {
  info: (m: string, e?: Record<string, unknown>) => write('info', m, e),
  warn: (m: string, e?: Record<string, unknown>) => write('warn', m, e),
  error: (m: string, e?: Record<string, unknown>) => write('error', m, e),
};
