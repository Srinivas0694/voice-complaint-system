#pragma once
#include <Arduino.h>
#include "config.h"

// ───────────────────────── Logging ─────────────────────────
#ifndef LOG_LEVEL
#define LOG_LEVEL 3
#endif

void log_line(char level, const char* tag, const char* fmt, ...);

#if LOG_LEVEL >= 1
#define LOGE(tag, ...) log_line('E', tag, __VA_ARGS__)
#else
#define LOGE(tag, ...)
#endif
#if LOG_LEVEL >= 2
#define LOGW(tag, ...) log_line('W', tag, __VA_ARGS__)
#else
#define LOGW(tag, ...)
#endif
#if LOG_LEVEL >= 3
#define LOGI(tag, ...) log_line('I', tag, __VA_ARGS__)
#else
#define LOGI(tag, ...)
#endif
#if LOG_LEVEL >= 4
#define LOGD(tag, ...) log_line('D', tag, __VA_ARGS__)
#else
#define LOGD(tag, ...)
#endif

namespace utils {

void   init();

// Identity / crypto
String uuid4();                                    // hardware RNG
String sha256Hex(const uint8_t* data, size_t len);
String sha256Hex(const String& s);
String hmacSha256Hex(const String& key, const String& message);
String randomHex(size_t bytes);

// Time
bool   syncTime(uint32_t timeoutMs = 10000);       // SNTP
bool   timeIsValid();
String isoTimestamp();                             // RFC3339 UTC, "" if unsynced
uint32_t unixTime();

// Misc
String  humanBytes(size_t bytes);
uint32_t uptimeSeconds();
void    printHeapStats(const char* tag);

}  // namespace utils
