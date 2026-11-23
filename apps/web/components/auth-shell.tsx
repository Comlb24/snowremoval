import type { ReactNode } from 'react';
import { config } from '@snow/server';
import { Snowfall } from './snowfall';
import { PlowScene } from './plow-truck';

export { glassInput, glassLabel, glassButton, glassLink } from './glass';

const CLOUDS = [
  { top: '6%', scale: 1.25, opacity: 0.32, duration: 160, delay: -20 },
  { top: '18%', scale: 0.8, opacity: 0.22, duration: 210, delay: -130 },
  { top: '30%', scale: 1.05, opacity: 0.18, duration: 240, delay: -60 },
  { top: '11%', scale: 0.6, opacity: 0.25, duration: 190, delay: -170 },
];

function Cloud({ top, scale, opacity, duration, delay }: (typeof CLOUDS)[number]) {
  return (
    <svg
      viewBox="0 0 320 120"
      className="sky-cloud absolute left-0 w-[420px] blur-[2px]"
      style={{ top, opacity, ['--s' as string]: scale, animationDuration: `${duration}s`, animationDelay: `${delay}s` }}
      aria-hidden
    >
      <g fill="white">
        <ellipse cx="160" cy="82" rx="150" ry="30" />
        <circle cx="105" cy="66" r="38" />
        <circle cx="160" cy="50" r="48" />
        <circle cx="218" cy="66" r="34" />
      </g>
    </svg>
  );
}

function Snowflake() {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
      <path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7" />
      <path d="M9.5 3.8L12 6l2.5-2.2M9.5 20.2L12 18l2.5 2.2M4 10.2l3.2-.9-.8-3.2M20 13.8l-3.2.9.8 3.2M4 13.8l3.2.9-.8 3.2M20 10.2l-3.2-.9.8-3.2" />
    </svg>
  );
}

/** Night-sky page with drifting clouds, falling snow and a frosted-glass card in the middle. */
export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="relative isolate flex min-h-screen items-center justify-center overflow-hidden bg-[#0b1d3a] px-4 pb-36 pt-14 text-white">
      {/* Sky */}
      <div aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_78%_8%,rgba(186,214,255,0.35),transparent_45%),linear-gradient(180deg,#0b1d3a_0%,#1d3d72_48%,#5f86c4_82%,#a9c4ea_100%)]" />
      <div aria-hidden className="absolute right-[12%] top-[7%] -z-10 h-20 w-20 rounded-full bg-[#f4f7ff] opacity-90 shadow-[0_0_80px_30px_rgba(220,232,255,0.35)]" />
      <div aria-hidden className="absolute inset-0 -z-10 overflow-hidden">
        {CLOUDS.map((c, i) => (
          <Cloud key={i} {...c} />
        ))}
      </div>
      {/* Snowy ground */}
      <svg aria-hidden viewBox="0 0 1440 220" preserveAspectRatio="none" className="fixed inset-x-0 bottom-0 -z-10 h-[22vh] min-h-32 w-full">
        <path d="M0 120 C 240 60 420 150 720 100 S 1200 50 1440 110 V220 H0Z" fill="#dbe8fb" opacity="0.75" />
        <path d="M0 160 C 300 110 560 190 860 150 S 1280 120 1440 160 V220 H0Z" fill="#f3f8ff" />
      </svg>
      <PlowScene />
      <Snowfall />

      <div className="relative w-full max-w-[400px]">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl border border-white/30 bg-white/15 text-white shadow-lg shadow-sky-950/30 backdrop-blur-md">
            <Snowflake />
          </div>
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-white/70">{config().businessName}</p>
        </div>

        <section className="rounded-3xl border border-white/25 bg-white/[0.12] p-6 shadow-2xl shadow-sky-950/40 backdrop-blur-xl sm:p-8">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-white/75">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </section>

        {footer && <div className="mt-6 text-center text-sm text-white/80">{footer}</div>}
      </div>
    </main>
  );
}

/** Error / success message that reads well on the glass card. */
export function GlassNotice({ tone, children }: { tone: 'danger' | 'success' | 'info'; children: ReactNode }) {
  const styles = {
    danger: 'border-rose-200/50 bg-rose-500/25',
    success: 'border-emerald-200/50 bg-emerald-500/25',
    info: 'border-white/30 bg-white/15',
  };
  const icon = { danger: '✕', success: '✓', info: 'i' };
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={`mb-5 flex gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm text-white ${styles[tone]}`}>
      <span aria-hidden className="mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/25 text-[11px] font-bold">
        {icon[tone]}
      </span>
      <span>{children}</span>
    </div>
  );
}
