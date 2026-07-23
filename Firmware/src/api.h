#pragma once
#include <Arduino.h>
#include "json.h"

namespace api {

struct UploadResult {
    bool   ok         = false;
    bool   duplicate  = false;
    bool   permanent  = false;   // 4xx: retrying will never help, drop it
    int    httpCode   = 0;
    String complaintId;
    String transcript;
    String status;
    String error;
};

void init();

// Streams meta + WAV as multipart/form-data straight out of PSRAM.
UploadResult uploadComplaint(const jsonx::ComplaintMeta& meta,
                             const uint8_t* pcm, size_t pcmLen);

bool sendHeartbeat();
bool fetchConfig(String& outJson);
bool checkOta(String& outVersion, String& outUrl, String& outSha256);

}  // namespace api
