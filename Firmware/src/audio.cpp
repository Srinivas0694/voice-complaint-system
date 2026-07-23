#include "audio.h"
#include "config.h"
#include "utils.h"
#include <driver/i2s.h>

static const char* TAG = "audio";

namespace audio {

static uint8_t*  buffer      = nullptr;   // PSRAM
static size_t    written     = 0;
static bool      recording   = false;
static bool      ready       = false;
static uint32_t  startMs     = 0;
static uint16_t  levelRms    = 0;
static int32_t   rawMin      = 0;   // diagnostics: raw 32-bit I2S extremes
static int32_t   rawMax      = 0;
// The INMP441 carries a large DC offset (idle sits around -30e6, not 0).
// Left in, it clips every sample after the gain shift. Tracked with a slow
// exponential mean and subtracted before scaling.
static int64_t   dcEstimate  = 0;
static bool      dcPrimed    = false;
static int32_t*  rawBlock    = nullptr;   // 32-bit I2S scratch, internal RAM

static constexpr size_t RAW_SAMPLES = AUDIO_DMA_BUF_LEN;

bool init() {
    if (ready) return true;

    if (!psramFound()) {
        LOGE(TAG, "no PSRAM detected — check board_build.arduino.memory_type=qio_opi");
        return false;
    }

    buffer = (uint8_t*)ps_malloc(AUDIO_MAX_BYTES);
    if (!buffer) { LOGE(TAG, "ps_malloc(%d) failed", AUDIO_MAX_BYTES); return false; }

    rawBlock = (int32_t*)malloc(RAW_SAMPLES * sizeof(int32_t));
    if (!rawBlock) { LOGE(TAG, "raw block alloc failed"); return false; }

    i2s_config_t cfg = {};
    cfg.mode                 = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX);
    cfg.sample_rate          = AUDIO_SAMPLE_RATE;
    cfg.bits_per_sample      = I2S_BITS_PER_SAMPLE_32BIT;   // INMP441 always clocks 32 bits
    // L/R tied to GND -> the INMP441 transmits on the LEFT slot. (The classic
    // ESP32 needed ONLY_RIGHT for the same wiring because of a channel-swap
    // quirk in its I2S peripheral; the S3 follows the spec.)
    cfg.channel_format       = I2S_CHANNEL_FMT_ONLY_LEFT;
    cfg.communication_format = I2S_COMM_FORMAT_STAND_I2S;
    cfg.intr_alloc_flags     = ESP_INTR_FLAG_LEVEL1;
    cfg.dma_buf_count        = AUDIO_DMA_BUF_COUNT;
    cfg.dma_buf_len          = AUDIO_DMA_BUF_LEN;
    cfg.use_apll             = false;
    cfg.tx_desc_auto_clear   = false;
    cfg.fixed_mclk           = 0;

    i2s_pin_config_t pins = {};
    pins.bck_io_num   = PIN_I2S_SCK;
    pins.ws_io_num    = PIN_I2S_WS;
    pins.data_out_num = I2S_PIN_NO_CHANGE;
    pins.data_in_num  = PIN_I2S_SD;
    pins.mck_io_num   = I2S_PIN_NO_CHANGE;

    esp_err_t err = i2s_driver_install(I2S_PORT, &cfg, 0, nullptr);
    if (err != ESP_OK) { LOGE(TAG, "i2s_driver_install: %s", esp_err_to_name(err)); return false; }
    err = i2s_set_pin(I2S_PORT, &pins);
    if (err != ESP_OK) { LOGE(TAG, "i2s_set_pin: %s", esp_err_to_name(err)); return false; }

    i2s_stop(I2S_PORT);   // stay quiet until a recording starts
    ready = true;
    LOGI(TAG, "I2S ready — SD=%d SCK=%d WS=%d, %d Hz, buffer %s in PSRAM",
         PIN_I2S_SD, PIN_I2S_SCK, PIN_I2S_WS, AUDIO_SAMPLE_RATE,
         utils::humanBytes(AUDIO_MAX_BYTES).c_str());
    return true;
}

bool startRecording() {
    if (!ready || recording) return false;
    written   = 0;
    levelRms  = 0;
    dcPrimed  = false;
    startMs   = millis();
    i2s_start(I2S_PORT);
    i2s_zero_dma_buffer(I2S_PORT);
    recording = true;
    LOGI(TAG, "recording started");
    return true;
}

