import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_AUDIO_BUCKET: z.string().default('complaints'),
  GEMINI_API_KEY: z.string().min(1),
  GEMINI_MODEL: z.string().default('gemini-2.0-flash'),
  GROQ_API_KEY: z.string().optional().default(''),
  JWT_SECRET: z.string().length(64, 'JWT_SECRET must be 64 hex chars (openssl rand -hex 32)'),
  DEVICE_SECRET_ENC_KEY: z.string().length(64, 'DEVICE_SECRET_ENC_KEY must be 64 hex chars'),
  CORS_ALLOWED_ORIGINS: z.string().default('http://localhost:3000'),
});

// Fail loudly at boot rather than mysteriously at 3 a.m. on one route.
export const env = schema.parse({
  DATABASE_URL: process.env.DATABASE_URL,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_AUDIO_BUCKET: process.env.SUPABASE_AUDIO_BUCKET,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GEMINI_MODEL: process.env.GEMINI_MODEL,
  GROQ_API_KEY: process.env.GROQ_API_KEY,
  JWT_SECRET: process.env.JWT_SECRET,
  DEVICE_SECRET_ENC_KEY: process.env.DEVICE_SECRET_ENC_KEY,
  CORS_ALLOWED_ORIGINS: process.env.CORS_ALLOWED_ORIGINS,
});

export const corsOrigins = env.CORS_ALLOWED_ORIGINS.split(',').map((s) => s.trim());
