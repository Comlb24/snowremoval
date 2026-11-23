import Link from 'next/link';
import { STATUS_LABELS, statusTone } from '@snow/core';
import type { ReactNode } from 'react';

const TONES = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-300',
  info: 'bg-sky-50 text-sky-800 ring-sky-300',
  success: 'bg-emerald-50 text-emerald-800 ring-emerald-300',
  warning: 'bg-amber-50 text-amber-900 ring-amber-300',
  danger: 'bg-rose-50 text-rose-800 ring-rose-300',
};
const ICONS = { neutral: '○', info: '◔', success: '✓', warning: '!', danger: '✕' };

/** Status badge: always text + icon + colour, never colour alone. */
export function Status({ status, label }: { status: string; label?: string }) {
  const tone = statusTone(status);
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}>
      <span aria-hidden>{ICONS[tone]}</span>
      {label ?? STATUS_LABELS[status] ?? status}
    </span>
  );
}

export function Tag({ children, tone = 'neutral' }: { children: ReactNode; tone?: keyof typeof TONES }) {
  return <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}>{children}</span>;
}

export function SimTag({ simulated }: { simulated: boolean }) {
  return simulated ? <Tag tone="warning">Simulated</Tag> : <Tag tone="success">Real</Tag>;
}

export function PageHeader({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
        {sub && <p className="mt-1 text-sm text-slate-600">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, children, actions, className = '' }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-base font-semibold text-slate-900">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

const BTN = {
  primary: 'bg-sky-700 text-white hover:bg-sky-800',
  secondary: 'bg-white text-slate-800 ring-1 ring-inset ring-slate-300 hover:bg-slate-50',
  danger: 'bg-white text-rose-700 ring-1 ring-inset ring-rose-300 hover:bg-rose-50',
  ghost: 'text-slate-700 hover:bg-slate-100',
};
export const btn = (v: keyof typeof BTN = 'primary', size: 'sm' | 'md' = 'md') =>
  `inline-flex items-center justify-center gap-1 rounded-lg font-medium disabled:opacity-50 ${size === 'sm' ? 'px-2.5 py-1 text-sm' : 'px-4 py-2 text-sm'} ${BTN[v]}`;

export function LinkButton({ href, children, variant = 'primary' }: { href: string; children: ReactNode; variant?: keyof typeof BTN }) {
  return (
    <Link href={href} className={btn(variant)}>
      {children}
    </Link>
  );
}

export const input = 'block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-600 focus:outline-none focus:ring-1 focus:ring-sky-600';
export const label = 'mb-1 block text-sm font-medium text-slate-700';

export function Field({ label: l, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block">
      <span className={label}>{l}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">{children}</p>;
}

export function Progress({ done, total }: { done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2" aria-label={`${done} of ${total} stops done`}>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200">
        <div className="h-full bg-emerald-600" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums text-slate-600">
        {done}/{total}
      </span>
    </div>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warning' | 'danger' | 'success'; children: ReactNode }) {
  return <div className={`rounded-lg px-3 py-2 text-sm ring-1 ring-inset ${TONES[tone]}`}>{children}</div>;
}