void stopRecording() {
    if (!recording) return;
    recording = false;
    i2s_stop(I2S_PORT);
    LOGI(TAG, "recording stopped: %s, %lu ms",
         utils::humanBytes(written).c_str(), (unsigned long)durationMs());
}

bool isRecording() { return recording; }

int pump() {
    if (!recording) return 0;

    if (written >= AUDIO_MAX_BYTES) {
        LOGW(TAG, "buffer full at %d s cap", AUDIO_MAX_SECONDS);
        stopRecording();
        return 0;
    }

    size_t bytesRead = 0;
    esp_err_t err = i2s_read(I2S_PORT, rawBlock, RAW_SAMPLES * sizeof(int32_t),
                             &bytesRead, pdMS_TO_TICKS(100));
    if (err != ESP_OK) { LOGE(TAG, "i2s_read: %s", esp_err_to_name(err)); return -1; }

    size_t samples = bytesRead / sizeof(int32_t);
    int16_t* out   = (int16_t*)(buffer + written);
    size_t   room  = (AUDIO_MAX_BYTES - written) / sizeof(int16_t);
    if (samples > room) samples = room;

    uint64_t sumSq = 0;
    rawMin = INT32_MAX; rawMax = INT32_MIN;
    for (size_t i = 0; i < samples; i++) {
        if (rawBlock[i] < rawMin) rawMin = rawBlock[i];
        if (rawBlock[i] > rawMax) rawMax = rawBlock[i];
        // INMP441 delivers 24 bits left-aligned in a 32-bit slot, riding on a
        // large DC offset. Track the offset, subtract it, then scale.
        int32_t raw = rawBlock[i];
        if (!dcPrimed) { dcEstimate = raw; dcPrimed = true; }
        dcEstimate += ((int64_t)raw - dcEstimate) >> 10;   // ~10 Hz corner @16 kHz

        int32_t s = (int32_t)(((int64_t)raw - dcEstimate) >> AUDIO_GAIN_SHIFT);
        if (s >  32767) s =  32767;
        if (s < -32768) s = -32768;
        out[i] = (int16_t)s;
        sumSq += (uint64_t)((int32_t)out[i] * (int32_t)out[i]);
    }
    if (samples) levelRms = (uint16_t)sqrt((double)(sumSq / samples));

    written += samples * sizeof(int16_t);
    return (int)(samples * sizeof(int16_t));
}

const uint8_t* pcmData() { return buffer; }
size_t         pcmBytes() { return written; }
uint16_t       lastLevel() { return levelRms; }
int32_t        rawMinSample() { return rawMin; }
int32_t        rawMaxSample() { return rawMax; }

uint32_t durationMs() {
    return (uint32_t)((uint64_t)written * 1000ULL /
                      (AUDIO_SAMPLE_RATE * (AUDIO_BITS_PER_SAMPLE / 8) * AUDIO_CHANNELS));
}

void clear() { written = 0; }

size_t wavHeader(uint8_t* h, size_t pcmLen) {
    const uint32_t byteRate   = AUDIO_SAMPLE_RATE * AUDIO_CHANNELS * (AUDIO_BITS_PER_SAMPLE / 8);
    const uint16_t blockAlign = AUDIO_CHANNELS * (AUDIO_BITS_PER_SAMPLE / 8);
    const uint32_t chunkSize  = 36 + (uint32_t)pcmLen;

    memcpy(h + 0,  "RIFF", 4);
    memcpy(h + 4,  &chunkSize, 4);
    memcpy(h + 8,  "WAVEfmt ", 8);
    uint32_t sub1 = 16;      memcpy(h + 16, &sub1, 4);
    uint16_t fmt  = 1;       memcpy(h + 20, &fmt, 2);      // PCM
    uint16_t ch   = AUDIO_CHANNELS;      memcpy(h + 22, &ch, 2);
    uint32_t sr   = AUDIO_SAMPLE_RATE;   memcpy(h + 24, &sr, 4);
    memcpy(h + 28, &byteRate, 4);
    memcpy(h + 32, &blockAlign, 2);
    uint16_t bps  = AUDIO_BITS_PER_SAMPLE; memcpy(h + 34, &bps, 2);
    memcpy(h + 36, "data", 4);
    uint32_t dlen = (uint32_t)pcmLen;    memcpy(h + 40, &dlen, 4);
    return WAV_HEADER_SIZE;
}

}  // namespace audio
