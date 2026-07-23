import { prisma } from './prisma';
import { decryptSecret, hmacSha256Hex, safeEqual, sha256Hex } from './crypto';
import type { Device } from '@prisma/client';

const MAX_SKEW_SEC = 300;

export type DeviceAuthResult =
  | { ok: true; device: Device }
  | { ok: false; code: 'DEVICE_UNKNOWN' | 'DEVICE_REVOKED' | 'DEVICE_SIGNATURE_INVALID'
        | 'DEVICE_TIMESTAMP_SKEW' | 'DEVICE_NONCE_REPLAY'; message: string };

/**
 * Verifies the four device headers against a body.
 *
 * signature = HMAC_SHA256(secret, deviceId + "\n" + ts + "\n" + nonce + "\n" + sha256hex(body))
 *
 * For multipart uploads `body` is the `meta` part ONLY — the ESP32 cannot buffer
 * a full multipart body to hash it. Audio integrity rides on `audio_sha256`
 * inside meta, which IS covered by the signature.
 */
export async function verifyDevice(req: Request, body: string): Promise<DeviceAuthResult> {
  const deviceId = req.headers.get('x-device-id');
  const ts = req.headers.get('x-timestamp');
  const nonce = req.headers.get('x-nonce');
  const signature = req.headers.get('x-signature');

  if (!deviceId || !ts || !nonce || !signature) {
    return { ok: false, code: 'DEVICE_SIGNATURE_INVALID', message: 'missing signing headers' };
  }

  const skew = Math.abs(Math.floor(Date.now() / 1000) - Number(ts));
  if (!Number.isFinite(skew) || skew > MAX_SKEW_SEC) {
    return { ok: false, code: 'DEVICE_TIMESTAMP_SKEW',
             message: `timestamp off by ${skew}s (max ${MAX_SKEW_SEC}s) — check the device clock` };
  }

  const device = await prisma.device.findUnique({ where: { deviceId } });
  if (!device) return { ok: false, code: 'DEVICE_UNKNOWN', message: `unknown device ${deviceId}` };
  if (device.status === 'REVOKED') {
    return { ok: false, code: 'DEVICE_REVOKED', message: 'device secret has been revoked' };
  }

  const secret = decryptSecret(device.secretEnc);
  const expected = hmacSha256Hex(secret, `${deviceId}\n${ts}\n${nonce}\n${sha256Hex(body)}`);
  if (!safeEqual(expected, signature)) {
    return { ok: false, code: 'DEVICE_SIGNATURE_INVALID', message: 'HMAC mismatch' };
  }

  // Replay protection. The unique constraint does the work atomically — a
  // check-then-insert would race under concurrent retries.
  try {
    await prisma.deviceNonce.create({ data: { deviceId: device.id, nonce } });
  } catch {
    return { ok: false, code: 'DEVICE_NONCE_REPLAY', message: 'nonce already used' };
  }

  // Cheap opportunistic cleanup (~2% of requests) so nonces never accumulate.
  if (Math.random() < 0.02) {
    void prisma.deviceNonce.deleteMany({
      where: { createdAt: { lt: new Date(Date.now() - MAX_SKEW_SEC * 2000) } },
    });
  }

  return { ok: true, device };
}
