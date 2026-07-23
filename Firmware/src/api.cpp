#include "api.h"
#include "config.h"
#include "utils.h"
#include "netlink.h"
#include "audio.h"
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

static const char* TAG = "api";

namespace api {

static const char* BOUNDARY = "----VCSb0undary7f3a91c2";

// ISRG Root X1 — Let's Encrypt, which is what Vercel and Supabase serve.
static const char* ROOT_CA_ISRG_X1 = R"CERT(
-----BEGIN CERTIFICATE-----
MIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2OCiwAwDQYJKoZIhvcNAQELBQAw
TzELMAkGA1UEBhMCVVMxKTAnBgNVBAoTIEludGVybmV0IFNlY3VyaXR5IFJlc2Vh
cmNoIEdyb3VwMRUwEwYDVQQDEwxJU1JHIFJvb3QgWDEwHhcNMTUwNjA0MTEwNDM4
WhcNMzUwNjA0MTEwNDM4WjBPMQswCQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJu
ZXQgU2VjdXJpdHkgUmVzZWFyY2ggR3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBY
MTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAK3oJHP0FDfzm54rVygc
h77ct984kIxuPOZXoHj3dcKi/vVqbvYATyjb3miGbESTtrFj/RQSa78f0uoxmyF+
0TM8ukj13Xnfs7j/EvEhmkvBioZxaUpmZmyPfjxwv60pIgbz5MDmgK7iS4+3mX6U
A5/TR5d8mUgjU+g4rk8Kb4Mu0UlXjIB0ttov0DiNewNwIRt18jA8+o+u3dpjq+sW
T8KOEUt+zwvo/7V3LvSye0rgTBIlDHCNAymg4VMk7BPZ7hm/ELNKjD+Jo2FR3qyH
B5T0Y3HsLuJvW5iB4YlcNHlsdu87kGJ55tukmi8mxdAQ4Q7e2RCOFvu396j3x+UC
B5iPNgiV5+I3lg02dZ77DnKxHZu8A/lJBdiB3QW0KtZB6awBdpUKD9jf1b0SHzUv
KBds0pjBqAlkd25HN7rOrFleaJ1/ctaJxQZBKT5ZPt0m9STJEadao0xAH0ahmbWn
OlFuhjuefXKnEgV4We0+UXgVCwOPjdAvBbI+e0ocS3MFEvzG6uBQE3xDk3SzynTn
jh8BCNAw1FtxNrQHusEwMFxIt4I7mKZ9YIqioymCzLq9gwQbooMDQaHWBfEbwrbw
qHyGO0aoSCqI3Haadr8faqU9GY/rOPNk3sgrDQoo//fb4hVC1CLQJ13hef4Y53CI
rU7m2Ys6xt0nUW7/vGT1M0NPAgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIBBjAPBgNV
HRMBAf8EBTADAQH/MB0GA1UdDgQWBBR5tFnme7bl5AFzgAiIyBpY9umbbjANBgkq
hkiG9w0BAQsFAAOCAgEAVR9YqbyyqFDQDLHYGmkgJykIrGF1XIpu+ILlaS/V9lZL
ubhzEFnTIZd+50xx+7LSYK05qAvqFyFWhfFQDlnrzuBZ6brJFe+GnY+EgPbk6ZGQ
3BebYhtF8GaV0nxvwuo77x/Py9auJ/GpsMiu/X1+mvoiBOv/2X/qkSsisRcOj/KK
NFtY2PwByVS5uCbMiogziUwthDyC3+6WVwW6LLv3xLfHTjuCvjHIInNzktHCgKQ5
ORAzI4JMPJ+GslWYHb4phowim57iaztXOoJwTdwJx4nLCgdNbOhdjsnvzqvHu7Ur
TkXWStAmzOVyyghqpZXjFaH3pO3JLF+l+/+sKAIuvtd7u+Nxe5AW0wdeRlN8NwdC
jNPElpzVmbUq4JUagEiuTDkHzsxHpFKVK7q4+63SM1N95R1NbdWhscdCb+ZAJzVc
oyi3B43njTOQ5yOf+1CceWxG1bQVs5ZufpsMljq4Ui0/1lvh+wjChP4kqKOJ2qxq
4RgqsahDYVvTH9w7jXbyLeiNdd8XM2w9U/t7y0Ff/9yi0GE44Za4rF2LN9d11TPA
mRGunUHBcnWEvgJBQl9nJEiU0Zsnvgc/ubhPgXRR4Xq37Z0j4r7g1SgEEzwxA57d
emyPxgcYxn/eR44/KJ4EBs+lVDR3veyJm+kXQ99b21/+jh5Xos1AnX5iItreGCc=
-----END CERTIFICATE-----
)CERT";

