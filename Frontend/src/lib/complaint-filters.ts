import type { Prisma } from '@prisma/client';

/**
 * Shared query filter for the complaints list, map and export routes.
 *
 * This lives in lib/ rather than in the route file because a Next.js route
 * module may only export HTTP method handlers — anything else fails the
 * production type check, even though `next dev` allows it.
 */
export function buildWhere(sp: URLSearchParams): Prisma.ComplaintWhereInput {
  const q = sp.get('q')?.trim();
  const from = sp.get('from');
  const to = sp.get('to');

  return {
    ...(sp.get('deviceId') ? { device: { deviceId: sp.get('deviceId')! } } : {}),
    ...(sp.get('status') ? { status: sp.get('status') as never } : {}),
    ...(sp.get('severity') ? { severity: sp.get('severity') as never } : {}),
    ...(sp.get('applianceType') ? { applianceType: sp.get('applianceType') as never } : {}),
    ...(sp.get('faultCategory') ? { faultCategory: sp.get('faultCategory')! } : {}),
    ...(sp.get('assignedTo') ? { assignedToId: sp.get('assignedTo')! } : {}),
    ...(sp.get('hasGps') === 'true' ? { latitude: { not: null } } : {}),
    ...(from || to ? { receivedAt: {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(to) } : {}),
    } } : {}),
    ...(q ? { OR: [
      { transcript: { contains: q, mode: 'insensitive' } },
      { summary: { contains: q, mode: 'insensitive' } },
      { faultCategory: { contains: q, mode: 'insensitive' } },
    ] } : {}),
  };
}
