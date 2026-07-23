/**
 * VoiceComplaintSystem — ESP32-S3 firmware
 *
 * Prototype hardware: ESP32-S3-DevKitC-1 (N16R8) + INMP441 + A9G, USB powered.
 *
 *   BOOT button held  → record
 *   released          → attach GNSS + network context, upload over HTTPS
 *   server            → transcribes and classifies, returns the text
 *
 * Task layout
 *   Core 0  audioTask   highest priority; dropping I2S samples is unrecoverable
 *   Core 1  appTask     state machine, button, LED
 *           uploadTask  outbox drain + heartbeat (blocking network calls live here)
 *           netTask     Wi-Fi reconnect backoff
 *           gpsTask     A9G NMEA pump (only when ENABLE_GPS=1)
 */
#include <Arduino.h>
#include <esp_task_wdt.h>

#include "config.h"
#include "utils.h"
#include "led.h"
#include "button.h"
#include "audio.h"
#include "gps.h"
#include "netlink.h"
#include "api.h"
#include "speech.h"

static const char* TAG = "main";

// ───────────────────────── state machine ─────────────────────────

enum class State : uint8_t { BOOTING, IDLE, RECORDING, PROCESSING, ERROR_HOLD };
static volatile State state = State::BOOTING;

static SemaphoreHandle_t captureMutex;
static volatile bool     uploadBusy = false;

static const char* stateName(State s) {
    switch (s) {
        case State::BOOTING:    return "BOOTING";
        case State::IDLE:       return "IDLE";
        case State::RECORDING:  return "RECORDING";
        case State::PROCESSING: return "PROCESSING";
        case State::ERROR_HOLD: return "ERROR_HOLD";
    }
    return "?";
}

static void transition(State next) {
    if (state == next) return;
    LOGI(TAG, "%s -> %s", stateName(state), stateName(next));
    state = next;
}

// ───────────────────────── tasks ─────────────────────────

static void audioTask(void*) {
    esp_task_wdt_add(nullptr);
    for (;;) {
        if (audio::isRecording()) {
            if (audio::pump() < 0) {
                LOGE(TAG, "I2S read error — aborting capture");
                audio::stopRecording();
            }
        } else {
            vTaskDelay(pdMS_TO_TICKS(20));
        }
        esp_task_wdt_reset();
        taskYIELD();
    }
}

#if ENABLE_GPS
static void gpsTask(void*) {
    esp_task_wdt_add(nullptr);
    for (;;) {
        gps::poll();
        esp_task_wdt_reset();
        vTaskDelay(pdMS_TO_TICKS(50));
    }
}
#endif

static void netTask(void*) {
    esp_task_wdt_add(nullptr);
    bool timeSynced = false;
    for (;;) {
        net::loop();
        if (net::isConnected() && !timeSynced) timeSynced = utils::syncTime(8000);
        if (!net::isConnected()) timeSynced = false;
        esp_task_wdt_reset();
        vTaskDelay(pdMS_TO_TICKS(500));
    }
}

static void uploadTask(void*) {
    esp_task_wdt_add(nullptr);
    uint32_t lastHeartbeat = 0;
    for (;;) {
        if (net::isConnected() && !uploadBusy && state != State::RECORDING) {
            speech::processOutbox();

            if (millis() - lastHeartbeat > HEARTBEAT_INTERVAL_MS || lastHeartbeat == 0) {
                if (api::sendHeartbeat()) lastHeartbeat = millis();
            }
        }
        esp_task_wdt_reset();
        vTaskDelay(pdMS_TO_TICKS(2000));
    }
}

static void handleRelease() {
    uploadBusy = true;
    transition(State::PROCESSING);
    led::set(led::Pattern::UPLOADING);

    String transcript;
    speech::Result r = speech::endCapture(transcript);

    switch (r) {
        case speech::Result::OK:
            LOGI(TAG, "delivered: \"%s\"", transcript.c_str());
            led::set(led::Pattern::SUCCESS);
            break;
        case speech::Result::QUEUED_OFFLINE:
            LOGW(TAG, "queued for retry (%u in outbox)", (unsigned)speech::outboxCount());
            led::set(led::Pattern::QUEUED);
            break;
        case speech::Result::TOO_SHORT:
            LOGI(TAG, "too short, ignored");
            led::set(led::Pattern::IDLE);
            break;
        case speech::Result::NO_AUDIO:
        case speech::Result::REJECTED:
        case speech::Result::FAILED:
        default:
            led::set(led::Pattern::ERROR);
            break;
    }

    uploadBusy = false;
    transition(State::IDLE);
}

