import { env } from '../env';
import type { SttProvider, SttResult } from './types';

/**
 * Fallback when Gemini rate-limits or errors. Groq's Whisper endpoint is
 * transcription only — no classification — so those fields come back null and
 * the complaint lands untriaged but readable. A degraded ticket beats no ticket.
 */
export class GroqSttProvider implements SttProvider {
  readonly name = 'groq-whisper-large-v3-turbo';

  isConfigured() { return env.GROQ_API_KEY.length > 0; }

  async transcribe(wav: Buffer): Promise<SttResult> {
    const started = Date.now();

    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'complaint.wav');
    form.append('model', 'whisper-large-v3-turbo');
    form.append('response_format', 'json');
    form.append('temperature', '0');

    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` },
      body: form,
    });

    if (!res.ok) throw new Error(`groq ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as { text?: string };

    return {
      transcript: (json.text ?? '').trim(),
      language: null,
      applianceType: null,
      faultCategory: null,
      severity: null,
      summary: null,
      confidence: null,
      provider: this.name,
      latencyMs: Date.now() - started,
    };
  }
}
