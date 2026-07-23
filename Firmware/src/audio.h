#pragma once
#include <Arduino.h>

namespace audio {

// Recording buffer lives in PSRAM: 15 s @ 16 kHz/16-bit mono = 480 KB.
bool init();

bool   startRecording();      // false if already recording or buffer unavailable
void   stopRecording();
bool   isRecording();

// Called continuously by audioTask while recording. Returns bytes captured
// this iteration, or -1 on I2S error.
int    pump();

// Access the captured PCM (no WAV header).
const uint8_t* pcmData();
size_t         pcmBytes();
uint32_t       durationMs();
void           clear();

// Builds a 44-byte canonical WAV header for the captured PCM.
size_t         wavHeader(uint8_t* out44, size_t pcmLen);
static constexpr size_t WAV_HEADER_SIZE = 44;

// Diagnostics — RMS level of the last pumped block, 0..32767.
uint16_t lastLevel();

// Raw 32-bit I2S extremes from the last block. If both are 0 the bus is
// delivering literal zeros — dead mic or floating L/R, not a gain problem.
int32_t  rawMinSample();
int32_t  rawMaxSample();

}  // namespace audio
