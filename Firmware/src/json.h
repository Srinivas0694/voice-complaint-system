#pragma once
#include <Arduino.h>
#include "gps.h"

namespace jsonx {

struct ComplaintMeta {
    String   uuid;
    String   recordedAt;      // ISO8601 UTC
    uint32_t audioDurationMs = 0;
    size_t   audioBytes      = 0;
    String   audioSha256;
    gps::Fix fix;
    String   gpsStatus;
    int      rssi            = 0;
    uint32_t bootCount       = 0;
};

String buildComplaintMeta(const ComplaintMeta& m);
String buildHeartbeat();

// Extracts a top-level string field from a server response without
// allocating a full document — used for compact error paths.
String extractString(const String& body, const char* key);

}  // namespace jsonx
