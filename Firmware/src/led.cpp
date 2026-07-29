#include "led.h"
#include "config.h"
#include "utils.h"

#if STATUS_LED_IS_RGB
#define FASTLED_INTERNAL
#include <FastLED.h>
static CRGB leds[1];
#endif

namespace led {

static Pattern  current   = Pattern::BOOTING;
static uint32_t enteredMs = 0;

// Paints the current pattern once, immediately. tick() animates over time, but
// set() also calls this so a pattern change is visible even when the main loop
// is about to block on a multi-second upload and won't call tick() again until
// it returns.
static void renderOnce();

void init() {
#if STATUS_LED_IS_RGB
    FastLED.addLeds<WS2812B, PIN_STATUS_LED, GRB>(leds, 1);
    FastLED.setBrightness(40);
    leds[0] = CRGB::Black;
    FastLED.show();
#else
    pinMode(PIN_STATUS_LED, OUTPUT);
    digitalWrite(PIN_STATUS_LED, LOW);
#endif
    enteredMs = millis();
}

void set(Pattern p) {
    if (p == current) return;
    current   = p;
    enteredMs = millis();
    renderOnce();   // don't wait for the next tick() — the loop may be blocking
}

#if STATUS_LED_IS_RGB
static void show(uint8_t r, uint8_t g, uint8_t b) { leds[0].setRGB(r, g, b); FastLED.show(); }
#else
static void show(uint8_t r, uint8_t g, uint8_t b) { digitalWrite(PIN_STATUS_LED, (r|g|b) ? HIGH : LOW); }
#endif

static void renderOnce() {
    uint32_t t   = millis() - enteredMs;
    uint8_t  sin = (uint8_t)((sinf(t / 500.0f) * 0.5f + 0.5f) * 255);

    switch (current) {
        case Pattern::BOOTING:    show(sin, sin, sin); break;
        case Pattern::IDLE:       show(0, sin / 6, 0); break;
        case Pattern::NO_NETWORK: show((t / 700) % 2 ? 60 : 0, (t / 700) % 2 ? 30 : 0, 0); break;
        case Pattern::RECORDING:  show(0, 0, 255); break;
        case Pattern::UPLOADING:  show(190, 0, 210); break;   // solid purple (loop blocks here, so no animation)
        case Pattern::SUCCESS:    show(0, 255, 0); if (t > 2000) set(Pattern::IDLE); break;
        case Pattern::QUEUED:     show(((t / 200) % 4 < 2) ? 255 : 0, ((t / 200) % 4 < 2) ? 140 : 0, 0);
                                  if (t > 2000) set(Pattern::IDLE); break;
        case Pattern::ERROR:      show(255, 0, 0); if (t > 3000) set(Pattern::IDLE); break;
    }
}

void tick() { renderOnce(); }

}  // namespace led