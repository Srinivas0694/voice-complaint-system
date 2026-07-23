#pragma once
#include <Arduino.h>

namespace gps {

enum class FixType : uint8_t { NONE = 0, FIX_2D = 2, FIX_3D = 3 };

struct Fix {
    bool     valid       = false;
    double   latitude    = 0;
    double   longitude   = 0;
    float    accuracyM   = 0;      // derived from HDOP
    uint8_t  satellites  = 0;
    FixType  type        = FixType::NONE;
    uint32_t fixedAtMs   = 0;      // millis() when acquired
    String   fixedAtIso;           // server-usable timestamp
};

bool  init();                      // brings up UART + A9G, enables GNSS
void  poll();                      // called from gpsTask; non-blocking NMEA pump
Fix   snapshot();                  // latest fix (may be stale — check fixedAtMs)
bool  hasFreshFix();
const char* statusString();        // FIX_3D | FIX_2D | NO_FIX | DISABLED

// A9G helpers
bool   sendAT(const char* cmd, const char* expect, uint32_t timeoutMs, String* response = nullptr);
int    signalStrengthDbm();        // via AT+CSQ, 99 -> unknown
bool   isAlive();

}  // namespace gps
