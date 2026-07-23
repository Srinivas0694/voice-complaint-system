# 02 — Hardware Design (ESP32-S3)

Module: **ESP32-S3-WROOM-1 N16R8** — 16 MB quad flash, 8 MB **octal** PSRAM.

## 1. Pin map

| Function | ESP32-S3 pin | Peripheral | Notes |
|---|---|---|---|
| I2S data in | GPIO4 | INMP441 `SD` | |
| I2S bit clock | GPIO5 | INMP441 `SCK` | |
| I2S word select | GPIO6 | INMP441 `WS` | |
| Mic channel select | — | INMP441 `L/R` → **GND** | Read on `ONLY_RIGHT`, same as your WROOM-32 bringup |
| A9G UART RX | GPIO17 (UART1 RX) | A9G `TX` | |
| A9G UART TX | GPIO18 (UART1 TX) | A9G `RX` | |
| A9G power key | GPIO16 | A9G `PWRKEY` | Pull low 2 s to toggle |
| A9G low-power | GPIO15 | A9G `LOWPWR` | Optional sleep control |
| Push button | GPIO7 | Button → GND | `INPUT_PULLUP`, active low. RTC-capable → EXT1 deep-sleep wake |
| Status LED (RGB) | GPIO48 | WS2812 `DIN` | Single addressable LED replaces 3 discrete LEDs + resistors |
| Buzzer | GPIO8 | Passive buzzer | LEDC channel 0, 2.7 kHz |
| Battery sense | GPIO1 | Divider midpoint | ADC1_CH0. **ADC2 is unusable while Wi-Fi is active** |
| USB D− / D+ | GPIO19 / GPIO20 | USB-C | Native CDC — no CP2102/CH340 in the BOM |

### Pins you must not use on this module

| Range | Reason |
|---|---|
| **GPIO26–32** | Quad SPI flash interface |
| **GPIO33–37** | **Octal PSRAM.** The `R8` variant uses all of them. This is the trap that catches everyone moving from a WROOM-32 — these pins are broken out on the module and look free. They are not. |
| GPIO0, 3, 45, 46 | Strapping pins |
| GPIO19, 20 | USB, unless you give up native USB |
| GPIO22–25 | Not bonded out on WROOM-1 |

Every pin used above is outside those ranges. GPIO7 is within the RTC domain (0–21), which is what
makes deep-sleep button wake work.

## 2. What the S3 buys you

| | WROOM-32 | S3-WROOM-1 N16R8 |
|---|---|---|
| Audio buffering | Must stream to LittleFS while recording | **480 KB WAV held in PSRAM**; flash written only when queueing an offline complaint |
| OTA slots | 1.5 MB each (tight) | 4 MB each (comfortable) |
| Outbox filesystem | ~0.9 MB (~2 queued complaints) | 4 MB (~8 queued complaints) |
| Wake word | Not viable | ESP-SR runs natively on the vector ISA — "Hey Khrana" as a button alternative |
| Programming/logs | Needs USB-UART bridge IC | Native USB CDC |
| Cost | ₹180 | ₹350 |

Flash writes were the WROOM-32 design's weak point: 15 s of audio was ~470 KB written to LittleFS
on **every single complaint**, and LittleFS wear-levels over a small partition. On the S3 the happy
path touches flash zero times.

## 3. Partition table (16 MB)

```csv
# Name,   Type, SubType, Offset,   Size
nvs,      data, nvs,     0x9000,   0x5000
otadata,  data, ota,     0xe000,   0x2000
app0,     app,  ota_0,   0x10000,  0x400000
app1,     app,  ota_1,   0x410000, 0x400000
nvs_keys, data, nvs_keys,0x810000, 0x1000
littlefs, data, spiffs,  0x811000, 0x400000
coredump, data, coredump,0xC11000, 0x10000
```

## 4. Power design

```
 Li-ion 18650 3.7 V 2600 mAh
   │
   ├─► TP4056 + DW01A protection ──► USB-C 5 V charge in (1 A)
   │
   ├─► BAT rail ──┬─► A9G VBAT (3.4–4.2 V direct, 2 A bursts)
   │              │     └─ 1000 µF low-ESR bulk + 100 nF within 10 mm of the module
   │              │
   │              └─► TPS63020 buck-boost ──► 3V3 / 1 A rail
   │                       ├─► ESP32-S3 (peaks ~350 mA on Wi-Fi TX — higher than the WROOM-32)
   │                       ├─► INMP441
   │                       └─► WS2812 / buzzer
   │
   └─► Divider 100 kΩ / 100 kΩ + 100 nF ──► GPIO1  (Vbat/2, max 2.1 V < 3.3 V ADC ref)
```

