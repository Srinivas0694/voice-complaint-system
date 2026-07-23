'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { api, type Stats, type Complaint } from '@/lib/ui/api';
import { Stat, Panel, TempBar, SeverityTag, StatusPill, Spinner, Empty, ago, duration } from '@/components/bits';

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [recent, setRecent] = useState<Complaint[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      // /dashboard/stats returns the object directly; /complaints is paginated
      // and wraps its rows in { data, meta }. The envelopes differ by route.
      api<Stats>('/dashboard/stats'),
      api<{ data: Complaint[] }>('/complaints?limit=6'),
    ])
      .then(([s, c]) => { setStats(s); setRecent(c.data); })
      .catch((e) => setError((e as Error).message));
  }, []);

  if (error) return <Empty title="Could not load the overview" action={error} />;
  if (!stats) return <Spinner />;

  const severityData = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((k) => ({
    name: k[0] + k.slice(1).toLowerCase(),
    count: stats.severityBreakdown[k] ?? 0,
  }));

  return (
    <>
      <header className="mb-7">
        <h1 className="font-display text-[32px] font-semibold leading-tight tracking-tight">
          Overview
        </h1>
        <p className="mt-1 text-sm text-mist">
          {stats.complaintsToday === 0
            ? 'Nothing reported today.'
            : `${stats.complaintsToday} report${stats.complaintsToday === 1 ? '' : 's'} today.`}
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat index={0} label="Devices" value={stats.totalDevices}
              hint={`${stats.onlineDevices} online · ${stats.offlineDevices} offline`} />
        <Stat index={1} label="Today" value={stats.complaintsToday}
              hint={`${stats.complaintsThisWeek} this week`} />
        <Stat index={2} label="Critical open" value={stats.criticalOpen}
              accent={stats.criticalOpen > 0 ? 'crit' : undefined}
              hint={stats.criticalOpen > 0 ? 'needs a technician' : 'nothing urgent'} />
        <Stat index={3} label="Avg resolution"
              value={stats.avgResolutionHours ? `${stats.avgResolutionHours}h` : '—'}
              hint="last 30 days" />
      </section>

      {stats.lastComplaint && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="mt-3"
        >
          <Link href={`/complaints/${stats.lastComplaint.id}`}>
            <Panel className="p-6 transition-colors hover:bg-raised">
              <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-mist">
                Most recent
              </div>
              {/* The transcript is the product. Set it like a quotation, not a cell. */}
              <p className="mt-3 font-display text-2xl leading-snug tracking-tight md:text-[28px]">
                {stats.lastComplaint.transcript
                  ? `“${stats.lastComplaint.transcript}”`
                  : 'No transcript for this recording.'}
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-mist">
                <span className="font-mono">{stats.lastComplaint.device.deviceId}</span>
                <span>{stats.lastComplaint.device.name}</span>
                <SeverityTag severity={stats.lastComplaint.severity} />
                <span>{ago(stats.lastComplaint.receivedAt)}</span>
              </div>
            </Panel>
          </Link>
        </motion.div>
      )}

      <div className="mt-3 grid gap-3 lg:grid-cols-5">
        <Panel className="p-6 lg:col-span-2">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-mist">
            By severity
          </h2>
          <div className="mt-5 h-[210px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={severityData} margin={{ top: 4, right: 4, bottom: 0, left: -22 }}>
                <CartesianGrid stroke="var(--line)" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: 'var(--mist)', fontSize: 11 }}
                       axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: 'var(--mist)', fontSize: 11 }} axisLine={false}
                       tickLine={false} allowDecimals={false} />
                <Tooltip
                  cursor={{ fill: 'var(--raised)' }}
                  contentStyle={{
                    background: 'var(--panel)', border: '1px solid var(--line)',
                    borderRadius: 10, fontSize: 12, color: 'var(--ink)',
                  }}
                />
                <Bar dataKey="count" fill="var(--frost)" radius={[3, 3, 0, 0]} maxBarSize={44} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel className="lg:col-span-3">
          <div className="flex items-center justify-between px-6 py-4">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-mist">
              Latest reports
            </h2>
            <Link href="/complaints" className="text-xs text-frost hover:underline">
              See all
            </Link>
          </div>
          {recent.length === 0 ? (
            <Empty title="No reports yet"
                   action="Hold the button on a device and speak. It shows up here." />
          ) : (
            <ul>
              {recent.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/complaints/${c.id}`}
                    className="flex items-stretch gap-4 border-t hairline px-6 py-3.5
                               transition-colors hover:bg-raised"
                  >
                    <TempBar severity={c.severity} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">
                        {c.transcript ?? <span className="text-mist">No transcript</span>}
                      </p>
                      <p className="mt-0.5 font-mono text-[11px] text-mist">
                        {c.device.deviceId} · {duration(c.audioDurationMs)} · {ago(c.receivedAt)}
                      </p>
                    </div>
                    <StatusPill status={c.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
