import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { encryptSecret, randomHex } from '@/lib/crypto';
import { ok, noContent, fail } from '@/lib/http/response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Ctx) {
  if (!(await requireAuth(req))) return fail('TOKEN_INVALID', 'authentication required');
  const { id } = await params;

  const device = await prisma.device.findUnique({
    where: { id },
    include: {
      _count: { select: { complaints: true } },
      complaints: { take: 10, orderBy: { receivedAt: 'desc' },
                    select: { id: true, transcript: true, severity: true,
                              status: true, receivedAt: true } },
      heartbeats: { take: 50, orderBy: { createdAt: 'desc' } },
    },
  });
  if (!device) return fail('NOT_FOUND', 'device not found');

  const { secretEnc, ...safe } = device;   // never leak the ciphertext
  return ok(safe);
}

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  applianceType: z.string().optional(),
  applianceBrand: z.string().optional(),
  siteName: z.string().optional(),
  siteAddress: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  status: z.enum(['PROVISIONED', 'ACTIVE', 'INACTIVE', 'REVOKED']).optional(),
  ownerId: z.string().uuid().nullable().optional(),
});

export async function PUT(req: NextRequest, { params }: Ctx) {
  if (!(await requireAuth(req, ['ADMIN']))) return fail('INSUFFICIENT_ROLE', 'admin role required');
  const { id } = await params;

  let body: z.infer<typeof patchSchema>;
  try { body = patchSchema.parse(await req.json()); }
  catch (e) { return fail('VALIDATION_FAILED', (e as Error).message.slice(0, 300)); }

  const device = await prisma.device.update({ where: { id }, data: body as never });
  const { secretEnc, ...safe } = device;
  return ok(safe);
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  if (!(await requireAuth(req, ['ADMIN']))) return fail('INSUFFICIENT_ROLE', 'admin role required');
  const { id } = await params;
  await prisma.device.delete({ where: { id } });
  return noContent();
}

/** POST /devices/{id} with ?action=rotate-secret | revoke */
export async function POST(req: NextRequest, { params }: Ctx) {
  if (!(await requireAuth(req, ['ADMIN']))) return fail('INSUFFICIENT_ROLE', 'admin role required');
  const { id } = await params;
  const action = new URL(req.url).searchParams.get('action');

  if (action === 'rotate-secret') {
    const secret = randomHex(32);
    await prisma.device.update({
      where: { id },
      data: { secretEnc: encryptSecret(secret), status: 'PROVISIONED' },
    });
    return ok({ deviceSecret: secret,
                warning: 'The device will fail every request until this is flashed to it.' });
  }

  if (action === 'revoke') {
    await prisma.device.update({ where: { id }, data: { status: 'REVOKED' } });
    return ok({ status: 'REVOKED' });
  }

  return fail('VALIDATION_FAILED', 'action must be rotate-secret or revoke');
}
