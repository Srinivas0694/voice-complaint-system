import { NextRequest } from 'next/server';
import { verifyDevice } from '@/lib/device-auth';
import { ok, fail } from '@/lib/http/response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await verifyDevice(req, '');
  if (!auth.ok) return fail(auth.code, auth.message);

  return ok({
    maxRecordSeconds: 15,
    heartbeatIntervalSec: 300,
    deepSleepEnabled: false,          // prototype is USB powered
    uploadRetryScheduleSec: [5, 15, 45, 120, 300, 900],
    wakeWordEnabled: false,
    logLevel: 'INFO',
  });
}
