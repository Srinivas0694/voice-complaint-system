import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { paginated, fail } from '@/lib/http/response';
import type { Prisma } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ONLINE_WINDOW_MS = 15 * 60 * 1000;

export async function GET(req: NextRequest) {
  const claims = await requireAuth(req);
  if (!claims) return fail('TOKEN_INVALID', 'authentication required');

  const sp = new URL(req.url).searchParams;
  const page = Math.max(1, Number(sp.get('page') ?? 1));
  const limit = Math.min(100, Math.max(1, Number(sp.get('limit') ?? 20)));
  const q = sp.get('q')?.trim();

  const where: Prisma.DeviceWhereInput = {
    ...(sp.get('status') ? { status: sp.get('status') as never } : {}),
    ...(sp.get('applianceType') ? { applianceType: sp.get('applianceType') as never } : {}),
    ...(q ? { OR: [
      { deviceId: { contains: q, mode: 'insensitive' } },
      { name: { contains: q, mode: 'insensitive' } },
      { siteName: { contains: q, mode: 'insensitive' } },
    ] } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.device.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { [sp.get('sortBy') ?? 'createdAt']: sp.get('sortDir') === 'asc' ? 'asc' : 'desc' },
      include: { _count: { select: { complaints: true } } },
    }),
    prisma.device.count({ where }),
  ]);

  const openCounts = await prisma.complaint.groupBy({
    by: ['deviceId'],
    where: { deviceId: { in: rows.map((r) => r.id) }, status: { in: ['OPEN', 'IN_PROGRESS'] } },
    _count: true,
  });
  const openMap = new Map(openCounts.map((c) => [c.deviceId, c._count]));

  const now = Date.now();
  const data = rows.map((d) => ({
    id: d.id,
    deviceId: d.deviceId,
    name: d.name,
    applianceType: d.applianceType,
    status: d.status,
    // Derived, not stored: a device that dies never gets to tell you it went offline.
    online: !!d.lastSeenAt && now - d.lastSeenAt.getTime() < ONLINE_WINDOW_MS,
    lastSeenAt: d.lastSeenAt,
    lastRssi: d.lastRssi,
    lastBatteryPct: d.lastBatteryPct,
    firmwareVersion: d.firmwareVersion,
    siteName: d.siteName,
    siteAddress: d.siteAddress,
    latitude: d.latitude,
    longitude: d.longitude,
    complaintCount: d._count.complaints,
    openComplaintCount: openMap.get(d.id) ?? 0,
  }));

  return paginated(data, page, limit, total);
}
