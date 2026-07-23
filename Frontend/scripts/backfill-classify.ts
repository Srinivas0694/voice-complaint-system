/**
 * Reclassifies complaints that were transcribed before the classifier existed —
 * everything captured while Groq was transcription-only landed with a MEDIUM
 * default and no fault category.
 *
 *   npx tsx scripts/backfill-classify.ts            # dry run, changes nothing
 *   npx tsx scripts/backfill-classify.ts --apply
 *
 * Only touches rows with a real transcript and no faultCategory, so it is safe
 * to re-run and will never overwrite a classification made at ingest.
 */
import { PrismaClient } from '@prisma/client';
import { classify } from '../src/lib/stt/classify';

const prisma = new PrismaClient();

async function main() {
  const apply = process.argv.includes('--apply');

  const rows = await prisma.complaint.findMany({
    where: {
      faultCategory: null,
      transcript: { not: null },
      status: { notIn: ['PROCESSING', 'STT_FAILED'] },
    },
    include: { device: { select: { applianceType: true } } },
    orderBy: { receivedAt: 'desc' },
  });

  // Whisper writes "." for silence; those carry no information to classify.
  const candidates = rows.filter((c) => (c.transcript ?? '').trim().length >= 3);

  console.log(`\n${rows.length} unclassified, ${candidates.length} with usable text`);
  if (!apply) console.log('dry run — pass --apply to write\n');
  else console.log('');

  for (const c of candidates) {
    const result = await classify(c.transcript!, { applianceType: c.device.applianceType });

    const text = (c.transcript ?? '').slice(0, 48).padEnd(48);
    if (!result.severity && !result.faultCategory) {
      console.log(`skip   ${text}  (classifier returned nothing)`);
      continue;
    }

    console.log(`${apply ? 'write ' : 'would '} ${text}  ${result.faultCategory ?? '—'} / ${result.severity ?? '—'}`);

    if (apply) {
      await prisma.complaint.update({
        where: { id: c.id },
        data: {
          faultCategory: result.faultCategory,
          severity: result.severity ?? undefined,
          applianceType: result.applianceType ?? undefined,
          summary: c.summary ?? result.summary,
          events: {
            create: { type: 'RECLASSIFIED', message: 'backfilled by classifier' },
          },
        },
      });
    }

    // Groq's free tier is ~30 requests/minute. Pace it rather than get 429s
    // halfway through and leave the backfill half-applied.
    await new Promise((r) => setTimeout(r, 2500));
  }

  console.log(apply ? '\ndone\n' : '\nnothing written — re-run with --apply\n');
}

main().finally(() => prisma.$disconnect());
