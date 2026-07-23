#include "button.h"
#include "config.h"
#include "utils.h"

static const char* TAG = "button";

namespace button {

static bool     stableState   = false;   // true = pressed
static bool     lastRaw       = false;
static uint32_t lastChangeMs  = 0;
static uint32_t pressStartMs  = 0;
static bool     longFired     = false;

static Event    queue[8];
static uint8_t  qHead = 0, qTail = 0;

static void push(Event e) {
    uint8_t next = (uint8_t)((qTail + 1) % 8);
    if (next == qHead) { LOGW(TAG, "event queue full, dropping"); return; }
    queue[qTail] = e;
    qTail = next;
}

static inline bool readRaw() {
    int v = digitalRead(PIN_BUTTON);
#if BUTTON_ACTIVE_LOW
    return v == LOW;
#else
    return v == HIGH;
#endif
}

void init() {
#if BUTTON_ACTIVE_LOW
    pinMode(PIN_BUTTON, INPUT_PULLUP);
#else
    pinMode(PIN_BUTTON, INPUT_PULLDOWN);
#endif
    lastRaw = stableState = readRaw();
    lastChangeMs = millis();
    LOGI(TAG, "ready on GPIO%d (%s)", PIN_BUTTON, BUTTON_ACTIVE_LOW ? "active low" : "active high");
}

void poll() {
    bool raw = readRaw();
    uint32_t now = millis();

    if (raw != lastRaw) { lastRaw = raw; lastChangeMs = now; return; }
    if (now - lastChangeMs < BUTTON_DEBOUNCE_MS) return;
    if (raw == stableState) {
        // still held — check for the long-press threshold
        if (stableState && !longFired && (now - pressStartMs) >= 3000) {
            longFired = true;
            push(Event::LONG_PRESS);
        }
        return;
    }

    stableState = raw;
    if (stableState) {
        pressStartMs = now;
        longFired = false;
        push(Event::PRESSED);
        LOGD(TAG, "pressed");
    } else {
        push(Event::RELEASED);
        LOGD(TAG, "released after %lums", (unsigned long)(now - pressStartMs));
    }
}

Event nextEvent() {
    if (qHead == qTail) return Event::NONE;
    Event e = queue[qHead];
    qHead = (uint8_t)((qHead + 1) % 8);
    return e;
}

bool isHeld() { return stableState; }
uint32_t heldMs() { return stableState ? (millis() - pressStartMs) : 0; }

}  // namespace button
