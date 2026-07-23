#pragma once
#include <Arduino.h>

namespace button {

enum class Event : uint8_t { NONE, PRESSED, RELEASED, LONG_PRESS };

void  init();
void  poll();                 // called from appTask; non-blocking
Event nextEvent();            // drains one event, NONE when empty
bool  isHeld();
uint32_t heldMs();

}  // namespace button
