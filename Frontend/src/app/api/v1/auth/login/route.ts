import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { checkPassword, signAccessToken, issueRefreshToken, ACCESS_TTL } from '@/lib/auth';
import { ok, fail } from '@/lib/http/response';
import { rateLimit, clientIp } from '@/lib/http/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ email: z.string().email(), password: z.string().min(8) });

export async function POST(req: NextRequest) {
  const rl = rateLimit(`login:${clientIp(req)}`, 10, 15 * 60_000);
  if (!rl.allowed) return fail('RATE_LIMITED', 'too many attempts');

  let body: z.infer<typeof schema>;
  try { body = schema.parse(await req.json()); }
  catch { return fail('VALIDATION_FAILED', 'email and password required'); }

  const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
  // Same message either way — distinguishing them tells an attacker which emails exist.
  const generic = () => fail('TOKEN_INVALID', 'invalid email or password');
  if (!user || !user.isActive) return generic();
  if (!(await checkPassword(body.password, user.passwordHash))) return generic();

  const accessToken = await signAccessToken({ sub: user.id, email: user.email, role: user.role });
  const refreshToken = await issueRefreshToken(user.id, req);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  return ok({
    accessToken, refreshToken, expiresIn: ACCESS_TTL,
    user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role },
  });
}
