'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { LayoutDashboard, MessageSquareText, Cpu, Sun, Moon, LogOut } from 'lucide-react';
import { clearTokens } from '@/lib/ui/api';

const NAV = [
  { href: '/dashboard',  label: 'Overview',   icon: LayoutDashboard },
  { href: '/complaints', label: 'Complaints', icon: MessageSquareText },
  { href: '/devices',    label: 'Devices',    icon: Cpu },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  useEffect(() => {
    if (!localStorage.getItem('access')) router.replace('/login');
    setTheme((localStorage.getItem('theme') as 'dark' | 'light') ?? 'dark');
  }, [router]);

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    localStorage.setItem('theme', next);
    document.documentElement.className = next;
  }

  function signOut() {
    clearTokens();
    router.replace('/login');
  }

  return (
    <div className="flex min-h-screen">
      <nav className="sticky top-0 flex h-screen w-[70px] shrink-0 flex-col items-center
                      gap-1 border-r hairline bg-panel py-5 md:w-[210px] md:items-stretch md:px-3">
        <Link href="/dashboard" className="mb-7 flex items-center gap-2.5 md:px-2">
          <span className="flex items-end gap-[2px]" aria-hidden>
            {[8, 15, 22, 12, 18].map((h, i) => (
              <span key={i} className="w-[2px] rounded-full bg-frost" style={{ height: h }} />
            ))}
          </span>
          <span className="hidden font-display text-[15px] font-semibold md:inline">
            Complaints
          </span>
        </Link>

        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={clsx(
                'flex items-center justify-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors md:justify-start',
                active ? 'bg-raised text-frost' : 'text-mist hover:text-ink',
              )}
            >
              <Icon size={17} />
              <span className="hidden md:inline">{label}</span>
            </Link>
          );
        })}

        <div className="mt-auto flex flex-col gap-1">
          <button
            onClick={toggleTheme}
            className="flex items-center justify-center gap-3 rounded-lg px-3 py-2.5
                       text-sm text-mist transition-colors hover:text-ink md:justify-start"
          >
            {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
            <span className="hidden md:inline">{theme === 'dark' ? 'Light' : 'Dark'}</span>
          </button>
          <button
            onClick={signOut}
            className="flex items-center justify-center gap-3 rounded-lg px-3 py-2.5
                       text-sm text-mist transition-colors hover:text-ink md:justify-start"
          >
            <LogOut size={17} />
            <span className="hidden md:inline">Sign out</span>
          </button>
        </div>
      </nav>

      <main className="min-w-0 flex-1 px-5 py-8 md:px-9">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
