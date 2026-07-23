#pragma once
#include <Arduino.h>

namespace net {

void init();
void loop();              // reconnect state machine, called from netTask
bool isConnected();
int  rssi();
String ipAddress();
String macAddress();
uint32_t disconnectCount();

}  // namespace net
