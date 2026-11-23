'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/clients', label: 'Clients' },
  { href: '/admin/properties', label: 'Properties' },
  { href: '/admin/routes', label: 'Routes' },
  { href: '/admin/drivers', label: 'Drivers' },
  { href: '/admin/communications', label: 'Communications' },
  { href: '/admin/team', label: 'Team Members' },
];

export function AdminNav() {
  const path = usePathname();
  return (
    <nav className="flex flex-wrap gap-1 text-sm">
      {ITEMS.map((i) => {
        const active = i.href === '/admin' ? path === '/admin' : path.startsWith(i.href);
        return (
          <Link
            key={i.href}
            href={i.href}
            aria-current={active ? 'page' : undefined}
            className={`rounded-md px-3 py-1.5 font-medium ${active ? 'bg-sky-100 text-sky-900' : 'text-slate-700 hover:bg-slate-100'}`}
          >
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