**The single most common failure on this class of board** is browning out the MCU when the 2 G
radio transmits. Run the A9G from the battery rail directly, never from the 3V3 regulator.

The S3 draws more than the WROOM-32 — budget a 1 A regulator, not 600 mA. Use a buck-**boost**
(TPS63020), not a plain buck: a depleted Li-ion sags to 3.2 V, below the 3.3 V a buck needs to
regulate, and the S3 browns out at exactly the moment the user is trying to file a complaint.

**Budget** (Wi-Fi, one complaint/day):
| State | Current | Duration/day |
|---|---|---|
| Deep sleep (EXT1 wake on GPIO7, PSRAM off) | 0.25 mA | 23 h 55 m |
| Idle + Wi-Fi connected | 95 mA | — |
| Recording (I2S + PSRAM) | 105 mA | 15 s |
| GNSS acquire | 45 mA | 30 s |
| Upload burst | 210 mA | 4 s |

→ ≈ 7 mAh/day in deep sleep → **~11 months per charge**. (Lower than the WROOM-32's 18 months —
S3 deep-sleep current is higher, and PSRAM self-refresh costs more. Still far past acceptable.)
Always-on Wi-Fi instead costs ~2.3 Ah/day → recharge daily. Ship deep sleep; expose always-on as a
remote config flag for mains-powered installs.

## 5. Bill of materials

| # | Part | Qty | Unit (₹) | Notes |
|---|---|---|---|---|
| 1 | ESP32-S3-WROOM-1 N16R8 | 1 | 350 | 16 MB flash / 8 MB PSRAM |
| 2 | INMP441 I2S MEMS mic | 1 | 130 | |
| 3 | A9G GSM+GNSS module | 1 | 750 | v2: SIM7670G (~₹1,500) |
| 4 | 18650 cell 2600 mAh | 1 | 180 | |
| 5 | 18650 holder | 1 | 25 | |
| 6 | TP4056 + DW01A | 1 | 35 | |
| 7 | TPS63020 buck-boost | 1 | 110 | Replaces MP1584; required for the S3's brownout margin |
| 8 | Tactile button 6×6 mm + cap | 1 | 8 | |
| 9 | WS2812B addressable LED | 1 | 9 | Replaces 3 LEDs + resistors |
| 10 | Passive buzzer 12 mm | 1 | 12 | |
| 11 | USB-C receptacle | 1 | 18 | Native USB — **no CP2102 needed, saves ₹60** |
| 12 | GSM antenna (IPEX) + GNSS ceramic patch | 2 | 160 | |
| 13 | Passives (1000 µF, 100 nF ×8, R/C) | ~25 | 60 | |
| 14 | 2-layer PCB 60×45 mm (JLCPCB, qty 5) | 1 | 90 | |
| 15 | Enclosure (3D printed PETG) | 1 | 70 | |
| | **Total per unit (prototype qty)** | | **≈ ₹2,007** | ~₹1,300 at 500 units |

Net change from the WROOM-32 build: **+₹238** (S3 module +₹170, buck-boost +₹65, USB bridge −₹60,
LED simplification −₹3, PSRAM removes nothing from the BOM but removes the flash-wear problem).

## 6. PCB guidance

- **4 layers is now worth it.** The S3's higher transient currents and the octal PSRAM's routing
  make a solid inner ground plane genuinely valuable. 2 layers still works if you keep the pour intact.
- Solid ground pour, **no split planes**.
- Keep the module's PCB-antenna keep-out clear of copper on all layers.
- Route I2S SCK/WS as a tight pair, away from the regulator switch node — a switching node coupling
  into the mic clock produces audible whine and Gemini will transcribe the whine.
- Minimise the regulator's input→switch→output loop area. That loop is your EMI antenna.
- USB D+/D− as a 90 Ω differential pair, length-matched, no stubs.
- Mic on the board edge with a 1 mm acoustic port through the enclosure, silicone gasket. A mic
  recessed behind a plastic cavity sounds terrible and every STT engine punishes you for it.
- 4× M2 mounting holes, 3 mm from corners.

## 7. Enclosure

- 70 × 55 × 25 mm two-part snap-fit, PETG or ABS. **Not PLA** — it deforms on a fridge compressor
  or near an AC outdoor unit.
- Silicone-sealed acoustic port, IP54 target.
- Neodymium magnet insert (10 × 3 mm) in the back plate, plus a 3M VHB pad for non-ferrous appliances.
- Light pipe from the WS2812 to the front face.
- Button cap protruding 1.5 mm, ~30 N actuation — must be findable by feel, in the dark, behind a fridge.