// Local bench servers are plain HTTP; production is HTTPS. Follow the scheme
// in API_BASE_URL rather than assuming TLS — a WiFiClientSecure pointed at
// port 3000 fails with "invalid SSL record", which reads like a server fault.
static bool useTls() {
    static const bool tls = String(API_BASE_URL).startsWith("https://");
    return tls;
}

// Holds both client types; get() hands back whichever the endpoint needs.
// WiFiClientSecure derives from WiFiClient, so the reference works either way.
struct Conn {
    WiFiClient       plain;
    WiFiClientSecure secure;
    WiFiClient& get();
};

void init() {
    LOGI(TAG, "endpoint: %s (%s)", API_BASE_URL, useTls() ? "TLS" : "plaintext");
#if TLS_INSECURE
    LOGW(TAG, "TLS certificate validation is DISABLED (prototype build)");
#endif
}

static void configureTls(WiFiClientSecure& client) {
#if TLS_INSECURE
    client.setInsecure();
#else
    client.setCACert(ROOT_CA_ISRG_X1);
#endif
    client.setTimeout(HTTP_TIMEOUT_MS / 1000);
}

// HMAC over the meta part only — the ESP32 cannot buffer a whole multipart
// body to hash it, and audio integrity is covered by audio_sha256 inside meta.
static void signRequest(HTTPClient& http, const String& body) {
    String ts    = String(utils::unixTime());
    String nonce = utils::randomHex(16);
    String message = String(DEVICE_ID) + "\n" + ts + "\n" + nonce + "\n" + utils::sha256Hex(body);
    String sig   = utils::hmacSha256Hex(DEVICE_SECRET, message);

    http.addHeader("X-Device-Id", DEVICE_ID);
    http.addHeader("X-Timestamp", ts);
    http.addHeader("X-Nonce", nonce);
    http.addHeader("X-Signature", sig);
}

WiFiClient& Conn::get() {
    if (!useTls()) return plain;
    configureTls(secure);
    return secure;
}

