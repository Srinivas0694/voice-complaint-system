import { createClient } from '@supabase/supabase-js';
import { env } from './env';

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const BUCKET = env.SUPABASE_AUDIO_BUCKET;

/** Keyed by date so a manual retention sweep is one prefix delete. */
export function audioKey(deviceId: string, uuid: string): string {
  const d = new Date();
  const stamp = `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`;
  return `${stamp}/${deviceId}/${uuid}.wav`;
}

export async function uploadAudio(key: string, data: Buffer): Promise<string> {
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(key, data, { contentType: 'audio/wav', upsert: true });
  if (error) throw new Error(`storage upload failed: ${error.message}`);
  return key;
}

/** Presigned URL — the bucket stays private; the dashboard gets 15-minute links. */
export async function signedAudioUrl(key: string, expiresSec = 900): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(key, expiresSec);
  if (error) return null;
  return data.signedUrl;
}

export async function deleteAudio(key: string): Promise<void> {
  await supabase.storage.from(BUCKET).remove([key]);
}
