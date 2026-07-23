#pragma once
#include <Arduino.h>

namespace led {

enum class Pattern : uint8_t {
    BOOTING,        // white pulse
    IDLE,           // dim green breath
    NO_NETWORK,     // slow amber blink
    RECORDING,      // solid blue
    UPLOADING,      // fast cyan blink
    SUCCESS,        // solid green 2 s
    QUEUED,         // amber double-blink
    ERROR           // solid red 3 s
};

void init();
void set(Pattern p);
void tick();          // called ~every 20 ms from appTask

}  // namespace led
