import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { encryptSecret, randomHex } from '@/lib/crypto';
import { created, fail } from '@/lib/http/response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  deviceId: z.string().min(3).max(64).regex(/^[A-Za-z0-9_-]+$/),
  name: z.string().min(1).max(120),
  applianceType: z.enum(['AIR_CONDITIONER','REFRIGERATOR','FREEZER','WASHING_MACHINE',
                         'TELEVISION','WATER_PURIFIER','COOLER','MICROWAVE','OTHER']).default('OTHER'),
  applianceBrand: z.string().max(80).optional(),
  applianceModel: z.string().max(80).optional(),
  siteName: z.string().max(120).optional(),
  siteAddress: z.string().max(400).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  ownerId: z.string().uuid().nullable().optional(),
});

export async function POST(req: NextRequest) {
  const claims = await requireAuth(req, ['ADMIN']);
  if (!claims) return fail('INSUFFICIENT_ROLE', 'admin role required');

  let body: z.infer<typeof schema>;
  try { body = schema.parse(await req.json()); }
  catch (e) { return fail('VALIDATION_FAILED', (e as Error).message.slice(0, 300)); }

  if (await prisma.device.findUnique({ where: { deviceId: body.deviceId } })) {
    return fail('DEVICE_ID_TAKEN', `${body.deviceId} is already registered`);
  }

  // 32 bytes of entropy. Returned exactly once — it is encrypted at rest and
  // there is no endpoint that reads it back. Lose it and you rotate.
  const secret = randomHex(32);

  const device = await prisma.device.create({
    data: {
      deviceId: body.deviceId,
      name: body.name,
      applianceType: body.applianceType,
      applianceBrand: body.applianceBrand,
      applianceModel: body.applianceModel,
      siteName: body.siteName,
      siteAddress: body.siteAddress,
      latitude: body.latitude,
      longitude: body.longitude,
      ownerId: body.ownerId ?? null,
      secretEnc: encryptSecret(secret),
      status: 'PROVISIONED',
    },
  });

  return created({
    id: device.id,
    deviceId: device.deviceId,
    name: device.name,
    applianceType: device.applianceType,
    status: device.status,
    deviceSecret: secret,
    warning: 'Copy deviceSecret into the firmware secrets.ini now — it is not retrievable later.',
  });
}
