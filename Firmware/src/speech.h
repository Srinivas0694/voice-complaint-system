#pragma once
#include <Arduino.h>
#include "json.h"

/**
 * speech — orchestrates one complaint end to end.
 *
 * There is no on-device speech recognition: an ESP32-S3 cannot run
 * open-vocabulary ASR, and it doesn't need to. This module captures the
 * utterance, attaches the GNSS and network context, ships it to the server
 * (which transcribes and classifies it), and owns the durable retry queue for
 * when the network isn't there.
 */
namespace speech {

enum class Result : uint8_t { OK, TOO_SHORT, NO_AUDIO, QUEUED_OFFLINE, REJECTED, FAILED };

bool init();

// Called when the button goes down / comes up.
bool beginCapture();
Result endCapture(String& transcriptOut);

// Drains the offline outbox; called periodically from uploadTask.
void   processOutbox();
size_t outboxCount();

}  // namespace speech
