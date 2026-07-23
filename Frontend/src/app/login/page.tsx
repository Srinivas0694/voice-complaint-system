'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { login } from '@/lib/ui/api';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await login(email, password);
      router.push('/dashboard');
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center px-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-sm"
      >
        <div className="mb-9">
          <div className="mb-5 flex gap-[3px]" aria-hidden>
            {/* A frozen waveform: the product's subject, at rest. */}
            {[6, 14, 26, 40, 30, 18, 34, 22, 10, 16, 8].map((h, i) => (
              <motion.span
                key={i}
                initial={{ height: 3 }}
                animate={{ height: h }}
                transition={{ delay: 0.15 + i * 0.035, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                className="w-[3px] rounded-full bg-frost"
                style={{ opacity: 0.35 + (h / 40) * 0.65 }}
              />
            ))}
          </div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            Voice Complaints
          </h1>
          <p className="mt-1.5 text-sm text-mist">
            Spoken fault reports from appliances in the field.
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <Field label="Email" type="email" value={email} onChange={setEmail} autoFocus />
          <Field label="Password" type="password" value={password} onChange={setPassword} />

          {error && (
            <p role="alert" className="text-sm text-crit">{error}</p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-frost py-2.5 font-medium text-void
                       transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </motion.div>
    </main>
  );
}

function Field({
  label, type, value, onChange, autoFocus,
}: {
  label: string; type: string; value: string;
  onChange: (v: string) => void; autoFocus?: boolean;
}) {
  return (
    <label className="block">
      <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-mist">{label}</span>
      <input
        type={type}
        value={value}
        autoFocus={autoFocus}
        required
        onChange={(e) => onChange(e.target.value)}
        className="mt-1.5 w-full rounded-lg border hairline bg-panel px-3 py-2.5
                   text-ink outline-none transition-colors focus:border-frost"
      />
    </label>
  );
}
