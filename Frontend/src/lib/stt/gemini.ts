import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../env';
import type { SttProvider, SttResult } from './types';
import type { ApplianceType, Severity } from '@prisma/client';

const APPLIANCES = [
  'AIR_CONDITIONER','REFRIGERATOR','FREEZER','WASHING_MACHINE',
  'TELEVISION','WATER_PURIFIER','COOLER','MICROWAVE','OTHER',
] as const;
const SEVERITIES = ['LOW','MEDIUM','HIGH','CRITICAL'] as const;

/**
 * Gemini accepts audio natively, so transcription AND triage happen in one
 * round trip. That is what removes the queue, the worker and the second LLM
 * call from the architecture.
 */
export class GeminiSttProvider implements SttProvider {
  readonly name = 'gemini';
  private client = new GoogleGenerativeAI(env.GEMINI_API_KEY);

  isConfigured() { return env.GEMINI_API_KEY.length > 0; }

  async transcribe(wav: Buffer, hint?: { applianceType?: string | null }): Promise<SttResult> {
    const started = Date.now();
    const model = this.client.getGenerativeModel({
      model: env.GEMINI_MODEL,
      generationConfig: { temperature: 0, responseMimeType: 'application/json' },
    });

    const prompt = `You are processing a spoken appliance fault report from a home or small business in India.
The speaker may use Indian-accented English, Hindi, Telugu, or mix languages within one sentence.

Transcribe the audio exactly as spoken, then classify it.
${hint?.applianceType && hint.applianceType !== 'OTHER'
  ? `The device is installed on a ${hint.applianceType}. Prefer that unless the speaker clearly names a different appliance.`
  : ''}

Return ONLY a JSON object, no markdown fences, with exactly these keys:
{
  "transcript": string,                  // verbatim; "" if no intelligible speech
  "language": string,                    // BCP-47, e.g. "en-IN", "hi-IN", "te-IN"
  "appliance_type": one of ${APPLIANCES.join('|')},
  "fault_category": string,              // SHORT_UPPER_SNAKE, e.g. COOLING, NOISE, DISPLAY, LEAK, POWER, WATER_FLOW, DOOR, SMELL, VIBRATION, UNKNOWN
  "severity": one of ${SEVERITIES.join('|')},
  "summary": string,                     // one clear English sentence a technician can act on
  "confidence": number                   // 0.0-1.0, your confidence in the transcript
}

Severity guidance: CRITICAL = safety risk, smoke, burning smell, electric shock, or total food-spoilage risk.
HIGH = appliance unusable. MEDIUM = degraded but working. LOW = cosmetic or minor.`;

    const res = await model.generateContent([
      { inlineData: { mimeType: 'audio/wav', data: wav.toString('base64') } },
      { text: prompt },
    ]);

    const raw = res.response.text().replace(/```json|```/g, '').trim();
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`gemini returned non-JSON: ${raw.slice(0, 200)}`);
    }

    const appliance = String(parsed.appliance_type ?? '').toUpperCase();
    const severity = String(parsed.severity ?? '').toUpperCase();

    return {
      transcript: String(parsed.transcript ?? '').trim(),
      language: (parsed.language as string) ?? null,
      applianceType: (APPLIANCES as readonly string[]).includes(appliance)
        ? (appliance as ApplianceType) : null,
      faultCategory: parsed.fault_category ? String(parsed.fault_category).toUpperCase() : null,
      severity: (SEVERITIES as readonly string[]).includes(severity)
        ? (severity as Severity) : null,
      summary: (parsed.summary as string) ?? null,
      confidence: typeof parsed.confidence === 'number'
        ? Math.min(1, Math.max(0, parsed.confidence)) : null,
      provider: this.name,
      latencyMs: Date.now() - started,
    };
  }
}
