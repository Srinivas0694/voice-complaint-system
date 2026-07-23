/**
 * Simulates a device without any hardware: generates a WAV of the given file
 * (or a 1 kHz tone), signs it correctly, and posts it to the ingest endpoint.
 *
 *   npx tsx scripts/test-ingest.ts                       # synthetic tone
 *   npx tsx scripts/test-ingest.ts ./sample.wav          # a real recording
 *
 * Env: API_BASE_URL, TEST_DEVICE_ID, TEST_DEVICE_SECRET
 */
import crypto from 'crypto';
import fs from 'fs';

const API = process.env.API_BASE_URL ?? 'http://localhost:3000/api/v1';
const DEVICE_ID = process.env.TEST_DEVICE_ID ?? 'DEVICE_001';
const SECRET = process.env.TEST_DEVICE_SECRET ?? '';

function toneWav(seconds = 3, rate = 16000): Buffer {
  const n = seconds * rate;
  const pcm = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) pcm.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / rate)), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

async function main() {
  if (!SECRET) { console.error('set TEST_DEVICE_SECRET'); process.exit(1); }

  const file = process.argv[2];
  const wav = file ? fs.readFileSync(file) : toneWav();
  const pcm = wav.subarray(44);

  const meta = {
    uuid: crypto.randomUUID(),
    device_id: DEVICE_ID,
    firmware: '1.0.0',
    hardware: 'VCS-S3-PROTO',
    recorded_at: new Date().toISOString(),
    audio_duration_ms: Math.round((pcm.length / 2 / 16000) * 1000),
    audio_bytes: wav.length,
    audio_sha256: crypto.createHash('sha256').update(pcm).digest('hex'),
    gps: { status: 'FIX_3D', latitude: 17.4324, longitude: 78.2345,
           accuracy_m: 4.5, satellites: 9, fixed_at: new Date().toISOString() },
    network: { type: 'WIFI', rssi: -58, ssid: 'BENCH' },
    battery_pct: null,
    boot_count: 1,
  };

  const metaJson = JSON.stringify(meta);
  const ts = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomBytes(16).toString('hex');
  const bodyHash = crypto.createHash('sha256').update(metaJson).digest('hex');
  const signature = crypto.createHmac('sha256', SECRET)
    .update(`${DEVICE_ID}\n${ts}\n${nonce}\n${bodyHash}`).digest('hex');

  const form = new FormData();
  form.append('meta', metaJson);
  form.append('audio', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'complaint.wav');

  console.log(`POST ${API}/ingest/complaints  (${(wav.length / 1024).toFixed(0)} KB)`);
  const started = Date.now();
  const res = await fetch(`${API}/ingest/complaints`, {
    method: 'POST',
    headers: { 'X-Device-Id': DEVICE_ID, 'X-Timestamp': ts,
               'X-Nonce': nonce, 'X-Signature': signature },
    body: form,
  });

  console.log(`HTTP ${res.status} in ${Date.now() - started} ms`);
  console.log(await res.text());
}

main();
