#include "speech.h"
#include "config.h"
#include "utils.h"
#include "audio.h"
#include "gps.h"
#include "netlink.h"
#include "api.h"
#include <LittleFS.h>
#include <ArduinoJson.h>

static const char* TAG = "speech";

namespace speech {

static uint32_t bootCount = 0;
static const uint16_t retrySchedule[] = RETRY_SCHEDULE;
static const size_t retryCount = sizeof(retrySchedule) / sizeof(retrySchedule[0]);

// ─────────────────── outbox helpers ───────────────────

static String wavPath(const String& uuid)  { return String(OUTBOX_DIR) + "/" + uuid + ".wav"; }
static String metaPath(const String& uuid) { return String(OUTBOX_DIR) + "/" + uuid + ".json"; }

static size_t outboxBytes() {
    size_t total = 0;
    File dir = LittleFS.open(OUTBOX_DIR);
    if (!dir) return 0;
    File f;
    while ((f = dir.openNextFile())) { total += f.size(); f.close(); }
    dir.close();
    return total;
}

size_t outboxCount() {
    size_t n = 0;
    File dir = LittleFS.open(OUTBOX_DIR);
    if (!dir) return 0;
    File f;
    while ((f = dir.openNextFile())) {
        if (String(f.name()).endsWith(".json")) n++;
        f.close();
    }
    dir.close();
    return n;
}

static void dropOldest() {
    File dir = LittleFS.open(OUTBOX_DIR);
    if (!dir) return;
    String oldest;
    time_t oldestT = 0;
    File f;
    while ((f = dir.openNextFile())) {
        String name = f.name();
        if (name.endsWith(".json")) {
            time_t t = f.getLastWrite();
            if (oldest.isEmpty() || t < oldestT) { oldest = name; oldestT = t; }
        }
        f.close();
    }
    dir.close();
    if (oldest.isEmpty()) return;
    String uuid = oldest.substring(0, oldest.lastIndexOf('.'));
    if (uuid.startsWith("/")) uuid = uuid.substring(uuid.lastIndexOf('/') + 1);
    LittleFS.remove(metaPath(uuid));
    LittleFS.remove(wavPath(uuid));
    LOGW(TAG, "OUTBOX_OVERFLOW — dropped oldest complaint %s", uuid.c_str());
}

// Spill the in-PSRAM recording to flash so it survives a reboot.
static bool spillToOutbox(const jsonx::ComplaintMeta& meta,
                          const uint8_t* pcm, size_t pcmLen) {
    while (outboxCount() >= OUTBOX_MAX_ENTRIES || outboxBytes() > OUTBOX_MAX_BYTES) dropOldest();

    File wav = LittleFS.open(wavPath(meta.uuid), FILE_WRITE);
    if (!wav) { LOGE(TAG, "cannot open %s", wavPath(meta.uuid).c_str()); return false; }
    uint8_t hdr[audio::WAV_HEADER_SIZE];
    audio::wavHeader(hdr, pcmLen);
    wav.write(hdr, audio::WAV_HEADER_SIZE);

    size_t off = 0;
    while (off < pcmLen) {
        size_t chunk = min<size_t>(4096, pcmLen - off);
        if (wav.write(pcm + off, chunk) != chunk) {
            wav.close(); LittleFS.remove(wavPath(meta.uuid));
            LOGE(TAG, "flash write failed at %u", (unsigned)off);
            return false;
        }
        off += chunk;
    }
    wav.close();

    // The .json sidecar is written LAST and is the commit marker: a .wav with no
    // sidecar is a torn write from a power cut and gets reaped at boot.
    JsonDocument doc;
    doc["meta"]     = serialized(jsonx::buildComplaintMeta(meta));
    doc["attempts"] = 0;
    doc["nextAt"]   = 0;

    File js = LittleFS.open(metaPath(meta.uuid), FILE_WRITE);
    if (!js) { LittleFS.remove(wavPath(meta.uuid)); return false; }
    serializeJson(doc, js);
    js.close();

    LOGI(TAG, "queued offline: %s (%s)", meta.uuid.c_str(), utils::humanBytes(pcmLen).c_str());
    return true;
}

static void reapOrphans() {
    File dir = LittleFS.open(OUTBOX_DIR);
    if (!dir) return;
    File f;
    int reaped = 0;
    while ((f = dir.openNextFile())) {
        String name = f.name();
        f.close();
        if (!name.endsWith(".wav")) continue;
        String uuid = name.substring(0, name.lastIndexOf('.'));
        if (uuid.startsWith("/")) uuid = uuid.substring(uuid.lastIndexOf('/') + 1);
        if (!LittleFS.exists(metaPath(uuid))) {
            LittleFS.remove(wavPath(uuid));
            reaped++;
        }
    }
    dir.close();
    if (reaped) LOGW(TAG, "reaped %d torn recording(s) from a previous power loss", reaped);
}

// ─────────────────── lifecycle ───────────────────

bool init() {
    // The Arduino LittleFS wrapper defaults to a partition LABELLED "spiffs".
    // Our partitions.csv names it "littlefs", so it must be passed explicitly
    // or the mount silently fails and every outbox write errors at runtime.
    if (!LittleFS.begin(true, "/littlefs", 10, "littlefs")) {
        LOGE(TAG, "LittleFS mount failed — offline queue disabled");
        return false;
    }
    if (!LittleFS.exists(OUTBOX_DIR)) LittleFS.mkdir(OUTBOX_DIR);
    reapOrphans();

    // Crude boot counter in a file; NVS is the production home for this.
    File bc = LittleFS.open("/bootcount", "r");
    if (bc) { bootCount = bc.readString().toInt(); bc.close(); }
    bootCount++;
    bc = LittleFS.open("/bootcount", "w");
    if (bc) { bc.print(bootCount); bc.close(); }

    LOGI(TAG, "ready — boot #%lu, %u complaint(s) waiting in outbox",
         (unsigned long)bootCount, (unsigned)outboxCount());
    return true;
}

bool beginCapture() {
    if (!audio::startRecording()) { LOGW(TAG, "capture already running"); return false; }
    return true;
}

Result endCapture(String& transcriptOut) {
    audio::stopRecording();

    size_t   len = audio::pcmBytes();
    uint32_t ms  = audio::durationMs();

    if (len == 0)            { LOGW(TAG, "no audio captured"); audio::clear(); return Result::NO_AUDIO; }
    if (ms < AUDIO_MIN_MS)   { LOGI(TAG, "discarding %lu ms tap", (unsigned long)ms);
                               audio::clear(); return Result::TOO_SHORT; }

    jsonx::ComplaintMeta meta;
    meta.uuid            = utils::uuid4();
    meta.recordedAt      = utils::isoTimestamp();
    meta.audioDurationMs = ms;
    meta.audioBytes      = len + audio::WAV_HEADER_SIZE;
    meta.audioSha256     = utils::sha256Hex(audio::pcmData(), len);
    meta.fix             = gps::snapshot();
    meta.gpsStatus       = gps::statusString();
    meta.rssi            = net::rssi();
    meta.bootCount       = bootCount;

#if ENABLE_GPS
    LOGI(TAG, "complaint %s — %lu ms, gps %s, rssi %d",
         meta.uuid.c_str(), (unsigned long)ms, meta.gpsStatus.c_str(), meta.rssi);
#else
    LOGI(TAG, "complaint %s — %lu ms, rssi %d",
         meta.uuid.c_str(), (unsigned long)ms, meta.rssi);
#endif

    if (!net::isConnected()) {
        spillToOutbox(meta, audio::pcmData(), len);
        audio::clear();
        return Result::QUEUED_OFFLINE;
    }

    api::UploadResult res = api::uploadComplaint(meta, audio::pcmData(), len);

    if (res.ok) {
        transcriptOut = res.transcript;
        audio::clear();
        return Result::OK;
    }
    if (res.permanent) {
        LOGE(TAG, "server rejected complaint permanently: %s", res.error.c_str());
        audio::clear();
        return Result::REJECTED;
    }

    // Transient failure (5xx, timeout, dropped link) — persist and retry later.
    spillToOutbox(meta, audio::pcmData(), len);
    audio::clear();
    return Result::QUEUED_OFFLINE;
}

// ─────────────────── retry drain ───────────────────

void processOutbox() {
    if (!net::isConnected() || !utils::timeIsValid()) return;

    File dir = LittleFS.open(OUTBOX_DIR);
    if (!dir) return;

    File entry;
    while ((entry = dir.openNextFile())) {
        String name = entry.name();
        if (!name.endsWith(".json")) { entry.close(); continue; }

        String uuid = name.substring(0, name.lastIndexOf('.'));
        if (uuid.startsWith("/")) uuid = uuid.substring(uuid.lastIndexOf('/') + 1);

        JsonDocument doc;
        DeserializationError err = deserializeJson(doc, entry);
        entry.close();
        if (err) { LOGW(TAG, "corrupt sidecar %s, dropping", uuid.c_str());
                   LittleFS.remove(metaPath(uuid)); LittleFS.remove(wavPath(uuid)); continue; }

        uint32_t attempts = doc["attempts"] | 0;
        uint32_t nextAt   = doc["nextAt"]   | 0;
        if (utils::unixTime() < nextAt) continue;
        if (attempts >= RETRY_MAX_ATTEMPTS) continue;   // held, not dropped

        // Reload the audio from flash into PSRAM.
        File wav = LittleFS.open(wavPath(uuid), "r");
        if (!wav) { LittleFS.remove(metaPath(uuid)); continue; }
        size_t fileLen = wav.size();
        if (fileLen <= audio::WAV_HEADER_SIZE) { wav.close();
            LittleFS.remove(wavPath(uuid)); LittleFS.remove(metaPath(uuid)); continue; }

        size_t pcmLen = fileLen - audio::WAV_HEADER_SIZE;
        uint8_t* pcm = (uint8_t*)ps_malloc(pcmLen);
        if (!pcm) { wav.close(); LOGE(TAG, "no PSRAM to replay %s", uuid.c_str()); break; }
        wav.seek(audio::WAV_HEADER_SIZE);
        wav.read(pcm, pcmLen);
        wav.close();

        // Rehydrate the original metadata — location and timestamp must reflect
        // when the complaint was SPOKEN, not when it finally uploaded.
        jsonx::ComplaintMeta meta;
        JsonDocument m;
        deserializeJson(m, doc["meta"].as<String>());
        meta.uuid            = uuid;
        meta.recordedAt      = m["recorded_at"].as<String>();
        meta.audioDurationMs = m["audio_duration_ms"] | 0;
        meta.audioBytes      = fileLen;
        meta.audioSha256     = m["audio_sha256"].as<String>();
        meta.gpsStatus       = m["gps"]["status"].as<String>();
        meta.fix.valid       = !m["gps"]["latitude"].isNull();
        meta.fix.latitude    = m["gps"]["latitude"]   | 0.0;
        meta.fix.longitude   = m["gps"]["longitude"]  | 0.0;
        meta.fix.accuracyM   = m["gps"]["accuracy_m"] | 0.0f;
        meta.fix.satellites  = m["gps"]["satellites"] | 0;
        meta.fix.fixedAtIso  = m["gps"]["fixed_at"].as<String>();
        meta.rssi            = net::rssi();
        meta.bootCount       = m["boot_count"] | 0;

        LOGI(TAG, "retrying %s (attempt %lu)", uuid.c_str(), (unsigned long)attempts + 1);
        api::UploadResult res = api::uploadComplaint(meta, pcm, pcmLen);
        free(pcm);

        if (res.ok || res.duplicate || res.permanent) {
            LittleFS.remove(wavPath(uuid));
            LittleFS.remove(metaPath(uuid));
            LOGI(TAG, "%s %s", uuid.c_str(), res.ok ? "delivered" : "discarded (permanent)");
        } else {
            attempts++;
            uint32_t delay = retrySchedule[min(attempts, (uint32_t)retryCount) - 1];
            doc["attempts"] = attempts;
            doc["nextAt"]   = utils::unixTime() + delay;
            File js = LittleFS.open(metaPath(uuid), FILE_WRITE);
            if (js) { serializeJson(doc, js); js.close(); }
            LOGW(TAG, "%s failed, next attempt in %lus", uuid.c_str(), (unsigned long)delay);
        }
        break;   // one upload per pass — keeps the task responsive
    }
    dir.close();
}

}  // namespace speech
