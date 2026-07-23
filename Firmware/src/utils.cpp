#include "utils.h"
#include <mbedtls/md.h>
#include <esp_random.h>
#include <esp_system.h>
#include <esp_timer.h>
#include <time.h>
#include <stdarg.h>

static const char* TAG = "utils";
static portMUX_TYPE logMux = portMUX_INITIALIZER_UNLOCKED;

void log_line(char level, const char* tag, const char* fmt, ...) {
    char body[256];
    va_list args;
    va_start(args, fmt);
    vsnprintf(body, sizeof(body), fmt, args);
    va_end(args);

    portENTER_CRITICAL(&logMux);
    Serial.printf("[%8lu][%c][%-8s] %s\n", (unsigned long)millis(), level, tag, body);
    portEXIT_CRITICAL(&logMux);
}

namespace utils {

static const char* HEX_CHARS = "0123456789abcdef";

void init() {
    // esp_random() is a true hardware RNG once RF is up; seed the PRNG too.
    randomSeed(esp_random());
}

String randomHex(size_t bytes) {
    String out;
    out.reserve(bytes * 2);
    for (size_t i = 0; i < bytes; i++) {
        uint8_t b = (uint8_t)(esp_random() & 0xFF);
        out += HEX_CHARS[b >> 4];
        out += HEX_CHARS[b & 0x0F];
    }
    return out;
}

String uuid4() {
    uint8_t b[16];
    for (int i = 0; i < 16; i++) b[i] = (uint8_t)(esp_random() & 0xFF);
    b[6] = (b[6] & 0x0F) | 0x40;   // version 4
    b[8] = (b[8] & 0x3F) | 0x80;   // variant 1
    char buf[37];
    snprintf(buf, sizeof(buf),
             "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",
             b[0],b[1],b[2],b[3], b[4],b[5], b[6],b[7], b[8],b[9],
             b[10],b[11],b[12],b[13],b[14],b[15]);
    return String(buf);
}

static String toHex(const uint8_t* d, size_t n) {
    String out;
    out.reserve(n * 2);
    for (size_t i = 0; i < n; i++) { out += HEX_CHARS[d[i] >> 4]; out += HEX_CHARS[d[i] & 0x0F]; }
    return out;
}

String sha256Hex(const uint8_t* data, size_t len) {
    uint8_t out[32];
    const mbedtls_md_info_t* info = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
    mbedtls_md_context_t ctx;
    mbedtls_md_init(&ctx);
    mbedtls_md_setup(&ctx, info, 0);
    mbedtls_md_starts(&ctx);
    mbedtls_md_update(&ctx, data, len);
    mbedtls_md_finish(&ctx, out);
    mbedtls_md_free(&ctx);
    return toHex(out, 32);
}

String sha256Hex(const String& s) {
    return sha256Hex((const uint8_t*)s.c_str(), s.length());
}

String hmacSha256Hex(const String& key, const String& message) {
    uint8_t out[32];
    const mbedtls_md_info_t* info = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
    mbedtls_md_context_t ctx;
    mbedtls_md_init(&ctx);
    mbedtls_md_setup(&ctx, info, 1);            // 1 = HMAC
    mbedtls_md_hmac_starts(&ctx, (const uint8_t*)key.c_str(), key.length());
    mbedtls_md_hmac_update(&ctx, (const uint8_t*)message.c_str(), message.length());
    mbedtls_md_hmac_finish(&ctx, out);
    mbedtls_md_free(&ctx);
    return toHex(out, 32);
}

bool syncTime(uint32_t timeoutMs) {
    configTime(0, 0, "pool.ntp.org", "time.google.com");
    uint32_t start = millis();
    while (millis() - start < timeoutMs) {
        if (timeIsValid()) {
            LOGI(TAG, "time synced: %s", isoTimestamp().c_str());
            return true;
        }
        vTaskDelay(pdMS_TO_TICKS(250));
    }
    LOGW(TAG, "SNTP sync timed out");
    return false;
}

bool timeIsValid() {
    time_t now = time(nullptr);
    return now > 1735689600;   // 2025-01-01, i.e. clearly not the epoch default
}

uint32_t unixTime() { return (uint32_t)time(nullptr); }

String isoTimestamp() {
    if (!timeIsValid()) return String("");
    time_t now = time(nullptr);
    struct tm tmv;
    gmtime_r(&now, &tmv);
    char buf[32];
    strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &tmv);
    return String(buf);
}

String humanBytes(size_t bytes) {
    char buf[24];
    if (bytes >= 1024 * 1024) snprintf(buf, sizeof(buf), "%.2f MB", bytes / 1048576.0);
    else if (bytes >= 1024)   snprintf(buf, sizeof(buf), "%.1f KB", bytes / 1024.0);
    else                      snprintf(buf, sizeof(buf), "%u B", (unsigned)bytes);
    return String(buf);
}

uint32_t uptimeSeconds() { return (uint32_t)(esp_timer_get_time() / 1000000ULL); }

void printHeapStats(const char* tag) {
    LOGI(tag, "heap: %s free / psram: %s free",
         humanBytes(ESP.getFreeHeap()).c_str(),
         humanBytes(ESP.getFreePsram()).c_str());
}

}  // namespace utils
