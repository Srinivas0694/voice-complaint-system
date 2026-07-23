#pragma once
/**
 * config.h — single source of truth for pins, timings and limits.
 * Prototype hardware: ESP32-S3-DevKitC-1 (N16R8) + INMP441 + A9G, USB powered.
 */

// ───────────────────────── Identity ─────────────────────────
#ifndef FW_VERSION
#define FW_VERSION "1.0.0"
#endif
#ifndef HW_REVISION
#define HW_REVISION "VCS-S3-PROTO"
#endif
#ifndef DEVICE_ID
#define DEVICE_ID "DEVICE_001"
#endif
#ifndef DEVICE_SECRET
#define DEVICE_SECRET "changeme"
#endif

// ───────────────────────── Network ──────────────────────────
#ifndef WIFI_SSID
#define WIFI_SSID "your-ssid"
#endif
#ifndef WIFI_PASSWORD
#define WIFI_PASSWORD "your-password"
#endif
#ifndef API_BASE_URL
#define API_BASE_URL "https://example.vercel.app/api/v1"
#endif

#define WIFI_CONNECT_TIMEOUT_MS 20000
#define WIFI_RETRY_BASE_MS      2000
#define WIFI_RETRY_MAX_MS       60000

// STT runs synchronously server-side (Gemini, 2-5 s) — be generous.
#define HTTP_TIMEOUT_MS         25000
#define HEARTBEAT_INTERVAL_MS   300000UL   // 5 min

// ─────────────────── Pins: I2S microphone (INMP441) ──────────
// L/R pin tied to GND -> the board reads on the RIGHT channel.
#define PIN_I2S_SD   4
#define PIN_I2S_SCK  5
#define PIN_I2S_WS   6
#define I2S_PORT     I2S_NUM_0

// ─────────────────── GPS ────────────────────────────────────
// 0 = don't touch the A9G at all. Device location is provisioned against the
// device record at installation instead — an appliance monitor is glued to a
// freezer and never moves, and an installer dropping a pin beats a GNSS fix
// attempted indoors, where one often never arrives. Set to 1 to re-enable the
// A9G for a mobile deployment (see gps.cpp; the driver is unchanged).
#define ENABLE_GPS 0

// ─────────────────── Pins: A9G (GNSS + GSM) ─────────────────
#define PIN_A9G_RX      17    // ESP32 RX  <- A9G TX
#define PIN_A9G_TX      18    // ESP32 TX  -> A9G RX
#define PIN_A9G_PWRKEY  16    // optional; -1 to disable (dev board has its own button)
#define A9G_BAUD        115200
#define A9G_SERIAL      Serial1

// ─────────────────── Pins: UI ───────────────────────────────
// Prototype uses the DevKit's BOOT button. Fine on the bench; on a product
// board this moves to GPIO7 (holding GPIO0 at power-on enters the bootloader).
#define PIN_BUTTON      0
#define BUTTON_ACTIVE_LOW 1
#define PIN_STATUS_LED  48       // onboard WS2812 on DevKitC-1
#define STATUS_LED_IS_RGB 1

// Not populated on the prototype.
#define PIN_BUZZER      -1
#define PIN_BATTERY_ADC -1

// ─────────────────── Audio ──────────────────────────────────
#define AUDIO_SAMPLE_RATE     16000
#define AUDIO_BITS_PER_SAMPLE 16
#define AUDIO_CHANNELS        1
#define AUDIO_MAX_SECONDS     15
#define AUDIO_MIN_MS          400        // shorter than this = accidental tap, discard
#define AUDIO_MAX_BYTES       (AUDIO_SAMPLE_RATE * 2 * AUDIO_MAX_SECONDS)  // 480000
#define AUDIO_GAIN_SHIFT      11         // 32-bit I2S -> 16-bit PCM shift
#define AUDIO_DMA_BUF_COUNT   8
#define AUDIO_DMA_BUF_LEN     512

// ─────────────────── Button ─────────────────────────────────
#define BUTTON_DEBOUNCE_MS    50
#define BUTTON_POLL_MS        10

// ─────────────────── GPS ────────────────────────────────────
#define GPS_WARMUP_MS         2000
#define GPS_FIX_MAX_AGE_MS    120000UL   // a fix older than 2 min is reported as stale
#define GPS_POLL_INTERVAL_MS  5000

// ─────────────────── Outbox (offline queue) ─────────────────
#define OUTBOX_DIR            "/outbox"
#define OUTBOX_MAX_ENTRIES    8
#define OUTBOX_MAX_BYTES      (3500 * 1024)
// Retry ladder in seconds; index clamps at the end.
#define RETRY_SCHEDULE        {5, 15, 45, 120, 300, 900}
#define RETRY_MAX_ATTEMPTS    6

// ─────────────────── Watchdog ───────────────────────────────
#define WDT_TIMEOUT_S         15

// ─────────────────── Task config ────────────────────────────
#define TASK_STACK_APP     6144
#define TASK_STACK_AUDIO   4096
#define TASK_STACK_NET     8192
#define TASK_STACK_GPS     4096
#define TASK_STACK_UPLOAD  12288

#define TASK_PRIO_AUDIO    5   // highest: dropping I2S samples is unrecoverable
#define TASK_PRIO_APP      4
#define TASK_PRIO_UPLOAD   3
#define TASK_PRIO_NET      2
#define TASK_PRIO_GPS      2

#define CORE_AUDIO         0
#define CORE_APP           1
