import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { ok, fail } from '@/lib/http/response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ONLINE_WINDOW_MS = 15 * 60 * 1000;

export async function GET(req: NextRequest) {
  if (!(await requireAuth(req))) return fail('TOKEN_INVALID', 'authentication required');

  const now = new Date();
  const startOfDay = new Date(now); startOfDay.setUTCHours(0, 0, 0, 0);
  const weekAgo = new Date(now.getTime() - 7 * 86400_000);
  const onlineSince = new Date(now.getTime() - ONLINE_WINDOW_MS);

  const [totalDevices, onlineDevices, complaintsToday, complaintsThisWeek,
         criticalOpen, lastComplaint, resolved, breakdown] = await Promise.all([
    prisma.device.count(),
    prisma.device.count({ where: { lastSeenAt: { gte: onlineSince } } }),
    prisma.complaint.count({ where: { receivedAt: { gte: startOfDay } } }),
    prisma.complaint.count({ where: { receivedAt: { gte: weekAgo } } }),
    prisma.complaint.count({ where: { severity: 'CRITICAL', status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
    prisma.complaint.findFirst({
      orderBy: { receivedAt: 'desc' },
      select: { id: true, transcript: true, summary: true, severity: true, receivedAt: true,
                device: { select: { deviceId: true, name: true } } },
    }),
    prisma.complaint.findMany({
      where: { resolvedAt: { not: null }, receivedAt: { gte: new Date(now.getTime() - 30 * 86400_000) } },
      select: { receivedAt: true, resolvedAt: true },
      take: 500,
    }),
    prisma.complaint.groupBy({ by: ['severity'], _count: true }),
  ]);

  const avgResolutionHours = resolved.length
    ? resolved.reduce((sum, r) =>
        sum + (r.resolvedAt!.getTime() - r.receivedAt.getTime()) / 3600_000, 0) / resolved.length
    : null;

  return ok({
    totalDevices,
    onlineDevices,
    offlineDevices: totalDevices - onlineDevices,
    complaintsToday,
    complaintsThisWeek,
    criticalOpen,
    avgResolutionHours: avgResolutionHours ? Number(avgResolutionHours.toFixed(1)) : null,
    lastComplaint,
    severityBreakdown: Object.fromEntries(breakdown.map((b) => [b.severity ?? 'UNSET', b._count])),
  });
}
