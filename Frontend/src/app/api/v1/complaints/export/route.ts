import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { fail } from '@/lib/http/response';
import { rateLimit } from '@/lib/http/rate-limit';
import { buildWhere } from '@/lib/complaint-filters';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const COLUMNS = [
  'id','uuid','device_id','device_name','appliance_type','transcript','summary',
  'fault_category','severity','status','latitude','longitude','gps_accuracy_m',
  'gps_status','satellites','firmware','rssi','battery_pct','recorded_at','received_at',
] as const;

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  // A transcript can contain commas, quotes and newlines — all three must be escaped.
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: NextRequest) {
  const claims = await requireAuth(req);
  if (!claims) return fail('TOKEN_INVALID', 'authentication required');

  const rl = rateLimit(`export:${claims.sub}`, 5, 3600_000);
  if (!rl.allowed) return fail('RATE_LIMITED', 'export limit is 5 per hour');

  const sp = new URL(req.url).searchParams;
  const format = sp.get('format') ?? 'csv';

  const rows = await prisma.complaint.findMany({
    where: buildWhere(sp),
    orderBy: { receivedAt: 'desc' },
    take: 10_000,
    include: { device: { select: { deviceId: true, name: true } } },
  });

  const records = rows.map((c) => ({
    id: c.id, uuid: c.uuid,
    device_id: c.device.deviceId, device_name: c.device.name,
    appliance_type: c.applianceType, transcript: c.transcript, summary: c.summary,
    fault_category: c.faultCategory, severity: c.severity, status: c.status,
    latitude: c.latitude, longitude: c.longitude, gps_accuracy_m: c.gpsAccuracyM,
    gps_status: c.gpsStatus, satellites: c.satellites,
    firmware: c.firmwareVersion, rssi: c.rssi, battery_pct: c.batteryPct,
    recorded_at: c.recordedAt?.toISOString(), received_at: c.receivedAt.toISOString(),
  }));

  const stamp = new Date().toISOString().slice(0, 10);

  if (format === 'json') {
    return new Response(JSON.stringify(records, null, 2), {
      headers: { 'Content-Type': 'application/json',
                 'Content-Disposition': `attachment; filename="complaints-${stamp}.json"` },
    });
  }

  // CSV covers csv and xlsx-via-import. Excel opens this natively; the BOM stops
  // it mangling non-ASCII transcripts (Hindi/Telugu) into mojibake.
  const header = COLUMNS.join(',');
  const body = records.map((r) => COLUMNS.map((c) => csvCell((r as never)[c])).join(',')).join('\n');

  return new Response('\uFEFF' + header + '\n' + body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="complaints-${stamp}.csv"`,
    },
  });
}
