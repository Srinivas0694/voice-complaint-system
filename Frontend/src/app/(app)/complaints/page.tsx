'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Search, Download } from 'lucide-react';
import { api, type Complaint } from '@/lib/ui/api';
import { Panel, TempBar, SeverityTag, StatusPill, Spinner, Empty, ago, duration } from '@/components/bits';

const STATUSES = ['', 'OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'STT_FAILED'];
const SEVERITIES = ['', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

export default function ComplaintsPage() {
  const [rows, setRows] = useState<Complaint[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [severity, setSeverity] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const query = useCallback(() => {
    const sp = new URLSearchParams({ page: String(page), limit: '20' });
    if (q) sp.set('q', q);
    if (status) sp.set('status', status);
    if (severity) sp.set('severity', severity);
    return sp.toString();
  }, [page, q, status, severity]);

  useEffect(() => {
    setLoading(true);
    const t = setTimeout(() => {
      api<{ data: Complaint[]; meta: { total: number } }>(`/complaints?${query()}`)
        .then((r) => { setRows(r.data); setTotal(r.meta.total); setError(null); })
        .catch((e) => setError((e as Error).message))
        .finally(() => setLoading(false));
    }, q ? 300 : 0);          // debounce typing, but filters apply immediately
    return () => clearTimeout(t);
  }, [query, q]);

  async function exportCsv() {
    const res = await fetch(`/api/v1/complaints/export?format=csv&${query()}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('access')}` },
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `complaints-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const pages = Math.max(1, Math.ceil(total / 20));

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[32px] font-semibold leading-tight tracking-tight">
            Complaints
          </h1>
          <p className="mt-1 text-sm text-mist">
            {total} report{total === 1 ? '' : 's'}
          </p>
        </div>
        <button
          onClick={exportCsv}
          className="flex items-center gap-2 rounded-lg border hairline px-3.5 py-2
                     text-sm text-mist transition-colors hover:text-ink"
        >
          <Download size={15} /> Export CSV
        </button>
      </header>

      <div className="mb-3 flex flex-wrap gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-mist" />
          <input
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1); }}
            placeholder="Search what was said"
            className="w-full rounded-lg border hairline bg-panel py-2 pl-9 pr-3 text-sm
                       outline-none transition-colors focus:border-frost"
          />
        </div>
        <Select value={status} onChange={(v) => { setStatus(v); setPage(1); }}
                options={STATUSES} placeholder="Any status" />
        <Select value={severity} onChange={(v) => { setSeverity(v); setPage(1); }}
                options={SEVERITIES} placeholder="Any severity" />
      </div>

      <Panel>
        {loading ? <Spinner />
          : error ? <Empty title="Could not load complaints" action={error} />
          : rows.length === 0 ? (
            <Empty
              title="Nothing matches"
              action={q || status || severity
                ? 'Try clearing the filters.'
                : 'Hold the button on a device and speak. Reports arrive here within seconds.'}
            />
          ) : (
            <ul>
              {rows.map((c, i) => (
                <li key={c.id}>
                  <Link
                    href={`/complaints/${c.id}`}
                    className={`flex items-stretch gap-4 px-5 py-4 transition-colors hover:bg-raised
                                ${i > 0 ? 'border-t hairline' : ''}`}
                  >
                    <TempBar severity={c.severity} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px]">
                        {c.transcript ?? <span className="text-mist">No transcript</span>}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5
                                      font-mono text-[11px] text-mist">
                        <span>{c.device.deviceId}</span>
                        <span>{c.device.name}</span>
                        {c.faultCategory && <span className="text-ink">{c.faultCategory}</span>}
                        <span>{duration(c.audioDurationMs)}</span>
                        <span>{ago(c.receivedAt)}</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <StatusPill status={c.status} />
                      <SeverityTag severity={c.severity} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
      </Panel>

      {pages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}
                  className="rounded-lg border hairline px-3 py-1.5 text-mist
                             disabled:opacity-40 enabled:hover:text-ink">
            Previous
          </button>
          <span className="font-mono text-xs text-mist">{page} / {pages}</span>
          <button disabled={page === pages} onClick={() => setPage((p) => p + 1)}
                  className="rounded-lg border hairline px-3 py-1.5 text-mist
                             disabled:opacity-40 enabled:hover:text-ink">
            Next
          </button>
        </div>
      )}
    </>
  );
}

function Select({
  value, onChange, options, placeholder,
}: {
  value: string; onChange: (v: string) => void; options: string[]; placeholder: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border hairline bg-panel px-3 py-2 text-sm text-ink
                 outline-none transition-colors focus:border-frost"
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o === '' ? placeholder : o.replace('_', ' ').toLowerCase()}
        </option>
      ))}
    </select>
  );
}
