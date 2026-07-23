'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, MapPin } from 'lucide-react';
import { api, type Device } from '@/lib/ui/api';
import { Panel, Spinner, Empty, ago } from '@/components/bits';
import { DeviceForm } from '@/components/device-form';

type DeviceRow = Device & {
  latitude?: number | null;
  longitude?: number | null;
  siteAddress?: string | null;
};

export default function DevicesPage() {
  const [rows, setRows] = useState<DeviceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<DeviceRow | null>(null);

  const load = useCallback(() => {
    api<{ data: DeviceRow[] }>('/devices?limit=100')
      .then((r) => { setRows(r.data); setError(null); })
      .catch((e) => setError((e as Error).message));
  }, []);

  useEffect(load, [load]);

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[32px] font-semibold leading-tight tracking-tight">
            Devices
          </h1>
          <p className="mt-1 text-sm text-mist">
            {rows
              ? `${rows.filter((d) => d.online).length} of ${rows.length} reporting in`
              : 'Loading'}
          </p>
        </div>
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-2 rounded-lg bg-frost px-4 py-2 text-sm
                     font-medium text-void transition-opacity hover:opacity-90"
        >
          <Plus size={16} /> Add device
        </button>
      </header>

      {error ? <Empty title="Could not load devices" action={error} />
        : !rows ? <Spinner />
        : rows.length === 0 ? (
          <Empty
            title="No devices yet"
            action="Add one here, then flash its secret into the firmware."
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {rows.map((d) => (
              <Panel key={d.id} className="group p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono text-[13px] text-frost">{d.deviceId}</p>
                    <p className="mt-0.5 truncate text-sm">{d.name}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      onClick={() => setEditing(d)}
                      aria-label={`Edit ${d.deviceId}`}
                      className="text-mist opacity-0 transition-opacity hover:text-ink
                                 group-hover:opacity-100 focus:opacity-100"
                    >
                      <Pencil size={14} />
                    </button>
                    <span
                      className={`h-2 w-2 rounded-full ${d.online ? 'bg-frost' : 'bg-line'}`}
                      title={d.online ? 'Reporting in' : 'Not heard from recently'}
                    />
                  </div>
                </div>

                {d.siteName && (
                  <p className="mt-3 flex items-center gap-1.5 text-xs text-mist">
                    <MapPin size={12} className="shrink-0" />
                    <span className="truncate">{d.siteName}</span>
                  </p>
                )}

                <dl className="mt-3 space-y-1.5 font-mono text-[11px] text-mist">
                  <Row k="appliance" v={d.applianceType.replace(/_/g, ' ').toLowerCase()} />
                  <Row k="location"
                       v={d.latitude != null
                         ? `${Number(d.latitude).toFixed(4)}, ${Number(d.longitude).toFixed(4)}`
                         : 'not set'} />
                  <Row k="last seen" v={d.lastSeenAt ? ago(d.lastSeenAt) : 'never'} />
                  <Row k="signal" v={d.lastRssi ? `${d.lastRssi} dBm` : '—'} />
                  <Row k="firmware" v={d.firmwareVersion ?? '—'} />
                </dl>
              </Panel>
            ))}
          </div>
        )}

      {adding && (
        <DeviceForm onClose={() => setAdding(false)} onSaved={load} />
      )}
      {editing && (
        <DeviceForm existing={editing} onClose={() => setEditing(null)} onSaved={load} />
      )}
    </>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt>{k}</dt>
      <dd className="truncate text-right">{v}</dd>
    </div>
  );
}
