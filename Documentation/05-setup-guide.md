# 05 — Setup Guide: every manual step, both sides

Read this once end to end before touching anything. Total time: ~90 minutes, of which ~50 is
waiting on account signups and a GPS cold fix.

**What is automated vs. manual:**

| Automated (scripts do it) | Manual (only you can do it) |
|---|---|
| Database tables + indexes (`prisma db push`) | Creating the Supabase project |
| Admin user creation (`db:seed`) | Creating the storage bucket |
| Device registration + secret generation (`register-device`) | Getting the Gemini API key |
| Signing test uploads (`test-ingest`) | Pasting secrets into `.env` and `secrets.ini` |
| Prisma client generation (on `npm run build`) | Wiring the hardware |
| TLS certificates (Vercel) | Taking the device outdoors for a GPS fix |

---

# PART A — Server side

## A1. Create the Supabase project  *(manual, ~5 min)*

1. Go to `supabase.com` → sign in with GitHub → **New project**.
2. Name: `voice-complaint-system`. Region: **South Asia (Mumbai) ap-south-1** — closest to
   Hyderabad, ~25 ms instead of ~250 ms to a US region.
3. Set a database password. **Copy it now into a note.** Supabase shows it once; if you lose it
   you have to reset it and every connection string changes.
4. Wait ~2 minutes for provisioning.

## A2. Create the storage bucket  *(manual, ~1 min)*

1. Left sidebar → **Storage** → **New bucket**.
2. Name it exactly `complaints`. Leave **Public** *off* — audio is served through short-lived
   presigned URLs, never public links.
3. Create.

> If you name it anything else, set `SUPABASE_AUDIO_BUCKET` to match. A mismatch shows up as
> `audio storage unavailable` on ingest, which reads like a network problem but isn't.

## A3. Collect five values  *(manual, ~3 min)*

| Where | What |
|---|---|
| Settings → Database → Connection string → **URI** | `DATABASE_URL` — take the **pooled** one, port **6543**, and keep `?pgbouncer=true` |
| Same page, **Direct connection**, port 5432 | `DIRECT_URL` |
| Settings → API → Project URL | `SUPABASE_URL` |
| Settings → API → `service_role` key (click reveal) | `SUPABASE_SERVICE_ROLE_KEY` |
| — | the DB password from A1, substituted into both connection strings |

**Port 6543 vs 5432 matters.** Serverless functions open a connection per invocation; direct
Postgres connections exhaust the free tier's limit within minutes of real traffic. The pooler
handles that. Migrations need the direct connection because pgbouncer can't run DDL in a
transaction — that's why both exist.

**The `service_role` key bypasses row-level security.** It is server-only. Never put it in a
`NEXT_PUBLIC_` variable, never ship it to the browser, never commit it.

## A4. Get the Gemini API key  *(manual, ~2 min)*

1. `aistudio.google.com/apikey` → sign in → **Create API key**.
2. Pick a Google Cloud project (or let it create one). No billing account needed.
3. Copy the key.

Optional fallback: `console.groq.com/keys` → create a key → `GROQ_API_KEY`. Leave it blank and the
system just won't have a fallback when Gemini rate-limits.

## A5. Generate two crypto keys  *(manual, 30 sec)*

```bash
openssl rand -hex 32     # → JWT_SECRET
openssl rand -hex 32     # → DEVICE_SECRET_ENC_KEY
```

Run it twice, two different values, both exactly 64 hex characters. The app refuses to boot if
they're the wrong length — deliberately, because a short key silently weakens everything downstream.

`DEVICE_SECRET_ENC_KEY` encrypts device secrets at rest with AES-256-GCM. **It cannot be a hash.**
HMAC verification needs the original plaintext secret to recompute the signature, so the server must
be able to decrypt it. (This corrects the "argon2id hash" line in the earlier architecture doc —
hashing works for passwords, not for shared secrets.) **If you lose this key, every device must be
re-flashed with a new secret.** Back it up.

## A6. Run it locally  *(manual + scripted, ~10 min)*

```bash
cd VoiceComplaintSystem/Frontend
npm install                       # ~2 min

cp .env.example .env              # then fill in everything from A3-A5
npx prisma generate
npx prisma db push                # creates all tables — no migration files needed yet
npm run db:seed                   # creates the admin user
npm run dev
```

`db:seed` prints the admin email and password it created. **Change that password after first
login.**

Verify:
```bash
curl http://localhost:3000/api/health
# {"status":"ok","database":"connected","storage":"reachable",...}
```

If `database` is not `connected`: 90% of the time the password in `DATABASE_URL` contains a
character that needs URL-encoding (`@` → `%40`, `#` → `%23`). Reset to an alphanumeric password.

## A7. Register your first device  *(scripted, 30 sec)*

```bash
npx tsx scripts/register-device.ts DEVICE_001 "Bench prototype" FREEZER
```

Output includes a **64-hex device secret, shown once**. It goes straight into the firmware's
`secrets.ini`. If you lose it, re-run with `--rotate`.

