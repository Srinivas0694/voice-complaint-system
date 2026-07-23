import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { ok, fail } from '@/lib/http/response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const claims = await requireAuth(req);
  if (!claims) return fail('TOKEN_INVALID', 'authentication required');

  const user = await prisma.user.findUnique({
    where: { id: claims.sub },
    select: { id: true, email: true, fullName: true, role: true, lastLoginAt: true, createdAt: true },
  });
  if (!user) return fail('NOT_FOUND', 'user no longer exists');
  return ok(user);
}