static void appTask(void*) {
    esp_task_wdt_add(nullptr);
    uint32_t lastStats = 0;

    for (;;) {
        button::poll();
        led::tick();

        button::Event e;
        while ((e = button::nextEvent()) != button::Event::NONE) {
            switch (e) {
                case button::Event::PRESSED:
                    if (state == State::IDLE) {
                        if (speech::beginCapture()) {
                            transition(State::RECORDING);
                            led::set(led::Pattern::RECORDING);
                        }
                    } else {
                        LOGW(TAG, "button ignored in %s", stateName(state));
                    }
                    break;

                case button::Event::RELEASED:
                    if (state == State::RECORDING) handleRelease();
                    break;

                case button::Event::LONG_PRESS:
                    LOGI(TAG, "long press — level %u, raw[%ld..%ld], outbox %u, heap %u",
                         audio::lastLevel(),
                         (long)audio::rawMinSample(), (long)audio::rawMaxSample(),
                         (unsigned)speech::outboxCount(),
                         (unsigned)ESP.getFreeHeap());
                    break;

                default: break;
            }
        }

        // Hard cap: audioTask stops itself at AUDIO_MAX_SECONDS; close the complaint out.
        if (state == State::RECORDING && !audio::isRecording()) {
            LOGW(TAG, "hit the %d s recording cap", AUDIO_MAX_SECONDS);
            handleRelease();
        }

        // Idle LED reflects connectivity so a bench user can see the link state.
        if (state == State::IDLE) {
            led::set(net::isConnected() ? led::Pattern::IDLE : led::Pattern::NO_NETWORK);
        }

        if (millis() - lastStats > 30000) {
            lastStats = millis();
#if ENABLE_GPS
            LOGI(TAG, "state=%s wifi=%s rssi=%d gps=%s sats=%u outbox=%u up=%lus",
                 stateName(state), net::isConnected() ? "up" : "down", net::rssi(),
                 gps::statusString(), gps::snapshot().satellites,
                 (unsigned)speech::outboxCount(), (unsigned long)utils::uptimeSeconds());
#else
            LOGI(TAG, "state=%s wifi=%s rssi=%d outbox=%u up=%lus",
                 stateName(state), net::isConnected() ? "up" : "down", net::rssi(),
                 (unsigned)speech::outboxCount(), (unsigned long)utils::uptimeSeconds());
#endif
            utils::printHeapStats(TAG);
        }

        esp_task_wdt_reset();
        vTaskDelay(pdMS_TO_TICKS(BUTTON_POLL_MS));
    }
}

// ───────────────────────── setup ─────────────────────────

void setup() {
    Serial.begin(115200);
    uint32_t t0 = millis();
    while (!Serial && millis() - t0 < 2000) delay(10);   // native USB CDC needs a moment

    Serial.println();
    LOGI(TAG, "════════════════════════════════════════");
    LOGI(TAG, " VoiceComplaintSystem  fw %s  hw %s", FW_VERSION, HW_REVISION);
    LOGI(TAG, " device %s", DEVICE_ID);
    LOGI(TAG, " chip %s rev %d, %d MB flash, %s PSRAM",
         ESP.getChipModel(), ESP.getChipRevision(),
         ESP.getFlashChipSize() / (1024 * 1024),
         utils::humanBytes(ESP.getPsramSize()).c_str());
    LOGI(TAG, "════════════════════════════════════════");

    utils::init();
    led::init();
    led::set(led::Pattern::BOOTING);

    // ESP-IDF 4.4 (Arduino core 2.0.x) API. Returns INVALID_STATE if the core
    // already initialised it — harmless, our per-task subscribe still applies.
    esp_task_wdt_init(WDT_TIMEOUT_S, true);

    captureMutex = xSemaphoreCreateMutex();

    button::init();

    if (!audio::init())  { LOGE(TAG, "audio init failed — halting"); led::set(led::Pattern::ERROR); }
    if (!speech::init()) { LOGE(TAG, "storage init failed"); }

    net::init();
    api::init();

#if ENABLE_GPS
    // The A9G is slow to boot; a failure here is non-fatal — complaints still
    // upload, just without coordinates.
    if (!gps::init()) LOGW(TAG, "continuing without GNSS");
#else
    LOGI(TAG, "GNSS disabled — location comes from the device record");
#endif

    xTaskCreatePinnedToCore(audioTask,  "audio",  TASK_STACK_AUDIO,  nullptr, TASK_PRIO_AUDIO,  nullptr, CORE_AUDIO);
    xTaskCreatePinnedToCore(appTask,    "app",    TASK_STACK_APP,    nullptr, TASK_PRIO_APP,    nullptr, CORE_APP);
    xTaskCreatePinnedToCore(uploadTask, "upload", TASK_STACK_UPLOAD, nullptr, TASK_PRIO_UPLOAD, nullptr, CORE_APP);
    xTaskCreatePinnedToCore(netTask,    "net",    TASK_STACK_NET,    nullptr, TASK_PRIO_NET,    nullptr, CORE_APP);
#if ENABLE_GPS
    xTaskCreatePinnedToCore(gpsTask,    "gps",    TASK_STACK_GPS,    nullptr, TASK_PRIO_GPS,    nullptr, CORE_APP);
#endif

    transition(State::IDLE);
    LOGI(TAG, "ready — hold the BOOT button and speak");
}

void loop() {
    vTaskDelay(pdMS_TO_TICKS(1000));   // everything lives in tasks
}
