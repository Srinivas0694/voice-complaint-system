import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { verifyDevice } from '@/lib/device-auth';
import { transcribe } from '@/lib/stt';
import { audioKey, uploadAudio } from '@/lib/storage';
import { sha256Hex } from '@/lib/crypto';
import { ok, fail } from '@/lib/http/response';
import { rateLimit } from '@/lib/http/rate-limit';

export const runtime = 'nodejs';
export const maxDuration = 60;      // Gemini needs 2-5 s; the default 10 s is too tight
export const dynamic = 'force-dynamic';

const MAX_AUDIO_BYTES = 2 * 1024 * 1024;

const metaSchema = z.object({
  uuid: z.string().uuid(),
  device_id: z.string().min(1),
  firmware: z.string().optional(),
  hardware: z.string().optional(),
  recorded_at: z.string().optional(),
  audio_duration_ms: z.number().int().nonnegative().optional(),
  audio_bytes: z.number().int().nonnegative().optional(),
  audio_sha256: z.string().optional(),
  gps: z.object({
    status: z.enum(['FIX_3D', 'FIX_2D', 'NO_FIX', 'DISABLED']).default('NO_FIX'),
    latitude: z.number().min(-90).max(90).nullable().optional(),
    longitude: z.number().min(-180).max(180).nullable().optional(),
    accuracy_m: z.number().nonnegative().nullable().optional(),
    satellites: z.number().int().nonnegative().optional(),
    fixed_at: z.string().optional(),
  }).optional(),
  network: z.object({
    type: z.string().optional(),
    rssi: z.number().int().optional(),
    ssid: z.string().optional(),
  }).optional(),
  battery_pct: z.number().int().min(0).max(100).nullable().optional(),
  boot_count: z.number().int().nonnegative().optional(),
});