UploadResult uploadComplaint(const jsonx::ComplaintMeta& meta,
                             const uint8_t* pcm, size_t pcmLen) {
    UploadResult r;

    if (!net::isConnected()) { r.error = "offline"; return r; }
    if (!utils::timeIsValid()) { r.error = "clock unsynced"; return r; }

    String metaJson = jsonx::buildComplaintMeta(meta);

    // ── assemble the multipart envelope ──
    String head =
        "--" + String(BOUNDARY) + "\r\n"
        "Content-Disposition: form-data; name=\"meta\"\r\n"
        "Content-Type: application/json\r\n\r\n" + metaJson + "\r\n"
        "--" + String(BOUNDARY) + "\r\n"
        "Content-Disposition: form-data; name=\"audio\"; filename=\"" + meta.uuid + ".wav\"\r\n"
        "Content-Type: audio/wav\r\n\r\n";
    String tail = "\r\n--" + String(BOUNDARY) + "--\r\n";

    uint8_t wavHdr[audio::WAV_HEADER_SIZE];
    audio::wavHeader(wavHdr, pcmLen);

    size_t total = head.length() + audio::WAV_HEADER_SIZE + pcmLen + tail.length();
    LOGI(TAG, "uploading %s (%s audio)",
         utils::humanBytes(total).c_str(), utils::humanBytes(pcmLen).c_str());

    String url = String(API_BASE_URL) + "/ingest/complaints";
    uint32_t t0 = millis();

    // Assemble the whole body in PSRAM. At 480 KB + envelope this is ~0.5 MB of
    // an 8 MB pool, so a single contiguous buffer is simpler and faster than a
    // chunked writer, and it lets HTTPClient set Content-Length correctly.
    uint8_t* body = (uint8_t*)ps_malloc(total);
    if (!body) { r.error = "ps_malloc for body failed"; return r; }
    size_t off = 0;
    memcpy(body + off, head.c_str(), head.length());       off += head.length();
    memcpy(body + off, wavHdr, audio::WAV_HEADER_SIZE);    off += audio::WAV_HEADER_SIZE;
    memcpy(body + off, pcm, pcmLen);                       off += pcmLen;
    memcpy(body + off, tail.c_str(), tail.length());       off += tail.length();

    Conn conn;
    WiFiClient& client = conn.get();
    HTTPClient http;
    http.setTimeout(HTTP_TIMEOUT_MS);
    http.setReuse(false);
    if (!http.begin(client, url)) { free(body); r.error = "http.begin failed"; return r; }
    http.addHeader("Content-Type", String("multipart/form-data; boundary=") + BOUNDARY);
    signRequest(http, metaJson);

    r.httpCode = http.POST(body, total);
    free(body);

    uint32_t elapsed = millis() - t0;
    String response = (r.httpCode > 0) ? http.getString() : String("");
    http.end();

    LOGI(TAG, "HTTP %d in %lu ms", r.httpCode, (unsigned long)elapsed);

    if (r.httpCode <= 0) {
        r.error = http.errorToString(r.httpCode);
        return r;
    }
    if (r.httpCode >= 200 && r.httpCode < 300) {
        JsonDocument doc;
        if (deserializeJson(doc, response) == DeserializationError::Ok) {
            r.complaintId = doc["complaintId"] | "";
            r.transcript  = doc["transcript"]  | "";
            r.status      = doc["status"]      | "";
            r.duplicate   = doc["duplicate"]   | false;
        }
        r.ok = true;
        if (r.transcript.length()) LOGI(TAG, "transcript: \"%s\"", r.transcript.c_str());
        return r;
    }
    if (r.httpCode >= 400 && r.httpCode < 500) {
        r.permanent = true;      // bad signature, bad payload — retrying is pointless
        r.error = jsonx::extractString(response, "message");
        if (r.error.isEmpty()) r.error = response.substring(0, 120);
        LOGE(TAG, "rejected: %s", r.error.c_str());
        return r;
    }
    r.error = "server " + String(r.httpCode);
    return r;
}

bool sendHeartbeat() {
    if (!net::isConnected() || !utils::timeIsValid()) return false;

    String body = jsonx::buildHeartbeat();
    Conn conn;
    WiFiClient& client = conn.get();
    HTTPClient http;
    http.setTimeout(8000);
    if (!http.begin(client, String(API_BASE_URL) + "/ingest/heartbeat")) return false;
    http.addHeader("Content-Type", "application/json");
    signRequest(http, body);

    int code = http.POST(body);
    http.end();
    LOGD(TAG, "heartbeat -> %d", code);
    return code >= 200 && code < 300;
}

bool fetchConfig(String& outJson) {
    if (!net::isConnected()) return false;
    Conn conn;
    WiFiClient& client = conn.get();
    HTTPClient http;
    http.setTimeout(8000);
    if (!http.begin(client, String(API_BASE_URL) + "/ingest/config")) return false;
    signRequest(http, "");
    int code = http.GET();
    if (code == 200) outJson = http.getString();
    http.end();
    return code == 200;
}

bool checkOta(String& outVersion, String& outUrl, String& outSha256) {
    if (!net::isConnected()) return false;
    Conn conn;
    WiFiClient& client = conn.get();
    HTTPClient http;
    http.setTimeout(8000);
    String url = String(API_BASE_URL) + "/ingest/ota?current=" + FW_VERSION;
    if (!http.begin(client, url)) return false;
    signRequest(http, "");
    int code = http.GET();
    bool available = false;
    if (code == 200) {
        JsonDocument doc;
        if (deserializeJson(doc, http.getString()) == DeserializationError::Ok) {
            available   = doc["updateAvailable"] | false;
            outVersion  = doc["version"].as<String>();
            outUrl      = doc["url"].as<String>();
            outSha256   = doc["sha256"].as<String>();
        }
    }
    http.end();
    if (available) LOGI(TAG, "OTA available: %s", outVersion.c_str());
    return available;
}

}  // namespace api
