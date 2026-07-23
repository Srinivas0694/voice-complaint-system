import { NextRequest } from 'next/server';
import { rotateRefreshToken } from '@/lib/auth';
import { ok, fail } from '@/lib/http/response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { refreshToken } = await req.json().catch(() => ({ refreshToken: null }));
  if (!refreshToken) return fail('VALIDATION_FAILED', 'refreshToken required');

  const rotated = await rotateRefreshToken(refreshToken, req);
  if (!rotated) return fail('TOKEN_EXPIRED', 'refresh token invalid, expired, or already used');

  return ok({
    accessToken: rotated.accessToken,
    refreshToken: rotated.refreshToken,
    expiresIn: rotated.expiresIn,
    user: {
      id: rotated.user.id, email: rotated.user.email,
      fullName: rotated.user.fullName, role: rotated.user.role,
    },
  });
}
