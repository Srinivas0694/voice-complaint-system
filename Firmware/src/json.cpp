#include "json.h"
#include "config.h"
#include "utils.h"
#include "netlink.h"
#include <ArduinoJson.h>

namespace jsonx {

String buildComplaintMeta(const ComplaintMeta& m) {
    JsonDocument doc;

    doc["uuid"]              = m.uuid;
    doc["device_id"]         = DEVICE_ID;
    doc["firmware"]          = FW_VERSION;
    doc["hardware"]          = HW_REVISION;
    doc["recorded_at"]       = m.recordedAt;
    doc["audio_duration_ms"] = m.audioDurationMs;
    doc["audio_bytes"]       = m.audioBytes;
    doc["audio_sha256"]      = m.audioSha256;

    JsonObject g = doc["gps"].to<JsonObject>();
    g["status"] = m.gpsStatus;
    if (m.fix.valid) {
        g["latitude"]   = serialized(String(m.fix.latitude, 7));
        g["longitude"]  = serialized(String(m.fix.longitude, 7));
        g["accuracy_m"] = serialized(String(m.fix.accuracyM, 2));
        g["satellites"] = m.fix.satellites;
        g["fixed_at"]   = m.fix.fixedAtIso;
    } else {
        g["latitude"]   = nullptr;
        g["longitude"]  = nullptr;
        g["accuracy_m"] = nullptr;
        g["satellites"] = 0;
    }

    JsonObject n = doc["network"].to<JsonObject>();
    n["type"] = "WIFI";
    n["rssi"] = m.rssi;
    n["ssid"] = WIFI_SSID;

    // No fuel gauge on the prototype — the server stores null rather than a fake number.
    doc["battery_pct"] = nullptr;
    doc["boot_count"]  = m.bootCount;

    String out;
    serializeJson(doc, out);
    return out;
}

String buildHeartbeat() {
    JsonDocument doc;
    doc["device_id"]  = DEVICE_ID;
    doc["rssi"]       = net::rssi();
    doc["battery_pct"]= nullptr;
    doc["uptime_sec"] = utils::uptimeSeconds();
    doc["free_heap"]  = ESP.getFreeHeap();
    doc["firmware"]   = FW_VERSION;

    String out;
    serializeJson(doc, out);
    return out;
}

String extractString(const String& body, const char* key) {
    JsonDocument doc;
    if (deserializeJson(doc, body) != DeserializationError::Ok) return String("");
    JsonVariant v = doc[key];
    if (v.isNull()) return String("");
    return v.as<String>();
}

}  // namespace jsonx
