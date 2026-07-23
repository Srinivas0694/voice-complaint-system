'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import { api, type Complaint, type Status } from '@/lib/ui/api';
import { Panel, SeverityTag, StatusPill, Spinner, Empty, duration } from '@/components/bits';
import { Waveform } from '@/components/waveform';

const NEXT_STATES: Status[] = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];

export default function ComplaintDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [c, setC] = useState<Complaint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<Complaint>(`/complaints/${id}`)
      .then((r) => setC(r))
      .catch((e) => setError((e as Error).message));
  }, [id]);

  async function setStatus(status: Status) {
    if (!c) return;
    setSaving(true);
    try {
      const r = await api<Complaint>(`/complaints/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setC(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (error) return <Empty title="Could not load this complaint" action={error} />;
  if (!c) return <Spinner />;

  const spoken = new Date(c.recordedAt);

  return (
    <>
      <button
        onClick={() => router.back()}
        className="mb-6 flex items-center gap-2 text-sm text-mist transition-colors hover:text-ink"
      >
        <ArrowLeft size={15} /> Back
      </button>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <StatusPill status={c.status} />
          <SeverityTag severity={c.severity} />
          {c.faultCategory && (
            <span className="font-mono text-[11px] uppercase tracking-wider text-mist">
              {c.faultCategory}
            </span>
          )}
        </div>

        {/* The utterance itself, at the top, at size. Everything else supports it. */}
        <blockquote className="font-display text-3xl leading-[1.25] tracking-tight md:text-[40px]">
          {c.transcript
            ? `“${c.transcript}”`
            : <span className="text-mist">This recording produced no transcript.</span>}
        </blockquote>

        {c.summary && c.summary !== c.transcript && (
          <p className="mt-3 text-[15px] text-mist">{c.summary}</p>
        )}
      </motion.div>

      {c.audioUrl && (
        <Panel className="mt-7 p-5">
          <Waveform src={c.audioUrl} durationMs={c.audioDurationMs} />
        </Panel>
      )}

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <Panel className="p-6">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-mist">
            Where it came from
          </h2>
          <dl className="mt-4 space-y-3 text-sm">
            <Row k="Device" v={c.device.deviceId} mono />
            <Row k="Name" v={c.device.name} />
            {c.device.siteName && <Row k="Site" v={c.device.siteName} />}
            {c.applianceType && <Row k="Appliance" v={c.applianceType.replace('_', ' ').toLowerCase()} />}
            <Row k="Spoken" v={spoken.toLocaleString()} />
            <Row k="Length" v={duration(c.audioDurationMs)} mono />
          </dl>
        </Panel>

        <Panel className="p-6">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-mist">
            Device state at the time
          </h2>
          <dl className="mt-4 space-y-3 text-sm">
            <Row k="Firmware" v={c.firmwareVersion ?? '—'} mono />
            <Row k="Hardware" v={c.hardwareRev ?? '—'} mono />
            <Row k="Signal" v={c.rssi ? `${c.rssi} dBm` : '—'} mono />
            <Row k="Battery" v={c.batteryPct != null ? `${c.batteryPct}%` : 'not fitted'} mono />
            <Row k="Transcribed by" v={c.sttProvider ?? '—'} mono />
          </dl>
        </Panel>
      </div>

      <Panel className="mt-3 p-6">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-mist">
          Move it along
        </h2>
        <div className="mt-4 flex flex-wrap gap-2">
          {NEXT_STATES.map((s) => (
            <button
              key={s}
              disabled={saving || c.status === s}
              onClick={() => setStatus(s)}
              className="rounded-lg border hairline px-3.5 py-2 text-sm transition-colors
                         disabled:opacity-40 enabled:hover:bg-raised enabled:hover:text-frost"
            >
              {s.replace('_', ' ').toLowerCase()}
            </button>
          ))}
        </div>
      </Panel>

      {c.events && c.events.length > 0 && (
        <Panel className="mt-3 p-6">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-mist">
            History
          </h2>
          <ol className="mt-4 space-y-3">
            {c.events.map((e) => (
              <li key={e.id} className="flex gap-3 text-sm">
                <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-frost" />
                <div>
                  <span>{e.message ?? e.type.replace(/_/g, ' ').toLowerCase()}</span>
                  <span className="ml-2 font-mono text-[11px] text-mist">
                    {new Date(e.createdAt).toLocaleString()}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        </Panel>
      )}
    </>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-mist">{k}</dt>
      <dd className={`text-right ${mono ? 'font-mono text-[13px]' : ''}`}>{v}</dd>
    </div>
  );
}
