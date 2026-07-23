import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { paginated, fail } from '@/lib/http/response';
import { buildWhere } from '@/lib/complaint-filters';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!(await requireAuth(req))) return fail('TOKEN_INVALID', 'authentication required');

  const sp = new URL(req.url).searchParams;
  const page = Math.max(1, Number(sp.get('page') ?? 1));
  const limit = Math.min(100, Math.max(1, Number(sp.get('limit') ?? 20)));
  const where = buildWhere(sp);

  const [rows, total] = await Promise.all([
    prisma.complaint.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { [sp.get('sortBy') ?? 'receivedAt']: sp.get('sortDir') === 'asc' ? 'asc' : 'desc' },
      include: { device: { select: { id: true, deviceId: true, name: true, siteName: true } },
                 assignedTo: { select: { id: true, fullName: true } } },
    }),
    prisma.complaint.count({ where }),
  ]);

  const data = rows.map((c) => ({
    id: c.id,
    uuid: c.uuid,
    device: c.device,
    applianceType: c.applianceType,
    transcript: c.transcript,
    summary: c.summary,
    faultCategory: c.faultCategory,
    severity: c.severity,
    status: c.status,
    assignedTo: c.assignedTo,
    location: {
      latitude: c.latitude, longitude: c.longitude,
      accuracyM: c.gpsAccuracyM, status: c.gpsStatus, satellites: c.satellites,
    },
    audioDurationMs: c.audioDurationMs,
    recordedAt: c.recordedAt,
    receivedAt: c.receivedAt,
  }));

  return paginated(data, page, limit, total);
}
