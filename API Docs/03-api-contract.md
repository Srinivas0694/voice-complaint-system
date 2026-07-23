# 03 — REST API Contract (v1)

Base URL: `https://api.voicecomplaint.app/api/v1`
All responses are JSON. All timestamps are RFC 3339 UTC.

## Error envelope

```json
{ "error": { "code": "DEVICE_SIGNATURE_INVALID", "message": "HMAC mismatch", "requestId": "01J..." } }
```

| HTTP | Codes |
|---|---|
| 400 | `VALIDATION_FAILED`, `AUDIO_TOO_LARGE`, `AUDIO_FORMAT_UNSUPPORTED` |
| 401 | `TOKEN_EXPIRED`, `TOKEN_INVALID`, `DEVICE_SIGNATURE_INVALID`, `DEVICE_TIMESTAMP_SKEW`, `DEVICE_NONCE_REPLAY` |
| 403 | `INSUFFICIENT_ROLE`, `DEVICE_REVOKED` |
| 404 | `NOT_FOUND` |
| 409 | `DEVICE_ID_TAKEN`, `EMAIL_TAKEN` |
| 413 | `PAYLOAD_TOO_LARGE` |
| 429 | `RATE_LIMITED` (with `Retry-After`) |
| 500 | `INTERNAL` |

---

## A. Auth (human)

### `POST /auth/login`
```json
→ { "email": "admin@uvkos.in", "password": "..." }
← 200 { "accessToken": "eyJ...", "refreshToken": "opaque...", "expiresIn": 900,
        "user": { "id": "...", "email": "...", "fullName": "...", "role": "ADMIN" } }
```

### `POST /auth/refresh`
```json
→ { "refreshToken": "opaque..." }
← 200 { "accessToken": "eyJ...", "refreshToken": "new-opaque...", "expiresIn": 900 }
```
Refresh tokens rotate on every use. Reuse of a consumed token revokes the entire family.

### `POST /auth/logout` · `GET /auth/me`

---

## B. Devices (JWT — ADMIN for writes)

### `POST /devices/register`
```json
→ { "deviceId": "DEVICE_001", "name": "Kitchen freezer — Banjara Hills",
    "applianceType": "FREEZER", "applianceBrand": "Blue Star",
    "siteName": "Khrana Cloud Kitchen", "siteAddress": "...",
    "latitude": 17.4324, "longitude": 78.2345, "ownerId": null }

← 201 { "id": "uuid", "deviceId": "DEVICE_001", "status": "PROVISIONED",
        "deviceSecret": "b7f3...64hex",     // shown ONCE, never retrievable
        "provisioningQr": "data:image/png;base64,..." }
```
The secret is hashed with argon2id before storage. Flash it into NVS during manufacturing; if it is
lost, call `POST /devices/{id}/rotate-secret`.

### `GET /devices`
Query: `page` `limit` `status` `applianceType` `q` `sortBy` `sortDir`
```json
← 200 { "data": [ { "id": "...", "deviceId": "DEVICE_001", "name": "...",
                    "applianceType": "FREEZER", "status": "ACTIVE",
                    "online": true, "lastSeenAt": "...", "lastRssi": -58,
                    "lastBatteryPct": 87, "firmwareVersion": "1.0.0",
                    "complaintCount": 12, "openComplaintCount": 2 } ],
        "meta": { "page": 1, "limit": 20, "total": 143, "totalPages": 8 } }
```
`online` is derived: `lastSeenAt > now() - 15 min`.

### `GET /devices/{id}` · `PUT /devices/{id}` · `DELETE /devices/{id}` · `POST /devices/{id}/rotate-secret` · `POST /devices/{id}/revoke`

### `GET /devices/{id}/heartbeats?from&to&bucket=1h`
Returns downsampled RSSI/battery series for the device detail charts.

---

## C. Ingest (device HMAC — no JWT)

### `POST /ingest/complaints`
`Content-Type: multipart/form-data`

| Part | Type | Notes |
|---|---|---|
| `meta` | `application/json` | see below |
| `audio` | `audio/wav` | 16 kHz / 16-bit / mono, ≤ 1 MB, ≤ 20 s |

```json
{
  "uuid": "6f1c0e0a-2c3d-4a5f-9b8e-1c2d3e4f5a6b",
  "device_id": "DEVICE_001",
  "firmware": "1.0.0",
  "hardware": "VCS-A9G-REV-A",
  "recorded_at": "2026-07-20T11:35:00Z",
  "audio_duration_ms": 8420,
  "gps": { "status": "FIX_3D", "latitude": 17.4324, "longitude": 78.2345,
           "accuracy_m": 4.5, "satellites": 9, "fixed_at": "2026-07-20T11:34:58Z" },
  "network": { "type": "WIFI", "rssi": -58, "ssid": "KHRANA-OPS" },
  "battery_pct": 87,
  "boot_count": 42
}
```

