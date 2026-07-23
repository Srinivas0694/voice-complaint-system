'use client';

import clsx from 'clsx';
import { motion } from 'framer-motion';
import type { Severity, Status } from '@/lib/ui/api';

/* ── severity: the temperature bar ─────────────────────────────────────── */

export function TempBar({ severity }: { severity: Severity | null }) {
  return (
    <span
      aria-hidden
      className={clsx('block w-[3px] self-stretch rounded-full', `temp-${severity ?? 'UNSET'}`)}
    />
  );
}

const SEVERITY_TEXT: Record<string, string> = {
  LOW: 'text-frost',
  MEDIUM: 'text-[#E8C468]',
  HIGH: 'text-ember',
  CRITICAL: 'text-crit',
};

export function SeverityTag({ severity }: { severity: Severity | null }) {
  if (!severity) return <span className="text-mist text-xs">unrated</span>;
  return (
    <span className={clsx('font-mono text-[11px] uppercase tracking-wider', SEVERITY_TEXT[severity])}>
      {severity}
    </span>
  );
}

/* ── status ────────────────────────────────────────────────────────────── */

const STATUS_LABEL: Record<Status, string> = {
  PROCESSING: 'Transcribing',
  STT_FAILED: 'No transcript',
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};

export function StatusPill({ status }: { status: Status }) {
  const quiet = status === 'RESOLVED' || status === 'CLOSED';
  const warn = status === 'STT_FAILED';
  return (
    <span
      className={clsx(
        'rounded-full border px-2.5 py-0.5 text-[11px] font-medium',
        warn && 'border-ember/40 text-ember',
        quiet && 'border-line text-mist',
        !warn && !quiet && 'border-frost/40 text-frost',
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

/* ── layout primitives ─────────────────────────────────────────────────── */

export function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={clsx('rounded-xl2 border hairline bg-panel', className)}>{children}</div>
  );
}

export function Stat({
  label, value, hint, accent, index = 0,
}: {
  label: string; value: string | number; hint?: string;
  accent?: 'frost' | 'ember' | 'crit'; index?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="rounded-xl2 border hairline bg-panel p-5"
    >
      <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-mist">{label}</div>
      <div
        className={clsx(
          'mt-2 font-display text-4xl font-semibold tabular-nums',
          accent === 'ember' && 'text-ember',
          accent === 'crit' && 'text-crit',
          accent === 'frost' && 'text-frost',
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-mist">{hint}</div>}
    </motion.div>
  );
}

export function Empty({ title, action }: { title: string; action?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-20 text-center">
      <p className="font-display text-lg">{title}</p>
      {action && <p className="max-w-sm text-sm text-mist">{action}</p>}
    </div>
  );
}

export function Spinner() {
  return (
    <div className="flex justify-center py-20">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-frost" />
    </div>
  );
}

/* ── formatting ────────────────────────────────────────────────────────── */

export function duration(ms: number | null) {
  if (!ms) return '—';
  const s = ms / 1000;
  return `${s.toFixed(1)}s`;
}

export function ago(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}
