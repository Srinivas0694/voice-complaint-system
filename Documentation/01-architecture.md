# 01 — System Architecture

## 1. Block diagram

```
┌──────────────────── DEVICE (ESP32-S3-WROOM-1 N16R8) ─────────────────────┐
│                                                                          │
│   [Push Button] ──► GPIO7  (INT + EXT1 deep-sleep wake)                  │
│   [INMP441 Mic] ──► I2S0   (SD 4 / SCK 5 / WS 6)                         │
│   [A9G GNSS]    ──► UART1  (RX 17 / TX 18, PWRKEY 16)                    │
│   [WS2812 LED]  ◄── GPIO48 (RMT)                                         │
│   [Buzzer]      ◄── GPIO8  (LEDC tone)                                   │
│   [Batt divider]──► GPIO1  (ADC1_CH0)                                    │
│   [USB-C]       ◄─► GPIO19/20 (native CDC — no bridge IC)                │
│                                                                          │
│   Core 0: audioTask (I2S DMA → 480 KB ring buffer in PSRAM)              │
│   Core 1: appTask (state machine) · netTask (Wi-Fi/HTTPS) · gpsTask       │
│           uploadTask (PSRAM → POST; spills to LittleFS only on failure)   │
│           otaTask                                                        │
└──────────────────────────────┬───────────────────────────────────────────┘
                               │ HTTPS multipart POST (audio + metadata)
                               │ HTTPS heartbeat every 5 min
                               ▼
┌────────────── BACKEND — Next.js Route Handlers on Vercel ────────────────┐
│  POST /api/v1/ingest/complaints                                          │
│     1. verify HMAC (device secret, timestamp, nonce)                     │
│     2. upload WAV ──────────────► Supabase Storage                       │
│     3. INSERT complaint row ────► Supabase Postgres (status=PROCESSING)  │
│     4. Gemini Flash: audio ──► { transcript, appliance,                  │
│                                  fault_category, severity, summary }     │
│        └─ fallback: Groq whisper-large-v3-turbo                          │
│     5. UPDATE row (status=OPEN) ──► 200 { complaintId, transcript }      │
│        on STT failure ──► status=STT_FAILED, audio retained              │
│                                                                          │
│  Total ≈ 3–6 s, inside the 60 s function limit. No queue, no worker.     │
└──────────────────────────────┬───────────────────────────────────────────┘
                               │ HTTPS + JWT
                               ▼
                    ┌── FRONTEND (Vercel) ──┐
                    │  Next.js 15 dashboard │
                    └───────────────────────┘

Everything above runs on free tiers. See Documentation/04-free-tier-stack.md.
```

## 2. Complaint lifecycle

```
IDLE
 └─ button press (>80 ms debounce)
     └─ RECORDING ─ LED solid blue ─ I2S DMA → PSRAM ring buffer
         ├─ release  ──────────────► CAPTURED
         └─ 15 s cap ──────────────► CAPTURED
              └─ CAPTURED ─ LED blinking ─ read GNSS snapshot, build meta
                   └─ UPLOADING ─ multipart POST from PSRAM, HMAC-signed
                             ├─ 2xx ──► LED green 2 s ─► delete files ─► IDLE
                             ├─ 4xx ──► LED red 3 s   ─► move to /dead ─► IDLE
                             └─ 5xx / no net ──► spill PSRAM → /outbox/<uuid>.wav
                                  (durable, survives reboot)
                                  retry: 5s,15s,45s,2m,5m,15m (cap)
```

**Idempotency.** The device generates `complaint_uuid` (UUIDv4 from the hardware RNG) at record
time and reuses it across every retry. The server upserts on that key, so a response lost on the
wire never produces a duplicate ticket.

## 3. Why synchronous transcription (and when to change it)

The original design used a Redis + BullMQ worker. The free-tier constraint killed Redis, and it
turned out not to matter: Gemini Flash accepts the WAV natively and returns transcript **and**
classification in 2–5 s, which fits inside a 60 s serverless function with room to spare. One
request in, one enriched complaint out, no queue, no worker, no second deploy target.

Two rules keep this safe:

1. **The complaint row is written before the STT call.** If Gemini times out, the audio is already
   in Supabase Storage and the row exists with `status = STT_FAILED`. Nothing is ever lost — the
   dashboard can replay it via `POST /complaints/{id}/retry-stt`.
2. **The device owns the retry.** A 5xx is just another entry in the firmware's backoff ladder.

Move back to a queue when either becomes true: sustained load past ~15 complaints/minute (the
Gemini free-tier RPM ceiling), or a switch to a self-hosted Whisper that runs slower than the
function timeout. The `SttProvider` interface makes that a backend-only change; firmware is untouched.

## 4. Failure matrix

| Failure | Behaviour |
|---|---|
| Wi-Fi down at record time | Complaint persists in `/outbox`; uploadTask drains on reconnect |
| Power loss mid-recording | PSRAM contents lost, nothing written → clean boot, no partial file to reap |
| Power loss after spill-to-flash | `meta.json` sidecar present → uploaded on next boot |
| Server 5xx | Exponential backoff, max 6 attempts, then held (not dropped) for manual flush |
| STT failure after fallback | Complaint status `STT_FAILED`, audio still playable and retryable in dashboard |
| GNSS no fix | `latitude`/`longitude` null, `gps_status: "NO_FIX"`; last known fix sent as `last_known_*` |
| Outbox full (> 3.5 MB, ~8 complaints) | Oldest queued complaint dropped, `OUTBOX_OVERFLOW` event logged |
| Gemini rate limit (429) | Falls back to Groq Whisper adapter; if that also fails → `STT_FAILED`, retryable from dashboard |
| Firmware hang | Task watchdog (10 s) → reboot; boot counter → OTA rollback if 3 crashes in 5 min |

## 5. Security model

**Device → server.** Every request carries:

```
X-Device-Id:  DEVICE_001
X-Timestamp:  1753012345          (unix seconds)
X-Nonce:      9f2c...             (16 random bytes, hex)
X-Signature:  hex(HMAC_SHA256(device_secret,
                  deviceId + "\n" + timestamp + "\n" + nonce + "\n" + sha256hex(body)))
```

Server rejects if: unknown device, |now − timestamp| > 300 s, nonce seen in Redis within the
window, signature mismatch, or device `status = REVOKED`. The secret is provisioned once into
encrypted NVS (flash encryption + secure boot v2 in production) and is never transmitted.

**Human → server.** JWT access token (15 min, RS256) + rotating refresh token stored hashed in
Postgres. Roles: `ADMIN`, `TECHNICIAN`, `VIEWER`.

**Transport.** TLS 1.2+ everywhere. The ESP32 pins the CA root cert in flash and rejects on
mismatch. HSTS + strict CORS allowlist on the API. Rate limits: 30 req/min per device on ingest,
100 req/min per IP on auth, 600 req/min per user on read endpoints.