The HMAC body hash for a multipart request is computed over the **`meta` part bytes only** — the
ESP32 cannot buffer the whole multipart body to hash it, and the audio is integrity-checked by its
own `sha256` field carried inside `meta`.

```json
← 200 { "complaintId": "uuid", "uuid": "6f1c...", "status": "OPEN",
        "transcript": "the freezer is not cooling",
        "applianceType": "FREEZER", "faultCategory": "COOLING", "severity": "HIGH" }

← 200 { "complaintId": "uuid", "status": "STT_FAILED", "transcript": null }
        // audio stored, row created, transcription failed — device deletes locally, dashboard retries

← 200 { ... , "duplicate": true }     // same uuid seen before — safe to delete locally
```

Transcription is synchronous (Gemini Flash, 2–5 s). The device should use a **20 s socket timeout**
on this endpoint. Any 5xx or timeout goes into the firmware retry ladder — the `uuid` makes it
safe. `hardware` is now `"VCS-S3-REV-A"`.

### `POST /ingest/heartbeat`
```json
→ { "device_id": "DEVICE_001", "rssi": -58, "battery_pct": 87,
    "uptime_sec": 84213, "free_heap": 142000, "firmware": "1.0.0" }
← 204
```
This is the only heartbeat mechanism — there is no MQTT broker on the free stack. Device online
state is derived server-side from `last_seen_at > now() - 15 min`.

### `GET /ingest/config`
Returns remote configuration the device applies at boot:
```json
← 200 { "maxRecordSeconds": 15, "heartbeatIntervalSec": 300,
        "deepSleepEnabled": true, "uploadRetryScheduleSec": [5,15,45,120,300,900],
        "wakeWordEnabled": false, "logLevel": "INFO" }
```

### `GET /ingest/ota?current=1.0.0`
```json
← 200 { "updateAvailable": true, "version": "1.1.0",
        "url": "https://cdn.../firmware-1.1.0.bin", "sha256": "...",
        "sizeBytes": 1043216, "mandatory": false }
← 204   // no update for this device (staged rollout excluded it)
```

---

## D. Complaints (JWT)

### `GET /complaints`
Query: `page` `limit` `deviceId` `applianceType` `status` `severity` `faultCategory` `assignedTo`
`from` `to` `q` (full-text on transcript) `hasGps` `sortBy` `sortDir`

```json
← 200 { "data": [ { "id": "...", "uuid": "...",
                    "device": { "id": "...", "deviceId": "DEVICE_001", "name": "..." },
                    "applianceType": "FREEZER",
                    "transcript": "the freezer is not cooling",
                    "summary": "Freezer not maintaining temperature",
                    "faultCategory": "COOLING", "severity": "HIGH",
                    "status": "OPEN",
                    "location": { "latitude": 17.4324, "longitude": 78.2345,
                                  "accuracyM": 4.5, "status": "FIX_3D", "satellites": 9 },
                    "recordedAt": "...", "receivedAt": "..." } ],
        "meta": { "page": 1, "limit": 20, "total": 512, "totalPages": 26 } }
```

### `GET /complaints/{id}`
Adds `audioUrl` (presigned, 15 min TTL), `sttProvider`, `sttConfidence`, `language`,
`firmwareVersion`, `hardwareRev`, `rssi`, `batteryPct`, `raw`, and the full `events[]` timeline.

### `PATCH /complaints/{id}`
```json
→ { "status": "IN_PROGRESS", "assignedToId": "uuid", "severity": "CRITICAL",
    "resolutionNote": "Compressor relay replaced" }
← 200 { ...updated complaint }
```
Every mutation writes a `complaint_events` row.

### `POST /complaints/{id}/retry-stt` (ADMIN) · `DELETE /complaints/{id}` (ADMIN, soft delete)

### `GET /complaints/map?from&to&status`
Lightweight geo payload for the Leaflet layer — id, lat, lng, severity, applianceType only.

### `GET /complaints/export?format=csv|xlsx|pdf&<same filters>`
Streams the file. > 10 000 rows switches to an async job returning `{ "jobId" }` +
`GET /exports/{jobId}`.

---

## E. Dashboard

### `GET /dashboard/stats`
```json
← 200 { "totalDevices": 143, "onlineDevices": 128, "offlineDevices": 15,
        "complaintsToday": 22, "complaintsThisWeek": 141,
        "criticalOpen": 4, "avgResolutionHours": 18.6,
        "lastComplaint": { "id": "...", "deviceId": "DEVICE_007",
                           "transcript": "...", "receivedAt": "..." } }
```

### `GET /dashboard/timeseries?days=30&bucket=day`
### `GET /dashboard/breakdown?by=applianceType|faultCategory|severity|status`

---

## Rate limits

| Scope | Limit |
|---|---|
| `POST /auth/login` | 10 / 15 min / IP |
| `POST /ingest/*` | 30 / min / device |
| Gemini upstream (global) | ~15 / min — ingest sheds to the Groq fallback above this |
| `GET /*` authenticated | 600 / min / user |
| `GET /complaints/export` | 5 / hour / user |
