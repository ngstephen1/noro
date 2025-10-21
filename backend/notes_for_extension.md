# Noro AWS Backend — Handoff

**Base URL (dev)**  
`https://sb21puxxcd.execute-api.us-east-1.amazonaws.com/prod`

**Auth header (simple shared key, validated in Lambda)**  
`x-api-key: imcyLnEytbFl6gPXsQPYKQEL1gMSY15AV0hOsmeA`

**Endpoints**
- `GET /health` – sanity check + table name
- `POST /context` – send a session snapshot (tabs + optional screenshot)
- `GET /insights?user_id=<uuid>&limit=<N>` – latest N summaries

CORS: `*` • Throttle: burst **10**, rate **5 rps**

---

### Request Payloads We Accept

The backend accepts **either** the extension’s structure or a minimal canonical shape and normalizes internally.

### A) Extension shape (supported)
```json
{
  "sessionId": "session_1703123456789_abc123",
  "timestamp": 1703123456789,
  "interruptionType": "idle",
  "summary": {
    "totalWindows": 2,
    "totalTabs": 5,
    "screenshotCount": 3,
    "primaryWorkspace": "google-sheets"
  },
  "windows": [
    {
      "windowId": 123,
      "activeTabId": 456,
      "tabCount": 3,
      "tabs": [
        {
          "tabId": 456,
          "isActive": true,
          "url": "https://docs.google.com/spreadsheets/d/xyz",
          "title": "Q4 Sales Pipeline - Google Sheets",
          "type": "google-sheets",
          "timestamp": 1703123456789,
          "data": {
            "workbook": "Q4 Sales Pipeline",
            "activeSheet": "Pipeline",
            "selectedRange": "B5:D8"
          },
          "screenshot": {
            "data": "/9j/4AAQSkZJRgABAQEAAAAAAAD...",
            "format": "jpeg",
            "quality": 50,
            "size": 245
          }
        }
      ]
    }
  ],
  "userId": "dev-user"
}
### B)canonical shape
```json
{
  "correlation_id": "c-123",
  "user_id": "dev-user",
  "ts": "2025-10-19T19:00:00Z",
  "event": "manual_capture",
  "active_app": "chrome",
  "active_url_hash": "abcd1234",
  "tabs": [
    {
      "title": "Q4 Sales Pipeline - Google Sheets",
      "url": "https://docs.google.com/spreadsheets/d/xyz",
      "url_hash": "abcd1234",
      "text_sample": "selected B5:D8"
    }
  ],
  "screenshots": [
    { "mime": "image/jpeg", "dataBase64": "<base64>" }  // optional, up to 2
  ],
  "signals": { "idle_sec": 0 },
  "privacy": { "redacted": true }
}
```
#### Server-side processing (what happens)
•	Normalizes A → B.
•	Decodes up to 2 screenshots (in-memory); optional OCR via Textract (merged into text).
•	Clusters tabs into activities, prioritizes the active tab’s cluster, generates a short AI label, and suggests next actions.
•	Persists a session summary for /insights; also persists activity items for future use.

### Responses

### POST /context
```json
{
  "ok": true,
  "primary_activity_id": "c-fe814269",
  "activities": [
    {
      "activity_id": "c-fe814269",
      "label": "Q4 Sales Pipeline",
      "tab_count": 1,
      "is_active": true,
      "summary": "On \"Q4 Sales Pipeline - Google Sheets\".",
      "next_actions": [
        { "action": "open_tab", "target_url_hash": "", "label": "Reopen last tab" },
        { "action": "start_timer", "label": "Start 25-min focus timer", "duration_min": 25.0 }
      ],
      "confidence": 0.7,
      "tab_hashes": ["https://docs.google.com/spreadsheets/d/xyz"],
      "active_url_hash": "https://docs.google.com/spreadsheets/d/xyz",
      "rank": 0
    }
  ]
}
```

### GET /insights
```json
{
  "ok": true,
  "items": [
    {
      "ts": "2025-10-19T19:00:00Z",
      "summary": "On \"Project plan – Google Docs\". Working with: UAT duration update...",
      "next_actions": [
        { "action": "open_tab", "target_url_hash": "", "label": "Reopen last tab" },
        { "action": "start_timer", "label": "Start 25-min focus timer", "duration_min": 25 }
      ],
      "confidence": 0.7,
      "correlation_id": "c-727e7334"
    }
  ]
}

```

### Quick Verification (curl)
```bash
API_URL="https://sb21puxxcd.execute-api.us-east-1.amazonaws.com/prod"
API_KEY="<shared-key>"

# Health
curl -i -H "x-api-key: $API_KEY" "$API_URL/health"

# Context (extension JSON)
curl -s -H "x-api-key: $API_KEY" -H "content-type: application/json" \
  -d @teammate_payload.json "$API_URL/context" | jq .

# Insights
curl -s -H "x-api-key: $API_KEY" \
  "$API_URL/insights?user_id=dev-user&limit=5" | jq .
```

### AI Models & Config
•	BEDROCK_MODEL=anthropic.claude-4.5
•	Nova Pro
•	USE_BEDROCK=true
•	Region: BEDROCK_REGION=us-east-1
•	OCR (backup): USE_TEXTRACT=true to enable Textract on screenshots

### Auth, CORS, Rate Limiting
•	Auth: shared header x-api-key checked inside Lambdas.
•	CORS: AllowOrigins:*, methods GET, POST, OPTIONS.
•	Throttle: burst 10, rate 5 rps (HTTP API route settings).

### AWS Resources (dev env)

•	API Gateway HTTP API (v2): pia-http (API ID sb21puxxcd, stage prod)
•	Routes:
	•	GET /health → pia-health
	•	POST /context → pia-ingest-context
	•	GET /insights → pia-get-insights
•	DynamoDB: table pia-dev, keys PK, SK, TTL attr ttl
•	Lambdas: pia-health, pia-ingest-context, pia-get-insights


### DynamoDB Model (MVP)
```json
{
  "PK": "USER#<user_id>",
  "SK": "SESSION#<iso_ts>",
  "type": "session_summary",
  "user_id": "<user>",
  "ts": "<iso8601>",
  "correlation_id": "<id>",
  "summary_text": "...",
  "confidence": 0.7,
  "next_actions": [ ... ],
  "tab_hashes": [ ... ],
  "raw_excerpt": "...",
  "ttl": 1730000000
}
```

### Environment Variables (per Lambda)
API_KEY=<shared-key>
DDB_TABLE=pia-dev
USE_BEDROCK=true|false
BEDROCK_REGION=us-east-1
BEDROCK_MODEL=anthropic.claude-3-haiku-20240307-v1:0
USE_TEXTRACT=true|false


### Logs & Troubleshooting
```bash
aws logs tail /aws/lambda/pia-ingest-context --since 5m
aws logs tail /aws/lambda/pia-get-insights  --since 5m
aws logs tail /aws/lambda/pia-health        --since 5m
```

•	403 forbidden: missing/wrong x-api-key or Lambda API_KEY not set.
•	Decimal errors: we coerce floats to Decimal before DDB writes in current code.
•	Import errors: ensure backend/common/pia_common/*.py is packaged into each Lambda zip.