#include "gps.h"
#include "config.h"
#include "utils.h"

static const char* TAG = "gps";

namespace gps {

static Fix     current;
static bool    enabled     = false;
static String  lineBuf;
static uint32_t lastCsqMs  = 0;
static int     lastCsqDbm  = 0;

// ─────────────────── A9G AT plumbing ───────────────────

bool sendAT(const char* cmd, const char* expect, uint32_t timeoutMs, String* response) {
    while (A9G_SERIAL.available()) A9G_SERIAL.read();   // flush stale bytes
    LOGD(TAG, ">> %s", cmd);
    A9G_SERIAL.print(cmd);
    A9G_SERIAL.print("\r\n");

    String acc;
    uint32_t start = millis();
    while (millis() - start < timeoutMs) {
        while (A9G_SERIAL.available()) {
            char c = (char)A9G_SERIAL.read();
            acc += c;
            if (acc.length() > 1024) acc.remove(0, 512);
        }
        if (acc.indexOf(expect) >= 0) {
            if (response) *response = acc;
            LOGD(TAG, "<< ok");
            return true;
        }
        if (acc.indexOf("ERROR") >= 0) {
            if (response) *response = acc;
            LOGW(TAG, "<< ERROR for %s", cmd);
            return false;
        }
        vTaskDelay(pdMS_TO_TICKS(10));
    }
    if (response) *response = acc;
    LOGW(TAG, "<< timeout for %s", cmd);
    return false;
}

bool isAlive() { return sendAT("AT", "OK", 1000); }

int signalStrengthDbm() {
    if (millis() - lastCsqMs < 10000) return lastCsqDbm;
    String resp;
    if (!sendAT("AT+CSQ", "+CSQ", 2000, &resp)) return 0;
    int idx = resp.indexOf("+CSQ:");
    if (idx < 0) return 0;
    int rssi = resp.substring(idx + 5).toInt();     // 0..31, 99 = unknown
    lastCsqDbm = (rssi == 99 || rssi == 0) ? 0 : (-113 + 2 * rssi);
    lastCsqMs  = millis();
    return lastCsqDbm;
}

// ─────────────────── NMEA parsing ───────────────────

static double nmeaToDegrees(const String& raw, char hemi) {
    if (raw.length() < 3) return 0;
    int dotIdx = raw.indexOf('.');
    if (dotIdx < 2) return 0;
    int degDigits = dotIdx - 2;
    double deg = raw.substring(0, degDigits).toDouble();
    double min = raw.substring(degDigits).toDouble();
    double val = deg + min / 60.0;
    if (hemi == 'S' || hemi == 'W') val = -val;
    return val;
}

static String field(const String& sentence, int index) {
    int start = 0, count = 0;
    for (int i = 0; i <= (int)sentence.length(); i++) {
        if (i == (int)sentence.length() || sentence[i] == ',') {
            if (count == index) return sentence.substring(start, i);
            count++;
            start = i + 1;
        }
    }
    return String("");
}

// $--GGA,time,lat,N,lon,E,quality,sats,hdop,alt,...
static void parseGGA(const String& s) {
    int quality = field(s, 6).toInt();
    if (quality == 0) {
        current.valid = false;
        current.type  = FixType::NONE;
        return;
    }
    String latRaw = field(s, 2), lonRaw = field(s, 4);
    if (latRaw.isEmpty() || lonRaw.isEmpty()) return;

    current.latitude   = nmeaToDegrees(latRaw, field(s, 3).charAt(0));
    current.longitude  = nmeaToDegrees(lonRaw, field(s, 5).charAt(0));
    current.satellites = (uint8_t)field(s, 7).toInt();

    float hdop = field(s, 8).toFloat();
    // Rule of thumb: accuracy ≈ HDOP × the receiver's UERE (~4 m for this class of module).
    current.accuracyM  = (hdop > 0) ? hdop * 4.0f : 0.0f;
    current.type       = (current.satellites >= 4) ? FixType::FIX_3D : FixType::FIX_2D;
    current.valid      = true;
    current.fixedAtMs  = millis();
    current.fixedAtIso = utils::isoTimestamp();
}

static void handleLine(String line) {
    line.trim();
    if (line.length() < 6 || line[0] != '$') return;
    if (line.indexOf("GGA") == 3) {
        parseGGA(line);
        LOGD(TAG, "fix=%d sats=%u lat=%.6f lon=%.6f acc=%.1fm",
             (int)current.valid, current.satellites,
             current.latitude, current.longitude, current.accuracyM);
    }
}

// ─────────────────── lifecycle ───────────────────

bool init() {
    A9G_SERIAL.begin(A9G_BAUD, SERIAL_8N1, PIN_A9G_RX, PIN_A9G_TX);
    lineBuf.reserve(128);

#if PIN_A9G_PWRKEY >= 0
    pinMode(PIN_A9G_PWRKEY, OUTPUT);
    digitalWrite(PIN_A9G_PWRKEY, HIGH);
#endif

    LOGI(TAG, "probing A9G on UART1 (RX=%d TX=%d @%d)", PIN_A9G_RX, PIN_A9G_TX, A9G_BAUD);

    bool alive = false;
    for (int attempt = 0; attempt < 5 && !alive; attempt++) {
        alive = isAlive();
        if (!alive) vTaskDelay(pdMS_TO_TICKS(1000));
    }
    if (!alive) {
        LOGE(TAG, "A9G not responding — check TX/RX crossover, baud, and that it has its OWN 5V supply with common ground");
        enabled = false;
        return false;
    }

    sendAT("ATE0", "OK", 2000);            // stop echoing our own commands back
    sendAT("AT+GPS=1", "OK", 5000);        // power the GNSS receiver
    sendAT("AT+GPSRD=1", "OK", 3000);      // stream NMEA once per second

    enabled = true;
    LOGI(TAG, "A9G up; GNSS streaming. Cold fix outdoors typically 30-90 s.");
    return true;
}

void poll() {
    if (!enabled) return;
    while (A9G_SERIAL.available()) {
        char c = (char)A9G_SERIAL.read();
        if (c == '\n') { handleLine(lineBuf); lineBuf = ""; }
        else if (c != '\r') {
            lineBuf += c;
            if (lineBuf.length() > 120) lineBuf = "";   // runaway guard
        }
    }
    if (current.valid && (millis() - current.fixedAtMs) > GPS_FIX_MAX_AGE_MS) {
        LOGW(TAG, "fix went stale");
        current.valid = false;
        current.type  = FixType::NONE;
    }
}

Fix  snapshot()     { return current; }
bool hasFreshFix()  { return current.valid && (millis() - current.fixedAtMs) <= GPS_FIX_MAX_AGE_MS; }

const char* statusString() {
    if (!enabled) return "DISABLED";
    if (!hasFreshFix()) return "NO_FIX";
    return current.type == FixType::FIX_3D ? "FIX_3D" : "FIX_2D";
}

}  // namespace gps
