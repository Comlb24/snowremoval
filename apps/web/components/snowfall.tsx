'use client';
import { useEffect, useRef } from 'react';

type Flake = { x: number; y: number; r: number; speed: number; drift: number; phase: number; alpha: number };

/** Falling snow on a full-screen canvas. Pauses when the tab is hidden; shows still flakes when the user prefers less motion. */
export function Snowfall() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let w = 0;
    let h = 0;
    let flakes: Flake[] = [];
    let frame = 0;
    let last = performance.now();

    const make = (anyY: boolean): Flake => {
      const depth = Math.random(); // 0 = far away, 1 = close
      return {
        x: Math.random() * w,
        y: anyY ? Math.random() * h : -10,
        r: 0.8 + depth * 2.6,
        speed: 18 + depth * 55,
        drift: 6 + depth * 18,
        phase: Math.random() * Math.PI * 2,
        alpha: 0.35 + depth * 0.6,
      };
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.min(240, Math.round((w * h) / 7000));
      flakes = Array.from({ length: count }, () => make(true));
      if (still) draw();
    };

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      for (const f of flakes) {
        ctx.beginPath();
        ctx.fillStyle = `rgba(255,255,255,${f.alpha})`;
        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      for (const f of flakes) {
        f.phase += dt * 0.9;
        f.y += f.speed * dt;
        f.x += Math.sin(f.phase) * f.drift * dt;
        if (f.y > h + 10) Object.assign(f, make(false));
        if (f.x > w + 10) f.x = -10;
        if (f.x < -10) f.x = w + 10;
      }
      draw();
      frame = requestAnimationFrame(tick);
    };

    const onVisibility = () => {
      cancelAnimationFrame(frame);
      if (!document.hidden && !still) {
        last = performance.now();
        frame = requestAnimationFrame(tick);
      }
    };

    resize();
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', onVisibility);
    if (!still) frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return <canvas ref={ref} aria-hidden className="pointer-events-none fixed inset-0 h-full w-full" />;
}
