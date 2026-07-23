import { prisma } from '@/lib/prisma';
import { ok } from '@/lib/http/response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Point UptimeRobot at this every 5 minutes. It keeps the Supabase project from
 * auto-pausing after 7 idle days, which is the most likely way a free
 * deployment dies quietly.
 */
export async function GET() {
  const started = Date.now();
  let db = 'down';
  try { await prisma.$queryRaw`SELECT 1`; db = 'up'; } catch { /* stays down */ }
  return ok({ status: db === 'up' ? 'ok' : 'degraded', db, latencyMs: Date.now() - started,
              timestamp: new Date().toISOString() });
}
