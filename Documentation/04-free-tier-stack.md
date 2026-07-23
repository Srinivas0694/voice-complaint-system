# 04 — The Zero-Cost Server Stack

Two viable free paths. Pick by whether this is a pilot/demo or a revenue product.

---

## Path A — Serverless free tiers (recommended to start)

| Service | Free allowance | What it runs | Card required |
|---|---|---|---|
| **Vercel Hobby** | 100 GB bandwidth/mo, 1 M function invocations, 60 s max duration | Dashboard **and** the whole API | No |
| **Supabase Free** | Postgres 500 MB, Storage 1 GB, 5 GB egress, 50 k MAU auth | Database + audio blobs | No |
| **Google AI Studio (Gemini)** | Flash tier: ~15 req/min, 1,500 req/day | Transcription **+** classification | No |
| **Groq** (fallback STT) | `whisper-large-v3-turbo`, generous per-day limits | Backup transcription | No |
| **Cloudflare** | DNS + proxy | Custom domain, TLS | No |
| **GitHub Actions** | 2,000 min/mo | CI, firmware build artifacts | No |
| **UptimeRobot** | 50 monitors, 5 min interval | Keeps things warm, alerts | No |

### Capacity before anything breaks

| Limit | Ceiling | Reality |
|---|---|---|
| Gemini free tier | 1,500 complaints/day | The real cap. Far past pilot scale. |
| Supabase Storage 1 GB | ~2,100 complaints at 480 KB each | Auto-delete audio after 90 days → effectively unbounded |
| Supabase Postgres 500 MB | ~400,000 complaint rows | Not your problem for years |
| Vercel 1 M invocations | ~30,000/day | Not your problem |
| Supabase project pause | Pauses after 7 days with **zero** activity | UptimeRobot pinging `/api/health` prevents it |

### The three honest caveats

1. **Vercel Hobby forbids commercial use.** Their ToS restricts Hobby to non-commercial projects.
   For a demo, a college submission, or an internal pilot this is fine. The moment you invoice a
   customer for it, you need Pro (~$20/mo) or Path B.
2. **Gemini's free tier may use your data to improve their models.** Voice complaints about a
   fridge are low-risk, but if a customer records something identifying, that is a real disclosure.
   The paid tier is excluded from training. Path B with self-hosted Whisper avoids it entirely.
3. **Free tiers change.** Every limit above is a snapshot — verify before you commit, and keep the
   `SttProvider` interface so switching providers is one file.

---

## Path B — Oracle Cloud Always Free (free *and* commercial-safe)

Oracle's Always Free tier gives an **ARM Ampere A1 VM: 4 cores, 24 GB RAM, 200 GB block storage,
10 TB egress/month — permanently free**, with no commercial-use restriction. That is a genuinely
capable server, and it changes the calculus completely: 24 GB of RAM will run
`faster-whisper` (small/medium int8 on CPU) locally at roughly real-time speed.

```
Oracle A1 VM (Ubuntu 24.04) — docker compose
├── caddy            TLS via Let's Encrypt, reverse proxy
├── nextjs           dashboard
├── api              NestJS (lifted from Backend/)
├── postgres:16      + PostGIS
├── redis            BullMQ queue
├── minio            S3-compatible audio storage
└── whisper-worker   faster-whisper small int8, CPU, ~1.2× realtime on 4 A1 cores
```

**No external API calls at all.** No per-complaint cost, no data leaving your box, no rate limit.
Cost: ₹0/month plus a domain (~₹800/year).

**The tradeoffs, stated plainly:** you own the ops. Backups, patching, TLS renewal, monitoring,
and Oracle's habit of reclaiming idle Always Free instances (keep it busy; a cron is enough).
Capacity signup in the ap-hyderabad-1 region is sometimes unavailable — try ap-mumbai-1.

---

## Recommendation

**Start on Path A.** It gets you deployed this week with no ops burden, and the code is identical
either way because everything goes through `SttProvider`, `StorageProvider`, and Prisma.

**Move to Path B when any of these become true:** you charge money for it, you exceed 1,500
complaints/day, or a customer asks where the audio is processed.

---

## What "free" removed from the original design

The free constraint made the architecture *better*, not just cheaper:

| Removed | Why it's no longer needed |
|---|---|
| Redis + BullMQ | Gemini returns in 2–5 s, inside the serverless window. No async job needed. |
| Separate NestJS deployment | Route Handlers do the same work with one deploy target. |
| MQTT broker | HTTPS heartbeat every 5 min. Online/offline derived from `last_seen_at`. |
| Cloudflare R2 | Supabase Storage covers it, one less account and one less credential. |
| Second LLM classification call | Gemini takes audio natively and returns transcript + category + severity in one response. |
| OpenAI Whisper | Gemini free tier does it. Groq Whisper stays as the fallback adapter. |

**One thing got harder:** the ingest endpoint is now synchronous, so a Gemini timeout becomes a 5xx
the device must retry. The firmware's retry ladder already handles this, and the complaint row is
written *before* the STT call — so audio is never lost even when transcription fails. Status lands
as `STT_FAILED` and `POST /complaints/{id}/retry-stt` reprocesses it from the dashboard.
