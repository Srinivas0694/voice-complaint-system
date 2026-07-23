# VoiceComplaintSystem

Voice-Based Fault Reporting Device for Home Appliances — end-to-end IoT platform.
**MCU: ESP32-S3 · Server cost: ₹0/month**

Press and hold a button on a device stuck to your fridge, say *"the freezer is not cooling"*,
release. Six seconds later the complaint is transcribed, classified, geotagged, and sitting in a
SaaS dashboard.

---

## Locked architecture decisions

| Layer | Decision | Why |
|---|---|---|
| MCU | **ESP32-S3-WROOM-1 N16R8** (16 MB flash, 8 MB PSRAM) | PSRAM holds the whole recording in RAM; vector ISA runs ESP-SR wake-word on-device; native USB CDC |
| Microphone | INMP441 I2S MEMS | Digital, no analog noise floor |
| Audio | 16 kHz / 16-bit / mono WAV, 15 s cap (~480 KB) | Whisper/Gemini native rate. Buffered in PSRAM, mirrored to LittleFS only for the offline queue |
| Location | A9G GNSS over UART1 | GNSS is the part of the A9G that works well |
| Transport | Wi-Fi + HTTPS primary; A9G SMS metadata fallback | 2 G GPRS cannot move 480 KB in acceptable time |
| Telemetry | HTTPS heartbeat every 5 min (**no MQTT broker**) | Every free MQTT tier caps connections; HTTP costs nothing and Vercel already handles it |
| **STT + classification** | **Google Gemini Flash, free tier** — audio in, structured JSON out, one call | Native audio input means transcript + appliance + fault category + severity in a single request. No Whisper, no second LLM pass, no queue. Fallback: Groq `whisper-large-v3-turbo` free tier |
| Backend | **Next.js 15 Route Handlers on Vercel** — no separate API service | Gemini returns in 2–5 s, comfortably inside a 60 s serverless function. That deletes NestJS, Redis, BullMQ, and the worker |
| Database | **Supabase Postgres, free tier** (500 MB) | Postgres + object storage + auth in one free project, no credit card |
| Object store | **Supabase Storage, free tier** (1 GB ≈ 2,000 complaints) | Audio never goes in the database |
| Frontend | Next.js 15 App Router, TS, Tailwind, shadcn/ui, Framer Motion, Recharts, Leaflet | Premium SaaS feel; OSM needs no billing account |
| Device auth | Per-device secret + HMAC-SHA256 request signing | JWT rotation on a constrained device is misery |
| Human auth | JWT access (15 min) + rotating refresh token (30 d) | Standard, revocable |

**Total recurring cost: ₹0.** See `Documentation/04-free-tier-stack.md` for the exact limits, what
breaks first, and the commercial-use caveat on Vercel Hobby.

### What the ESP32-S3 changed
- 8 MB PSRAM → the full 15 s recording lives in RAM. Flash writes happen only when the upload
  fails and the complaint has to be queued. Fewer flash write cycles, faster upload path.
- 16 MB flash → dual 4 MB OTA slots + a 4 MB LittleFS outbox (vs. 1.5 MB slots on the WROOM-32).
- ESP-SR wake-word detection runs natively — "Hey Khrana" as an alternative to the button is now a
  firmware feature, not a hardware respin.
- Native USB CDC → provisioning and logs over a single USB-C, no CP2102 in the BOM.
- Different pin map. Notably **GPIO 33–37 are unusable** on N16R8 (octal PSRAM). See Hardware doc.

### Hardware v2 note
The A9G is 2 G-only and effectively EOL. The firmware's `Transport` interface exists so a
**SIM7670G** (4G Cat-1 bis + GNSS, proper TLS) is a board respin, not a rewrite.

---

## Repository layout

```
VoiceComplaintSystem/
├── Firmware/          PlatformIO project (ESP32-S3, FreeRTOS, OTA-ready)
├── Backend/           Next.js Route Handlers (lives inside Frontend/ — see note)
├── Frontend/          Next.js 15 dashboard + API
├── Database/          Prisma schema, SQL migrations, ER diagram
├── API Docs/          OpenAPI 3.1 spec + Postman collection
├── Documentation/     Architecture, free-tier stack, deployment, testing
├── Hardware/          Schematic, pin map, BOM, PCB and enclosure notes
└── README.md
```

> **Note:** on the free stack the backend is not a separate deployable. `Backend/` holds the
> domain logic (services, STT provider, HMAC, validators) as a package that `Frontend/app/api/*`
> imports. If you later move to a VPS, that package lifts into a standalone Nest/Fastify service
> with no rewrite.

## Delivery plan

- **Part 1 — foundation** *(revised, this part)*: architecture, S3 hardware design, database schema + ER, API contract, free-tier stack
- **Part 2 — firmware**: complete PlatformIO project for ESP32-S3
- **Part 3 — backend**: Route Handlers, Gemini STT provider, auth, HMAC, exports
- **Part 4 — frontend**: complete Next.js dashboard
- **Part 5 — ops**: deployment guide, testing guide, OpenAPI spec, diagrams
