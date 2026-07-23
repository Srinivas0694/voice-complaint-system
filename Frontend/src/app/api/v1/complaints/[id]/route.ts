import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { signedAudioUrl } from '@/lib/storage';
import { ok, noContent, fail } from '@/lib/http/response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Ctx) {
  if (!(await requireAuth(req))) return fail('TOKEN_INVALID', 'authentication required');
  const { id } = await params;

  const c = await prisma.complaint.findUnique({
    where: { id },
    include: {
      device: true,
      assignedTo: { select: { id: true, fullName: true, email: true } },
      events: { orderBy: { createdAt: 'asc' },
                include: { actor: { select: { id: true, fullName: true } } } },
    },
  });
  if (!c) return fail('NOT_FOUND', 'complaint not found');

  const { secretEnc, ...device } = c.device;
  // The bucket is private; the dashboard gets a 15-minute presigned link.
  const audioUrl = c.audioUrl ? await signedAudioUrl(c.audioUrl) : null;

  return ok({ ...c, device, audioUrl, audioKey: c.audioUrl });
}

const patchSchema = z.object({
  status: z.enum(['PROCESSING','STT_FAILED','OPEN','IN_PROGRESS','RESOLVED','CLOSED']).optional(),
  severity: z.enum(['LOW','MEDIUM','HIGH','CRITICAL']).optional(),
  assignedToId: z.string().uuid().nullable().optional(),
  faultCategory: z.string().max(60).optional(),
  resolutionNote: z.string().max(2000).optional(),
});

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const claims = await requireAuth(req, ['ADMIN', 'TECHNICIAN']);
  if (!claims) return fail('INSUFFICIENT_ROLE', 'admin or technician role required');
  const { id } = await params;

  let body: z.infer<typeof patchSchema>;
  try { body = patchSchema.parse(await req.json()); }
  catch (e) { return fail('VALIDATION_FAILED', (e as Error).message.slice(0, 300)); }

  const changes = Object.entries(body)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');

  const updated = await prisma.complaint.update({
    where: { id },
    data: {
      ...body,
      ...(body.status === 'RESOLVED' ? { resolvedAt: new Date() } : {}),
      // Every mutation is auditable — who changed what, when.
      events: { create: { type: 'STATUS_CHANGED', message: changes, actorId: claims.sub } },
    },
  });

  return ok(updated);
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  if (!(await requireAuth(req, ['ADMIN']))) return fail('INSUFFICIENT_ROLE', 'admin role required');
  const { id } = await params;
  await prisma.complaint.update({ where: { id }, data: { status: 'CLOSED' } });
  return noContent();
}
