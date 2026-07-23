'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MapPin, Loader2, Check, Copy, X, AlertTriangle } from 'lucide-react';
import { api, type Device } from '@/lib/ui/api';
import { Panel } from './bits';

const APPLIANCES = [
  'FREEZER', 'REFRIGERATOR', 'AIR_CONDITIONER', 'WASHING_MACHINE',
  'TELEVISION', 'WATER_PURIFIER', 'COOLER', 'MICROWAVE', 'OTHER',
];

interface Fields {
  deviceId: string;
  name: string;
  applianceType: string;
  applianceBrand: string;
  siteName: string;
  siteAddress: string;
  latitude: string;
  longitude: string;
}

const BLANK: Fields = {
  deviceId: '', name: '', applianceType: 'FREEZER', applianceBrand: '',
  siteName: '', siteAddress: '', latitude: '', longitude: '',
};

/**
 * Add or edit a device.
 *
 * Built to be filled in on a phone standing next to the appliance, which is
 * where the location is worth capturing — the installer's handset has a GNSS
 * receiver that works outdoors, unlike anything we could put in the device
 * itself for the price.
 */
export function DeviceForm({
  existing, onClose, onSaved,
}: {
  existing?: Device & { siteAddress?: string | null; latitude?: number | null; longitude?: number | null };
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = Boolean(existing);

  const [f, setF] = useState<Fields>(existing ? {
    deviceId: existing.deviceId,
    name: existing.name,
    applianceType: existing.applianceType,
    applianceBrand: '',
    siteName: existing.siteName ?? '',
    siteAddress: existing.siteAddress ?? '',
    latitude: existing.latitude != null ? String(existing.latitude) : '',
    longitude: existing.longitude != null ? String(existing.longitude) : '',
  } : BLANK);

  const [locating, setLocating] = useState(false);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<{ deviceId: string; secret: string } | null>(null);

  const set = (k: keyof Fields) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  function locate() {
    if (!navigator.geolocation) {
      setError('This browser cannot report a location.');
      return;
    }
    setLocating(true);
    setError(null);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setF((s) => ({
          ...s,
          latitude: pos.coords.latitude.toFixed(6),
          longitude: pos.coords.longitude.toFixed(6),
        }));
        setAccuracy(Math.round(pos.coords.accuracy));
        setLocating(false);
      },
      (err) => {
        setLocating(false);
        setError(
          err.code === err.PERMISSION_DENIED
            ? 'Location permission was denied. Allow it in the browser, or type the coordinates in by hand.'
            : err.code === err.TIMEOUT
              ? 'Timed out waiting for a fix. Step outside and try again.'
              : 'Could not get a location.',
        );
      },
      // Worth the wait and the battery — this number gets stored for the life
      // of the installation.
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  }

  async function save() {
    setSaving(true);
    setError(null);

    const payload = {
      name: f.name.trim(),
      applianceType: f.applianceType,
      ...(f.applianceBrand.trim() ? { applianceBrand: f.applianceBrand.trim() } : {}),
      ...(f.siteName.trim() ? { siteName: f.siteName.trim() } : {}),
      ...(f.siteAddress.trim() ? { siteAddress: f.siteAddress.trim() } : {}),
      ...(f.latitude ? { latitude: Number(f.latitude) } : {}),
      ...(f.longitude ? { longitude: Number(f.longitude) } : {}),
    };

    try {
      if (editing) {
        await api(`/devices/${existing!.id}`, { method: 'PUT', body: JSON.stringify(payload) });
        onSaved();
        onClose();
      } else {
        const res = await api<{ deviceId: string; deviceSecret: string }>(
          '/devices/register',
          { method: 'POST', body: JSON.stringify({ deviceId: f.deviceId.trim(), ...payload }) },
        );
        // Hold the form open on the secret — it is never retrievable again.
        setSecret({ deviceId: res.deviceId, secret: res.deviceSecret });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const valid = editing
    ? f.name.trim().length > 0
    : f.deviceId.trim().length >= 3 && f.name.trim().length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto
                 bg-void/80 px-4 py-8 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget && !secret) onClose(); }}
    >
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-lg"
      >
        <AnimatePresence mode="wait">
          {secret ? (
            <SecretPanel key="secret" {...secret} onDone={() => { onSaved(); onClose(); }} />
          ) : (
            <Panel key="form" className="p-6">
              <div className="mb-6 flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-display text-xl font-semibold tracking-tight">
                    {editing ? 'Edit device' : 'Add a device'}
                  </h2>
                  <p className="mt-1 text-xs text-mist">
                    {editing
                      ? 'Changes apply to complaints filed from now on.'
                      : 'Fill this in standing next to the appliance.'}
                  </p>
                </div>
                <button onClick={onClose} aria-label="Close"
                        className="text-mist transition-colors hover:text-ink">
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-4">
                {!editing && (
                  <Field label="Device ID" value={f.deviceId} onChange={set('deviceId')}
                         mono placeholder="DEVICE_002"
                         hint="Printed on the device label. Letters, digits, dash and underscore." />
                )}

                <Field label="Name" value={f.name} onChange={set('name')}
                       placeholder="Kitchen chest freezer" />

                <label className="block">
                  <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-mist">
                    Appliance
                  </span>
                  <select
                    value={f.applianceType}
                    onChange={(e) => set('applianceType')(e.target.value)}
                    className="mt-1.5 w-full rounded-lg border hairline bg-raised px-3 py-2.5
                               text-ink outline-none transition-colors focus:border-frost"
                  >
                    {APPLIANCES.map((a) => (
                      <option key={a} value={a}>{a.replace(/_/g, ' ').toLowerCase()}</option>
                    ))}
                  </select>
                </label>

                <Field label="Site" value={f.siteName} onChange={set('siteName')}
                       placeholder="Khrana Cloud Kitchen, Banjara Hills" />

                <Field label="Address" value={f.siteAddress} onChange={set('siteAddress')}
                       placeholder="Optional — full postal address" />

                {/* Location capture. The whole reason this form exists on a phone. */}
                <div className="rounded-lg border hairline bg-raised p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-mist">
                      Location
                    </span>
                    <button
                      type="button"
                      onClick={locate}
                      disabled={locating}
                      className="flex items-center gap-1.5 rounded-lg border hairline px-3 py-1.5
                                 text-xs text-frost transition-colors hover:bg-panel disabled:opacity-50"
                    >
                      {locating
                        ? <><Loader2 size={13} className="animate-spin" /> Locating…</>
                        : <><MapPin size={13} /> Use my location</>}
                    </button>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <input
                      value={f.latitude}
                      onChange={(e) => set('latitude')(e.target.value)}
                      inputMode="decimal"
                      placeholder="latitude"
                      className="rounded-lg border hairline bg-panel px-3 py-2 font-mono text-sm
                                 outline-none transition-colors focus:border-frost"
                    />
                    <input
                      value={f.longitude}
                      onChange={(e) => set('longitude')(e.target.value)}
                      inputMode="decimal"
                      placeholder="longitude"
                      className="rounded-lg border hairline bg-panel px-3 py-2 font-mono text-sm
                                 outline-none transition-colors focus:border-frost"
                    />
                  </div>

                  <p className="mt-2 text-[11px] leading-relaxed text-mist">
                    {accuracy != null
                      ? `Captured to about ${accuracy} m. Complaints from this device carry these coordinates.`
                      : 'Optional. You can also right-click the spot in Google Maps and paste the numbers.'}
                  </p>
                </div>

                {error && (
                  <p role="alert" className="flex items-start gap-2 text-sm text-crit">
                    <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
                  </p>
                )}

                <div className="flex gap-2 pt-1">
                  <button
                    onClick={save}
                    disabled={!valid || saving}
                    className="flex-1 rounded-lg bg-frost py-2.5 font-medium text-void
                               transition-opacity hover:opacity-90 disabled:opacity-40"
                  >
                    {saving ? 'Saving…' : editing ? 'Save changes' : 'Register device'}
                  </button>
                  <button
                    onClick={onClose}
                    className="rounded-lg border hairline px-4 text-sm text-mist
                               transition-colors hover:text-ink"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </Panel>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

/**
 * The secret is returned exactly once and cannot be read back. That deserves a
 * screen of its own rather than a toast that can be swiped away — and what is
 * shown is the finished secrets.ini block, because that is what actually gets
 * pasted.
 */
function SecretPanel({
  deviceId, secret, onDone,
}: { deviceId: string; secret: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  const block = `[secrets]
wifi_ssid     = YOUR_WIFI
wifi_password = YOUR_PASSWORD
device_id     = ${deviceId}
device_secret = ${secret}
api_base_url  = ${typeof window !== 'undefined' ? window.location.origin : ''}/api/v1`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(block);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard is blocked on insecure origins; the text is selectable anyway.
    }
  }

  return (
    <Panel className="p-6">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full
                         border border-frost/40 text-frost">
          <Check size={16} />
        </span>
        <div>
          <h2 className="font-display text-xl font-semibold tracking-tight">
            {deviceId} registered
          </h2>
          <p className="mt-1 text-sm text-ember">
            This secret is shown once and cannot be recovered. Save it before closing.
          </p>
        </div>
      </div>

      <pre className="mt-5 overflow-x-auto rounded-lg border hairline bg-raised p-4
                      font-mono text-[11px] leading-relaxed text-ink">
{block}
      </pre>

      <button
        onClick={copy}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg
                   border hairline py-2.5 text-sm text-frost transition-colors hover:bg-raised"
      >
        {copied ? <><Check size={15} /> Copied</> : <><Copy size={15} /> Copy secrets.ini block</>}
      </button>

      <label className="mt-5 flex cursor-pointer items-start gap-2.5 text-sm">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
          className="mt-1 accent-[var(--frost)]"
        />
        <span className="text-mist">
          I have saved this secret into the firmware, or somewhere safe.
        </span>
      </label>

      <button
        onClick={onDone}
        disabled={!acknowledged}
        className="mt-4 w-full rounded-lg bg-frost py-2.5 font-medium text-void
                   transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        Done
      </button>
    </Panel>
  );
}

function Field({
  label, value, onChange, placeholder, hint, mono,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; hint?: string; mono?: boolean;
}) {
  return (
    <label className="block">
      <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-mist">
        {label}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`mt-1.5 w-full rounded-lg border hairline bg-raised px-3 py-2.5
                    text-ink outline-none transition-colors focus:border-frost
                    ${mono ? 'font-mono' : ''}`}
      />
      {hint && <span className="mt-1 block text-[11px] text-mist">{hint}</span>}
    </label>
  );
}
