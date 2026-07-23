import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyDevice } from '@/lib/device-auth';
import { ok, noContent, fail } from '@/lib/http/response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Deterministic per-device bucket so a staged rollout is stable across polls. */
function rolloutBucket(deviceId: string): number {
  let h = 0;
  for (const ch of deviceId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 100;
}

export async function GET(req: NextRequest) {
  const auth = await verifyDevice(req, '');
  if (!auth.ok) return fail(auth.code, auth.message);

  const current = new URL(req.url).searchParams.get('current') ?? '0.0.0';
  const latest = await prisma.firmwareRelease.findFirst({ orderBy: { createdAt: 'desc' } });
  if (!latest || latest.version === current) return noContent();
  if (rolloutBucket(auth.device.deviceId) >= latest.rolloutPct) return noContent();

  return ok({
    updateAvailable: true,
    version: latest.version,
    url: latest.binaryUrl,
    sha256: latest.sha256,
    sizeBytes: latest.sizeBytes,
    mandatory: latest.isMandatory,
  });
}
