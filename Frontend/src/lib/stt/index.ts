import { GeminiSttProvider } from './gemini';
import { GroqSttProvider } from './groq';
import { classify } from './classify';
import type { SttResult } from './types';

export type { SttProvider, SttResult } from './types';

const gemini = new GeminiSttProvider();
const groq = new GroqSttProvider();

// STT_PROVIDER=groq|gemini. Default is groq, because Gemini's free tier now
// returns 429 limit:0 without a linked billing account — leaving it primary
// means every complaint pays ~800 ms for a call that is known to fail.
// The other provider stays as the fallback either way.
const preferGroq = (process.env.STT_PROVIDER ?? 'groq').toLowerCase() !== 'gemini';
const chain = preferGroq ? [groq, gemini] : [gemini, groq];

/**
 * Transcribe, then enrich if the provider only returned words.
 *
 * Gemini takes audio natively and returns transcript plus classification in
 * one call. Groq's Whisper returns words only, so a second free text call
 * recovers appliance, fault category and severity. Swapping in self-hosted
 * faster-whisper later means adding one class here — no route, firmware or
 * schema change.
 */
export async function transcribe(
  wav: Buffer,
  hint?: { applianceType?: string | null },
): Promise<SttResult> {
  let lastErr: Error = new Error('no STT provider configured');

  for (const provider of chain) {
    if (!provider.isConfigured()) continue;
    try {
      const result = await provider.transcribe(wav, hint);

      // Only pay for the second call when the provider left it blank.
      if (result.severity === null) {
        const extra = await classify(result.transcript, hint);
        return {
          ...result,
          applianceType: result.applianceType ?? extra.applianceType,
          faultCategory: result.faultCategory ?? extra.faultCategory,
          severity: extra.severity,
          summary: result.summary ?? extra.summary,
        };
      }
      return result;
    } catch (err) {
      lastErr = err as Error;
      console.error(`[stt] ${provider.name} failed:`, lastErr.message);
    }
  }

  throw lastErr;
}
