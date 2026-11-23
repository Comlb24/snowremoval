import type { Metadata, Viewport } from 'next';
import './globals.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Snow Removal', description: 'Routes, service records and client notifications' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // No site-wide development banner. Admins still see a simulated-mode notice on the live site (admin layout).
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
