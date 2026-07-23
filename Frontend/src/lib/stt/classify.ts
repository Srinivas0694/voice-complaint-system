import type { ApplianceType, Severity } from '@prisma/client';
import { env } from '../env';

/**
 * Second pass over a transcript, for providers that only transcribe.
 *
 * Groq's Whisper endpoint returns words and nothing else, so complaints
 * arrived untriaged — every one defaulting to MEDIUM, which made the severity
 * chart a single bar. This runs the transcript through Groq's free text model
 * to recover appliance, fault category and severity.
 *
 * Costs nothing, adds ~400 ms, and never throws: a failure here leaves the
 * complaint readable but unclassified, which is exactly where it was before.
 */

const APPLIANCES = [
  'AIR_CONDITIONER', 'REFRIGERATOR', 'FREEZER', 'WASHING_MACHINE',
  'TELEVISION', 'WATER_PURIFIER', 'COOLER', 'MICROWAVE', 'OTHER',
] as const;

const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

// Free-text, but a stable vocabulary keeps the dashboard filter useful.
const CATEGORIES = [
  'COOLING', 'HEATING', 'NOISE', 'LEAK', 'POWER', 'DISPLAY',
  'DRAINAGE', 'ROTATION', 'SMELL', 'VIBRATION', 'CONTROLS', 'OTHER',
];

export interface Classification {
  applianceType: ApplianceType | null;
  faultCategory: string | null;
  severity: Severity | null;
  summary: string | null;
}

const EMPTY: Classification = {
  applianceType: null, faultCategory: null, severity: null, summary: null,
};

// Groq serves this free. Override with GROQ_TEXT_MODEL if the name changes —
// it has a working default, so it does not belong in the fail-loudly env schema.
const MODEL = process.env.GROQ_TEXT_MODEL ?? 'llama-3.3-70b-versatile';

const SYSTEM = `You triage spoken appliance fault reports. Reply with JSON only — no prose, no markdown fences.

{
  "applianceType": one of ${APPLIANCES.join(' | ')},
  "faultCategory": one of ${CATEGORIES.join(' | ')},
  "severity": one of ${SEVERITIES.join(' | ')},
  "summary": one short sentence, under 12 words
}

Severity guidance:
CRITICAL — safety risk, or stock/contents actively spoiling right now
HIGH     — appliance unusable
MEDIUM   — works but degraded
LOW      — cosmetic or minor

The transcript comes from automatic speech recognition and may contain
mis-heard words. Infer intent from context rather than reading literally.
If the appliance is not stated, use the hint. If you cannot tell, use OTHER.`;

export async function classify(
  transcript: string,
  hint?: { applianceType?: string | null },
): Promise<Classification> {
  const text = transcript.trim();

  // Whisper emits "." or "" for silence — nothing to classify, and a request
  // would just burn quota returning noise.
  if (text.length < 3 || !env.GROQ_API_KEY) return EMPTY;

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        max_tokens: 200,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          {
            role: 'user',
            content: hint?.applianceType && hint.applianceType !== 'OTHER'
              ? `Device is registered as a ${hint.applianceType}.\nTranscript: "${text}"`
              : `Transcript: "${text}"`,
          },
        ],
      }),
    });

    if (!res.ok) {
      console.warn(`[classify] groq ${res.status}: ${(await res.text()).slice(0, 160)}`);
      return EMPTY;
    }

    const body = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = body.choices?.[0]?.message?.content;
    if (!raw) return EMPTY;

    const parsed = JSON.parse(raw) as Record<string, unknown>;

    // Validate against the enums rather than trusting the model — an unknown
    // value would fail the Prisma write and lose the whole complaint.
    const appliance = String(parsed.applianceType ?? '').toUpperCase();
    const severity = String(parsed.severity ?? '').toUpperCase();
    const category = String(parsed.faultCategory ?? '').toUpperCase();
    const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : '';

    return {
      applianceType: (APPLIANCES as readonly string[]).includes(appliance)
        ? (appliance as ApplianceType) : null,
      severity: (SEVERITIES as readonly string[]).includes(severity)
        ? (severity as Severity) : null,
      faultCategory: category.length > 0 && category.length <= 32 ? category : null,
      summary: summary.length > 0 ? summary.slice(0, 160) : null,
    };
  } catch (err) {
    console.warn('[classify] failed:', (err as Error).message);
    return EMPTY;
  }
}
