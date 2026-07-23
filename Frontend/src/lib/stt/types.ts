import type { ApplianceType, Severity } from '@prisma/client';

export interface SttResult {
  transcript: string;
  language: string | null;
  applianceType: ApplianceType | null;
  faultCategory: string | null;
  severity: Severity | null;
  summary: string | null;
  confidence: number | null;
  provider: string;
  latencyMs: number;
}

export interface SttProvider {
  readonly name: string;
  isConfigured(): boolean;
  /** wav is a complete RIFF/WAVE buffer, 16 kHz mono 16-bit. */
  transcribe(wav: Buffer, hint?: { applianceType?: string | null }): Promise<SttResult>;
}
