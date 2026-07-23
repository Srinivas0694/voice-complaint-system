#include "netlink.h"
#include "config.h"
#include "utils.h"
#include <WiFi.h>

static const char* TAG = "wifi";

namespace net {

static uint32_t nextAttemptMs = 0;
static uint32_t backoffMs     = WIFI_RETRY_BASE_MS;
static uint32_t disconnects   = 0;
static bool     wasConnected  = false;

static void onEvent(WiFiEvent_t event) {
    switch (event) {
        case ARDUINO_EVENT_WIFI_STA_GOT_IP:
            LOGI(TAG, "connected: %s  rssi %d dBm", WiFi.localIP().toString().c_str(), WiFi.RSSI());
            backoffMs    = WIFI_RETRY_BASE_MS;
            wasConnected = true;
            break;
        case ARDUINO_EVENT_WIFI_STA_DISCONNECTED:
            if (wasConnected) { disconnects++; LOGW(TAG, "disconnected (#%lu)", (unsigned long)disconnects); }
            wasConnected = false;
            break;
        default: break;
    }
}

void init() {
    WiFi.onEvent(onEvent);
    WiFi.mode(WIFI_STA);
    WiFi.setSleep(false);            // sleep adds latency and drops packets during upload
    WiFi.setAutoReconnect(false);    // we drive reconnection ourselves, with backoff
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    LOGI(TAG, "connecting to \"%s\"...", WIFI_SSID);
    nextAttemptMs = millis() + WIFI_CONNECT_TIMEOUT_MS;
}

void loop() {
    if (WiFi.status() == WL_CONNECTED) return;
    if ((int32_t)(millis() - nextAttemptMs) < 0) return;

    LOGW(TAG, "reconnecting (backoff %lus)...", (unsigned long)(backoffMs / 1000));
    WiFi.disconnect(true);
    vTaskDelay(pdMS_TO_TICKS(100));
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    nextAttemptMs = millis() + backoffMs;
    backoffMs = min<uint32_t>(backoffMs * 2, WIFI_RETRY_MAX_MS);
}

bool     isConnected()     { return WiFi.status() == WL_CONNECTED; }
int      rssi()            { return isConnected() ? WiFi.RSSI() : 0; }
String   ipAddress()       { return isConnected() ? WiFi.localIP().toString() : String("0.0.0.0"); }
String   macAddress()      { return WiFi.macAddress(); }
uint32_t disconnectCount() { return disconnects; }

}  // namespace net
