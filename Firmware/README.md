# Firmware — ESP32-S3 Voice Complaint Device

Prototype target: **ESP32-S3-DevKitC-1 (N16R8)** + INMP441 + A9G, USB powered.

## Wiring

| Signal | ESP32-S3 | Peripheral |
|---|---|---|
| I2S SD | GPIO4 | INMP441 `SD` |
| I2S SCK | GPIO5 | INMP441 `SCK` |
| I2S WS | GPIO6 | INMP441 `WS` |
| — | 3V3 | INMP441 `VDD` |
| — | GND | INMP441 `GND` **and** `L/R` |
| UART1 RX | GPIO17 | A9G `TX` |
| UART1 TX | GPIO18 | A9G `RX` |
| PWRKEY | GPIO16 | A9G `PWRKEY` (optional) |
| — | **GND** | A9G `GND` ← **required** |
| Button | GPIO0 | onboard BOOT |
| LED | GPIO48 | onboard WS2812 |

> ### Power the A9G separately
> The A9G draws ~2 A bursts when the 2 G radio transmits. Powering it from the DevKit's
> 3V3 or 5V pin will brown out the S3 mid-recording and looks like random reboots.
> Give the A9G its own 5 V supply (its own USB, or a 2 A adapter) and **tie GND to GND**.
> That shared ground is not optional — without it, UART reads garbage.

`L/R` on the INMP441 goes to GND, which puts the data on the **left** slot, so the I2S config uses
`I2S_CHANNEL_FMT_ONLY_LEFT`.

> **If you are porting from a classic ESP32:** that chip needs `ONLY_RIGHT` for the identical
> wiring, because its I2S peripheral swaps the channels. The S3 follows the spec. Getting this
> wrong reads as a dead microphone — the SD line never toggles and every sample comes back 0 or 1,
> which looks exactly like a hardware fault.

The INMP441 also rides a large DC offset (idle samples sit near -30,000,000, not 0). `audio.cpp`
tracks it with a slow exponential mean and subtracts it before the gain shift; without that, every
sample clips after scaling and the transcript comes back as noise.

## Build

```bash
cp secrets.ini.example secrets.ini      # then fill in Wi-Fi + device credentials
pio run -e prototype -t upload
pio device monitor
```

Get `device_id` and `device_secret` from `POST /devices/register` on your backend. The secret is
shown once.

## Status LED

| Colour | Meaning |
|---|---|
| White pulse | booting |
| Green breath | idle, connected |
| Amber slow blink | idle, **no network** |
| Solid blue | recording |
| Cyan fast blink | uploading |
| Solid green 2 s | delivered and transcribed |
| Amber double-blink | queued offline, will retry |
| Solid red 3 s | rejected or failed |

## Module map

| File | Responsibility |
|---|---|
| `main.cpp` | FreeRTOS tasks, state machine, watchdog |
| `config.h` | every pin, timing and limit — the only file you edit for hardware changes |
| `audio.*` | I2S capture into PSRAM, WAV header generation |
| `speech.*` | complaint orchestration + durable offline outbox on LittleFS |
| `api.*` | HMAC request signing, multipart upload, heartbeat, config, OTA check |
| `gps.*` | A9G AT commands, NMEA parsing, signal strength — **compiled out by default** |
| `netlink.*` | Wi-Fi connection with exponential backoff (named `netlink`, **not** `wifi`, because a local `wifi.h` shadows the framework's `WiFi.h` on case-insensitive filesystems) |
| `button.*` | debounce and event queue |
| `json.*` | payload construction (ArduinoJson v7) |
| `led.*` | status patterns |
| `utils.*` | logging, UUIDv4, SHA-256/HMAC, SNTP time |

## Design notes

**There is no on-device speech recognition, by design.** An ESP32-S3 cannot run open-vocabulary
ASR, and edge STT would trade an accuracy collapse for bandwidth you don't need to save. The device
captures, contextualises, and ships; the server transcribes and classifies. The `speech` module is
named for what it *handles*, not what it *computes*.

**Audio lives in PSRAM.** 15 s at 16 kHz/16-bit mono is 480 KB out of an 8 MB pool. Flash is
touched only when an upload fails and the complaint must survive a reboot — that's what saves the
LittleFS partition from wearing out.

**The `.json` sidecar is the commit marker.** When spilling to the outbox, the WAV is written
first and the sidecar last. A `.wav` with no sidecar is a torn write from a power cut, and gets
reaped at boot. Nothing half-written ever gets uploaded.

**Retries preserve the original timestamp and fix.** When a queued complaint finally uploads, it
reports where and when it was *spoken*, not where and when it happened to reconnect.

**The `uuid` is the idempotency key.** Generated at record time, reused across every retry. If a
200 is lost on the wire, the server recognises the repeat and returns `duplicate: true`.

## Bench bringup order

1. **Mic alone.** Flash, open the monitor, hold BOOT and speak. Long-press (3 s) prints the RMS
   level — you want a few hundred to a few thousand while speaking, near zero in silence. A flat
   zero means the INMP441 is dead or `L/R` is floating.
2. **Wi-Fi.** LED should settle to a green breath. Amber means credentials or 2.4 GHz band.
3. **A9G.** Watch for `A9G up; GNSS streaming`. If it says *not responding*, check TX/RX crossover
   and the shared ground. Take it outside — a cold fix takes 30–90 s and will not happen indoors.
4. **Full loop.** Hold BOOT, speak, release. Watch for `HTTP 200` and the transcript echoing back
   in the log.

## Known prototype limitations

- `TLS_INSECURE=1` skips certificate validation. Fine on a bench, unacceptable in production —
  the `production` env pins the ISRG Root X1 CA instead.
- Boot count lives in a LittleFS file; production should use NVS.
- No deep sleep (USB powered by design).
- No battery telemetry — `battery_pct` is sent as `null` rather than a fabricated number.
- The upload assembles the full multipart body in PSRAM. At ~0.5 MB that's comfortable; if you
  raise `AUDIO_MAX_SECONDS` substantially, switch to a chunked writer.


## Location

`ENABLE_GPS` in `config.h` is **0**. The device sends no coordinates; the server
attaches the location provisioned against the device record at installation:

```
npx tsx scripts/register-device.ts DEVICE_001 "Kitchen freezer" FREEZER \
  --lat 17.4126 --lng 78.4482 --site "Banjara Hills"
```

An appliance monitor is glued to a freezer and never moves, so measuring its
position on every complaint answers a question whose answer never changes — and
an installer dropping a pin is more accurate than a GNSS receiver in a basement
kitchen, where a fix often never arrives at all. Complaints from a device with
no provisioned location simply carry null coordinates.

Set `ENABLE_GPS 1` to bring the A9G back for a mobile deployment. The driver is
unchanged; wire it per the table above and it works as before.