## A8. Test the whole pipeline with no hardware  *(scripted, 1 min)*

```bash
export TEST_DEVICE_ID=DEVICE_001
export TEST_DEVICE_SECRET=<the 64-hex secret>
npx tsx scripts/test-ingest.ts
```

This synthesises a WAV, signs it exactly the way the ESP32 does, and posts it. **Do this before you
touch the hardware.** It separates "my backend is broken" from "my wiring is broken" — debugging
both at once is where days disappear.

For a real transcript, record 5 seconds of yourself on your phone, convert, and pass the file:
```bash
ffmpeg -i voice.m4a -ar 16000 -ac 1 -c:a pcm_s16le sample.wav
npx tsx scripts/test-ingest.ts ./sample.wav
```
Expect `status: "OPEN"` and your words back in `transcript`.

## A9. Deploy to Vercel  *(manual, ~10 min)*

1. Push the repo to GitHub (`.env` and `secrets.ini` are already gitignored — **verify** with
   `git status` before the first commit).
2. `vercel.com` → **Add New → Project** → import the repo.
3. **Root Directory: `Frontend`.** This is the step everyone misses; without it the build fails
   looking for `package.json` at the repo root.
4. Environment Variables → paste every line from your `.env`, one at a time, for
   **Production, Preview and Development**.
5. Change `CORS_ALLOWED_ORIGINS` and `NEXT_PUBLIC_APP_URL` to your real Vercel URL.
6. Deploy.

Then verify against the live URL and re-run A8 with `API_BASE_URL=https://your-app.vercel.app/api/v1`.

## A10. Keep the free tier awake  *(manual, ~2 min)*

Supabase pauses a free project after **7 days of zero activity**, and an unpaused project loses
nothing but takes a minute to wake — during which your device gets 5xx.

`uptimerobot.com` → free account → **New Monitor** → HTTP(s) → `https://your-app.vercel.app/api/health`
→ 5 minute interval. That's enough activity to keep it alive, and it emails you when the API dies.

---

# PART B — Firmware side

## B1. Install the toolchain  *(manual, ~10 min)*

1. Install **VS Code**.
2. Extensions → search **PlatformIO IDE** → install → let it download the toolchain (~5 min, one time).
3. Do **not** use the Arduino IDE. The build depends on `platformio.ini`, custom partitions, and the
   secrets injection script — none of which the Arduino IDE understands.

## B2. Open the project  *(manual, 1 min)*

Unzip the firmware, then **File → Open Folder → the `Firmware` directory** (the one containing
`platformio.ini`). Not the parent. PlatformIO detects the project by that file.

## B3. Fill in secrets  *(manual, 2 min)*

```bash
cp secrets.ini.example secrets.ini
```

```ini
[secrets]
wifi_ssid     = YourWiFi
wifi_password = YourPassword
device_id     = DEVICE_001
device_secret = <the 64-hex secret from A7>
api_base_url  = https://your-app.vercel.app/api/v1
```

**The ESP32 only joins 2.4 GHz networks.** If your router broadcasts one SSID for both bands and
prefers 5 GHz, the device will loop on connection failures forever. Make a 2.4 GHz-only guest SSID
if you have to.

For local testing use your machine's LAN IP, not `localhost` — `http://192.168.1.x:3000/api/v1`.
The device has no idea what your laptop's localhost is.

## B4. Wire it up  *(manual, ~10 min)*

| ESP32-S3 | → | Peripheral |
|---|---|---|
| GPIO4 | → | INMP441 `SD` |
| GPIO5 | → | INMP441 `SCK` |
| GPIO6 | → | INMP441 `WS` |
| 3V3 | → | INMP441 `VDD` |
| GND | → | INMP441 `GND` **and** `L/R` |
| GPIO17 | → | A9G `TX` *(their TX to our RX — crossed)* |
| GPIO18 | → | A9G `RX` |
| GND | → | A9G `GND` |

**Two things that will waste your afternoon if you get them wrong:**

1. **`L/R` on the mic must go to GND.** Floating gives intermittent silence that looks like a dead
   mic. Tied to GND puts data on the right channel, which is what the firmware's
   `I2S_CHANNEL_FMT_ONLY_RIGHT` expects.
2. **The A9G needs its own 5 V supply, plus a ground wire to the ESP32.** It draws ~2 A bursts on
   transmit. Powered from the DevKit's 3V3 or 5V pin, it browns out the S3 — which presents as
   random reboots mid-recording, and looks like a firmware bug for hours. Power it from its own USB
   or a 2 A adapter, and **tie GND to GND** or the UART reads garbage.

## B5. Flash it  *(manual, ~3 min)*

Plug USB into the port labelled **USB** (not **UART**) — that's the native CDC port.

```bash
pio run -e prototype -t upload
pio device monitor
```

If upload fails with *no serial data received*: hold **BOOT**, tap **RESET**, release **BOOT**, then
upload again. The S3 sometimes needs a manual bootloader entry on the first flash.

If the monitor shows nothing: on native USB the port disappears and re-enumerates after flashing.
Close the monitor, wait 3 seconds, reopen.