export async function POST(req: NextRequest) {
  // 1 - parse multipart
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail('VALIDATION_FAILED', 'expected multipart/form-data');
  }

  const metaRaw = form.get('meta');
  const audio = form.get('audio');
  if (typeof metaRaw !== 'string') return fail('VALIDATION_FAILED', 'missing "meta" part');
  if (!(audio instanceof Blob)) return fail('VALIDATION_FAILED', 'missing "audio" part');

  // 2 - verify the device signature over the meta part ONLY
  const auth = await verifyDevice(req, metaRaw);
  if (!auth.ok) return fail(auth.code, auth.message);
  const device = auth.device;

  const rl = rateLimit(`ingest:${device.deviceId}`, 30, 60_000);
  if (!rl.allowed) {
    return fail('RATE_LIMITED', `slow down, retry in ${rl.retryAfterSec}s`,
                { retryAfterSec: rl.retryAfterSec });
  }

  // 3 - validate meta
  let meta: z.infer<typeof metaSchema>;
  try {
    meta = metaSchema.parse(JSON.parse(metaRaw));
  } catch (e) {
    return fail('VALIDATION_FAILED', `bad meta: ${(e as Error).message.slice(0, 200)}`);
  }
  if (meta.device_id !== device.deviceId) {
    return fail('DEVICE_SIGNATURE_INVALID', 'meta.device_id does not match the signing device');
  }

  // 4 - idempotency: a retry of a delivered complaint must not create a 2nd ticket
  const existing = await prisma.complaint.findUnique({
    where: { uuid: meta.uuid },
    select: { id: true, status: true, transcript: true, applianceType: true,
              faultCategory: true, severity: true },
  });
  if (existing) {
    return ok({ complaintId: existing.id, uuid: meta.uuid, status: existing.status,
                transcript: existing.transcript, applianceType: existing.applianceType,
                faultCategory: existing.faultCategory, severity: existing.severity,
                duplicate: true });
  }

  // 5 - audio checks
  const wav = Buffer.from(await audio.arrayBuffer());
  if (wav.length > MAX_AUDIO_BYTES) return fail('AUDIO_TOO_LARGE', `${wav.length} bytes exceeds 2 MB`);
  if (wav.length < 100 || wav.toString('ascii', 0, 4) !== 'RIFF') {
    return fail('AUDIO_FORMAT_UNSUPPORTED', 'not a RIFF/WAVE payload');
  }
  if (meta.audio_sha256) {
    const pcm = wav.subarray(44);           // the device hashes PCM, not the header
    if (sha256Hex(pcm) !== meta.audio_sha256) {
      return fail('VALIDATION_FAILED', 'audio_sha256 mismatch - payload corrupted in transit');
    }
  }

  // 6 - store the blob, THEN create the row. In that order: if STT dies later,
  //     the audio is already durable and the complaint is replayable.
  const key = audioKey(device.deviceId, meta.uuid);
  try {
    await uploadAudio(key, wav);
  } catch (e) {
    console.error('[ingest] storage failed', e);
    return fail('INTERNAL', 'audio storage unavailable');   // 5xx -> the device retries
  }

  const recordedAt = meta.recorded_at ? new Date(meta.recorded_at) : new Date();
  const complaint = await prisma.complaint.create({
    data: {
      uuid: meta.uuid,
      deviceId: device.id,
      audioUrl: key,
      audioDurationMs: meta.audio_duration_ms,
      audioBytes: wav.length,
      status: 'PROCESSING',
      // Prefer a live fix if the device sent one, otherwise fall back to the
      // location provisioned against the device at installation. An appliance
      // monitor does not move, so the provisioned position is usually both
      // available and more accurate than a fix taken indoors.
      latitude: meta.gps?.latitude ?? device.latitude ?? null,
      longitude: meta.gps?.longitude ?? device.longitude ?? null,
      gpsAccuracyM: meta.gps?.accuracy_m ?? null,
      gpsStatus: meta.gps?.latitude
        ? (meta.gps.status ?? 'FIX_3D')
        : (device.latitude ? 'PROVISIONED' : 'NO_FIX'),
      satellites: meta.gps?.satellites ?? null,
      gpsFixedAt: meta.gps?.fixed_at ? new Date(meta.gps.fixed_at) : null,
      firmwareVersion: meta.firmware,
      hardwareRev: meta.hardware,
      rssi: meta.network?.rssi ?? null,
      networkType: meta.network?.type ?? null,
      batteryPct: meta.battery_pct ?? null,
      recordedAt,
      raw: JSON.parse(metaRaw),
      events: { create: { type: 'CREATED', message: 'audio received' } },
    },
  });

  // 7 - transcribe + classify (synchronous, 2-5 s)
  try {
    const stt = await transcribe(wav, { applianceType: device.applianceType });

    const updated = await prisma.complaint.update({
      where: { id: complaint.id },
      data: {
        transcript: stt.transcript,
        language: stt.language,
        sttProvider: stt.provider,
        sttConfidence: stt.confidence,
        sttLatencyMs: stt.latencyMs,
        applianceType: stt.applianceType ?? device.applianceType,
        faultCategory: stt.faultCategory,
        severity: stt.severity ?? 'MEDIUM',
        summary: stt.summary,
        status: 'OPEN',
        events: {
          create: {
            type: 'STT_COMPLETED',
            message: `${stt.provider} in ${stt.latencyMs}ms`,
            metadata: { confidence: stt.confidence, language: stt.language },
          },
        },
      },
    });

    await prisma.device.update({
      where: { id: device.id },
      data: {
        lastSeenAt: new Date(),
        status: 'ACTIVE',
        lastRssi: meta.network?.rssi ?? undefined,
        firmwareVersion: meta.firmware ?? undefined,
        bootCount: meta.boot_count ?? undefined,
      },
    });

    return ok({
      complaintId: updated.id,
      uuid: updated.uuid,
      status: updated.status,
      transcript: updated.transcript,
      applianceType: updated.applianceType,
      faultCategory: updated.faultCategory,
      severity: updated.severity,
    });
  } catch (e) {
    console.error('[ingest] STT failed', e);
    await prisma.complaint.update({
      where: { id: complaint.id },
      data: {
        status: 'STT_FAILED',
        events: { create: { type: 'STT_FAILED', message: (e as Error).message.slice(0, 400) } },
      },
    });
    // 200, not 500: the complaint IS safely stored. A 5xx would make the device
    // retry forever and re-upload the same audio again and again.
    return ok({ complaintId: complaint.id, uuid: complaint.uuid,
                status: 'STT_FAILED', transcript: null });
  }
}
