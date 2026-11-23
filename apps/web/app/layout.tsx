import type { Metadata, Viewport } from 'next';
import { config } from '@snow/server';
import './globals.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Snow Removal', description: 'Routes, service records and client notifications' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const c = config();
  // Local development: banner everywhere. Live site: shown to admins only (admin layout), never to clients.
  const dev = c.appEnv !== 'production' && (c.messagingMode !== 'live' || c.routingMode === 'mock');
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        {dev && (
          <div role="status" className="bg-amber-400 px-4 py-1.5 text-center text-xs font-semibold text-amber-950">
            DEVELOPMENT MODE — messages are {c.messagingMode === 'live' ? 'REAL' : 'simulated (nothing is sent)'} · routing is{' '}
            {c.routingMode === 'mock' ? 'simulated (not real road times)' : 'real'}
          </div>
        )}
        {children}
      </body>
    </html>
  );
}
