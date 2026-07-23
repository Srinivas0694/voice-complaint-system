import crypto from 'crypto';
import { env } from './env';

const KEY = Buffer.from(env.DEVICE_SECRET_ENC_KEY, 'hex'); // 32 bytes

/**
 * Device secrets are ENCRYPTED, not hashed.
 *
 * HMAC verification recomputes the signature server-side, which needs the
 * original secret back. A one-way hash (bcrypt/argon2) makes that impossible.
 * Passwords are hashed; shared symmetric keys are encrypted. Different jobs.
 */
export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${ct.toString('hex')}`;
}

export function decryptSecret(stored: string): string {
  const [ivHex, tagHex, ctHex] = stored.split(':');
  if (!ivHex || !tagHex || !ctHex) throw new Error('malformed device secret');
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(ctHex, 'hex')), decipher.final()]).toString('utf8');
}

export function sha256Hex(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function hmacSha256Hex(secret: string, message: string): string {
  return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

export function randomHex(bytes: number): string {
  return crypto.randomBytes(bytes).toString('hex');
}

/** Constant-time compare — a naive `===` leaks signature bytes via timing. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}
