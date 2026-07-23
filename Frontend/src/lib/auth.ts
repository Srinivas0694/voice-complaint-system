import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';
import { env } from './env';
import { prisma } from './prisma';
import { sha256Hex, randomHex } from './crypto';
import type { UserRole } from '@prisma/client';

const key = new TextEncoder().encode(env.JWT_SECRET);
const ACCESS_TTL_SEC = 15 * 60;
const REFRESH_TTL_MS = 30 * 24 * 3600 * 1000;

export type JwtClaims = { sub: string; email: string; role: UserRole };

export async function signAccessToken(c: JwtClaims): Promise<string> {
  return new SignJWT({ email: c.email, role: c.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(c.sub)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_SEC}s`)
    .sign(key);
}

export async function verifyAccessToken(token: string): Promise<JwtClaims | null> {
  try {
    const { payload } = await jwtVerify(token, key);
    return { sub: payload.sub!, email: payload.email as string, role: payload.role as UserRole };
  } catch {
    return null;
  }
}

export async function issueRefreshToken(userId: string, req: Request): Promise<string> {
  const token = randomHex(32);
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: sha256Hex(token),
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      userAgent: req.headers.get('user-agent') ?? undefined,
    },
  });
  return token;
}

/**
 * Rotates a refresh token. Reuse of an already-consumed token means it leaked,
 * so the whole family for that user is revoked rather than just refused.
 */
export async function rotateRefreshToken(token: string, req: Request) {
  const row = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256Hex(token) } });
  if (!row) return null;

  if (row.revokedAt || row.expiresAt < new Date()) {
    await prisma.refreshToken.updateMany({
      where: { userId: row.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return null;
  }

  await prisma.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
  const user = await prisma.user.findUnique({ where: { id: row.userId } });
  if (!user || !user.isActive) return null;

  const accessToken = await signAccessToken({ sub: user.id, email: user.email, role: user.role });
  const refreshToken = await issueRefreshToken(user.id, req);
  return { accessToken, refreshToken, user, expiresIn: ACCESS_TTL_SEC };
}

export function hashPassword(pw: string) { return bcrypt.hash(pw, 10); }
export function checkPassword(pw: string, hash: string) { return bcrypt.compare(pw, hash); }

/** Route guard. Returns claims, or null when the caller should be rejected. */
export async function requireAuth(req: Request, roles?: UserRole[]): Promise<JwtClaims | null> {
  const header = req.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  const claims = await verifyAccessToken(header.slice(7));
  if (!claims) return null;
  if (roles && !roles.includes(claims.role)) return null;
  return claims;
}

export const ACCESS_TTL = ACCESS_TTL_SEC;