## B6. Bring it up in four stages  *(manual, ~15 min)*

**Test one subsystem at a time.** Each of these works independently — that's deliberate.

### Stage 1 — the microphone
Hold BOOT, speak normally, release. Then **hold BOOT for 3 seconds** to print diagnostics:
```
[I][main] long press — audio level 1840, outbox 0, heap 210000
```
- **A few hundred to a few thousand while speaking, near zero in silence** → mic is good.
- **Flat zero always** → dead INMP441, or `L/R` floating. You've hit this before: your first mic
  was dead out of the box and produced continuous zeros. Swap it before debugging anything else.
- **Constant high value even in silence** → wiring short, or `SCK`/`WS` swapped.

### Stage 2 — Wi-Fi
The LED settles to a **slow green breath** when connected. **Slow amber blink** means no network:
wrong password, or a 5 GHz-only SSID.

### Stage 3 — the A9G and GPS
Watch for `A9G up; GNSS streaming` in the log.
- `A9G not responding` → TX/RX not crossed, missing shared ground, or the module isn't powered.
- **Then take it outside.** A cold fix takes 30–90 seconds under open sky and will **never** happen
  indoors, near a window included. The 30-second status line shows `gps=NO_FIX sats=0` until it
  locks, then `gps=FIX_3D sats=9`.
- Complaints upload fine without a fix — they just carry `null` coordinates.

### Stage 4 — the full loop
Hold BOOT, say *"the freezer is not cooling"*, release.

```
[I][speech] complaint 6f1c0e0a-... — 2840 ms, gps FIX_3D, rssi -58
[I][api   ] uploading 486.3 KB (480.0 KB audio)
[I][api   ] HTTP 200 in 4210 ms
[I][api   ] transcript: "the freezer is not cooling"
[I][main  ] delivered: "the freezer is not cooling"
```
LED goes solid green for 2 seconds. Done.

## B7. Verify offline queueing  *(manual, 2 min)*

Worth doing once, because it's the feature most likely to be silently broken:

1. Turn off your router (or move out of range).
2. Record a complaint. LED double-blinks amber; log says `queued for retry`.
3. Power-cycle the ESP32. The complaint must still be there — `1 complaint(s) waiting in outbox`.
4. Turn Wi-Fi back on. Within ~15 seconds it uploads on its own, **with the original timestamp and
   GPS fix**, not the reconnection time.

---

# Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `HTTP 401 DEVICE_UNKNOWN` | `device_id` in `secrets.ini` doesn't match the DB | Re-run `register-device.ts`, copy both values |
| `HTTP 401 DEVICE_SIGNATURE_INVALID` | Wrong secret, or `DEVICE_SECRET_ENC_KEY` changed since registration | Re-register the device |
| `HTTP 401 DEVICE_TIMESTAMP_SKEW` | Device clock unsynced | Needs internet for SNTP at boot; check the log for `time synced` |
| `HTTP 401 DEVICE_NONCE_REPLAY` | Two requests reused a nonce | Only happens with a broken RNG — file a bug |
| `clock unsynced` before any upload | SNTP blocked | Some networks block UDP 123; try a phone hotspot |
| `status: STT_FAILED` | Gemini key wrong, or daily quota hit | Check server logs; add `GROQ_API_KEY` as fallback |
| `audio storage unavailable` | Bucket name mismatch, or wrong service key | Bucket must be `complaints`, key must be `service_role` |
| Reboots mid-recording | A9G brownout | Separate 5 V supply for the A9G |
| `no PSRAM detected` | Wrong memory type flag | `board_build.arduino.memory_type = qio_opi` — already set; confirm your module is **N16R8** |
| Transcript is gibberish | Mic gain | Adjust `AUDIO_GAIN_SHIFT` in `config.h`: lower = louder. Try 10 or 12. |
| Build fails: `secrets.ini not found` | Skipped B3 | `cp secrets.ini.example secrets.ini` |
| Vercel build fails, no `package.json` | Root directory not set | Set **Root Directory = `Frontend`** in Vercel project settings |

---

# Order of operations, condensed

```
A1 Supabase project     ──┐
A2 storage bucket         │
A3 connection strings     ├─► A6 npm install, .env, db push, seed
A4 Gemini key             │        │
A5 openssl keys         ──┘        ▼
                             A7 register device ──► 64-hex secret
                                   │                      │
                             A8 test-ingest (no HW)       │
                                   │                      │
                             A9 deploy to Vercel          │
                                   │                      │
                             A10 UptimeRobot              │
                                                          ▼
B1 PlatformIO ──► B2 open ──► B3 secrets.ini ◄────────────┘
                                   │
                             B4 wiring ──► B5 flash
                                   │
                             B6 stage 1 mic → 2 wifi → 3 gps → 4 full loop
                                   │
                             B7 offline queue test
```

**Do A8 before B4.** A verified backend turns hardware debugging from a two-variable problem into a
one-variable problem, and that is the single biggest time saver in this whole build.
