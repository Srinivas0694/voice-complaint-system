# Entity Relationship Diagram

```mermaid
erDiagram
    USERS ||--o{ DEVICES : owns
    USERS ||--o{ REFRESH_TOKENS : holds
    USERS ||--o{ COMPLAINTS : "assigned to"
    USERS ||--o{ COMPLAINT_EVENTS : "acts on"
    DEVICES ||--o{ COMPLAINTS : reports
    DEVICES ||--o{ HEARTBEATS : emits
    COMPLAINTS ||--o{ COMPLAINT_EVENTS : "audit trail"

    USERS {
        uuid id PK
        text email UK
        text password_hash
        text full_name
        enum role "ADMIN|TECHNICIAN|VIEWER"
        bool is_active
        timestamptz last_login_at
    }

    REFRESH_TOKENS {
        uuid id PK
        uuid user_id FK
        text token_hash UK
        timestamptz expires_at
        timestamptz revoked_at
    }

    DEVICES {
        uuid id PK
        text device_id UK "DEVICE_001"
        text name
        enum appliance_type
        text secret_hash "argon2id, HMAC secret"
        enum status "PROVISIONED|ACTIVE|INACTIVE|REVOKED"
        text firmware_version
        text hardware_rev
        decimal latitude
        decimal longitude
        timestamptz last_seen_at
        int last_rssi
        int last_battery_pct
        uuid owner_id FK
    }

    HEARTBEATS {
        uuid id PK
        uuid device_id FK
        int rssi
        int battery_pct
        int uptime_sec
        int free_heap
        timestamptz created_at
    }

    COMPLAINTS {
        uuid id PK
        uuid uuid UK "device idempotency key"
        uuid device_id FK
        text audio_url
        int audio_duration_ms
        text transcript
        text language
        text stt_provider
        decimal stt_confidence
        enum appliance_type
        text fault_category
        enum severity "LOW|MEDIUM|HIGH|CRITICAL"
        enum status "PROCESSING|STT_FAILED|OPEN|IN_PROGRESS|RESOLVED|CLOSED"
        uuid assigned_to_id FK
        decimal latitude
        decimal longitude
        decimal gps_accuracy_m
        enum gps_status
        int satellites
        text firmware_version
        int rssi
        int battery_pct
        timestamptz recorded_at
        timestamptz received_at
        jsonb raw
    }

    COMPLAINT_EVENTS {
        uuid id PK
        uuid complaint_id FK
        text type
        text message
        jsonb metadata
        uuid actor_id FK
        timestamptz created_at
    }

    FIRMWARE_RELEASES {
        uuid id PK
        text version UK
        text binary_url
        text sha256
        int size_bytes
        bool is_mandatory
        int rollout_pct
    }
```

## Design notes

**Why `complaints.uuid` exists separately from `id`.** The device mints a UUID before it has any
network connection. That value is the idempotency key for retries. `id` is the server's own primary
key so the device can never influence internal identifiers.

**Why `raw jsonb` exists.** Firmware in the field runs versions you no longer control. When v1.4
starts sending a field the schema doesn't have, it lands in `raw` instead of being dropped. Costs
~400 bytes per row and has saved every IoT project I have worked on at least one incident.

**Why appliance type is on both tables.** `devices.appliance_type` is what was provisioned.
`complaints.appliance_type` is what the LLM heard. When they disagree, someone moved the device —
that discrepancy is a useful report.

**Geo queries.** For "complaints within 5 km", enable PostGIS and add a generated column:

```sql
ALTER TABLE complaints
  ADD COLUMN geom geography(Point,4326)
  GENERATED ALWAYS AS (
    CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL
    THEN ST_SetSRID(ST_MakePoint(longitude::float8, latitude::float8), 4326)::geography END
  ) STORED;
CREATE INDEX complaints_geom_idx ON complaints USING GIST (geom);
```

**Retention.** `heartbeats` grows fastest (one row per device per 5 min ≈ 288/device/day). Add a
partition by month or a 30-day cron delete; the dashboard only ever needs the rollup.
