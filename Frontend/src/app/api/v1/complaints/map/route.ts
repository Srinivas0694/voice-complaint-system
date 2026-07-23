import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { ok, fail } from '@/lib/http/response';
import { buildWhere } from '@/lib/complaint-filters';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Deliberately thin: the Leaflet layer needs coordinates, not transcripts. */
export async function GET(req: NextRequest) {
  if (!(await requireAuth(req))) return fail('TOKEN_INVALID', 'authentication required');

  const sp = new URL(req.url).searchParams;
  const rows = await prisma.complaint.findMany({
    where: { ...buildWhere(sp), latitude: { not: null }, longitude: { not: null } },
    take: 2000,
    orderBy: { receivedAt: 'desc' },
    select: {
      id: true, latitude: true, longitude: true, severity: true,
      applianceType: true, status: true, summary: true, receivedAt: true,
      device: { select: { deviceId: true, name: true } },
    },
  });

  return ok({ data: rows, count: rows.length });
}
