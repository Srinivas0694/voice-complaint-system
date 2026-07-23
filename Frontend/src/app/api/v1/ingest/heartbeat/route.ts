import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { verifyDevice } from '@/lib/device-auth';
import { noContent, fail } from '@/lib/http/response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  device_id: z.string(),
  rssi: z.number().int().optional(),
  battery_pct: z.number().int().min(0).max(100).nullable().optional(),
  uptime_sec: z.number().int().nonnegative().optional(),
  free_heap: z.number().int().nonnegative().optional(),
  firmware: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const body = await req.text();
  const auth = await verifyDevice(req, body);
  if (!auth.ok) return fail(auth.code, auth.message);

  let hb: z.infer<typeof schema>;
  try { hb = schema.parse(JSON.parse(body)); }
  catch (e) { return fail('VALIDATION_FAILED', (e as Error).message.slice(0, 200)); }

  await prisma.$transaction([
    prisma.heartbeat.create({
      data: {
        deviceId: auth.device.id,
        rssi: hb.rssi, batteryPct: hb.battery_pct ?? null,
        uptimeSec: hb.uptime_sec, freeHeap: hb.free_heap, firmware: hb.firmware,
      },
    }),
    prisma.device.update({
      where: { id: auth.device.id },
      data: {
        lastSeenAt: new Date(), status: 'ACTIVE',
        lastRssi: hb.rssi, lastBatteryPct: hb.battery_pct ?? null,
        firmwareVersion: hb.firmware ?? undefined,
      },
    }),
  ]);

  return noContent();
}
