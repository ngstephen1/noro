# Noro: The Productivity Intelligence Agent

> **Noro** senses your work, analyzes context with **Claude 4.5 Sonnet** (Bedrock), and returns focused insights via **API Gateway + Lambda + DynamoDB**. Analytics with **Amazon Nova Pro**.

## Created by Team Get Noro Right Now
Mohamed Ghoul (Developer) - [GitHub](https://www.github.com/mohamedghoul), [Linkedin](https://www.linkedin.com/in/mohamedghoul)  
Stephen Nguyen (Developer) - [GitHub](https://github.com/ngstephen1), [Linkedin](https://www.linkedin.com/in/nguyenpn1)  
Thuy Trang Cao (Designer) - [GitHub](https://github.com/trngc), [Linkedin](https://www.linkedin.com/in/thuytrangcao)  

## Tech stacks

	•	AI/LLM: Amazon Bedrock — Claude 4.5 Sonnet (primary), Nova Pro (analytics)
	•	Compute: AWS Lambda (Python 3.11)
	•	API: Amazon API Gateway (HTTP API) with CORS & x-api-key auth
	•	Data: Amazon DynamoDB (single-table design)
	•	Security/Ops: AWS WAF v2 (rate limiting), CloudWatch (logs/metrics), IAM (least-privilege)
	•	Client: Chrome Extension (MV3) → posts snapshots to backend

⚙️ Quick Setup

```bash
export AWS_PROFILE=noro-dev
export AWS_REGION=us-east-1
export API_ID=<your_http_api_id>    
export API_URL=“https://${API_ID}.execute-api.${AWS_REGION}.amazonaws.com/prod”

Use the SAME value set in Lambda env API_KEY

export PIA_API_KEY=<paste_value_from_lambda_env>
```

Lambda env (ingest):

```
DDB_TABLE=pia-dev
USE_BEDROCK=true
BEDROCK_REGION=us-east-1
BEDROCK_MODEL=<Claude_4_5_Sonnet_modelId>
USE_TEXTRACT=true                 # optional OCR
API_KEY=<same_as_above>
ANALYTICS_MODEL=<Nova_Pro_modelId>  # optional/future
```

⸻

🧭 Endpoints
	•	GET  /health — readiness & DynamoDB check
	•	POST /context — ingest a snapshot (tabs + optional screenshots)
	•	GET  /insights?user_id=…&limit=N — recent summaries

Auth: send header x-api-key: $PIA_API_KEY
CORS: * enabled

⸻

✅ Smoke Tests

1) Health

```bash
curl -sS -H “x-api-key: $PIA_API_KEY” “$API_URL/health” | jq .
```

2) Minimal context (tabs only)

```bash
cat >/tmp/context.json <<‘JSON’
{
“correlation_id”:“c-demo-1”,
“user_id”:“dev-user”,
“ts”:“2025-10-21T12:00:00Z”,
“event”:“manual_capture”,
“active_app”:“chrome”,
“active_url_hash”:“abcd1234”,
“tabs”:[
{“title”:“Project plan – Google Docs”,“url_hash”:“abcd1234”,“text_sample”:“UAT duration update…”},
{“title”:“Venues – Yelp”,“url_hash”:“yelp:1”,“text_sample”:“capacity ~120; downtown”}
],
“signals”:{“idle_sec”:0},
“privacy”:{“redacted”:true}
}
JSON

curl -sS -H “x-api-key: $PIA_API_KEY” -H “content-type: application/json” 
–data-binary @/tmp/context.json “$API_URL/context” | jq .
```

3) Teammate payload (windows/tabs/screens)

```bash
cat >/tmp/teammate_payload.json <<‘JSON’
{
“sessionId”: “session_1703123456789_abc123”,
“timestamp”: 1703123456789,
“interruptionType”: “idle”,
“summary”: {
“totalWindows”: 1,
“totalTabs”: 1,
“screenshotCount”: 1,
“primaryWorkspace”: “google-sheets”
},
“windows”: [{
“windowId”: 123,
“activeTabId”: 456,
“tabCount”: 1,
“tabs”: [{
“tabId”: 456,
“isActive”: true,
“url”: “https://docs.google.com/spreadsheets/d/xyz”,
“title”: “Q4 Sales Pipeline - Google Sheets”,
“type”: “google-sheets”,
“timestamp”: 1703123456789,
“data”: {“workbook”:“Q4 Sales Pipeline”,“activeSheet”:“Pipeline”,“selectedRange”:“B5:D8”},
“screenshot”: {“data”: “/9j/4AAQSkZJRgABAQEAAAAAAAD…”, “format”:“jpeg”, “quality”:50, “size”:245}
}]
}]
}
JSON

curl -sS -H “x-api-key: $PIA_API_KEY” -H “content-type: application/json” 
–data-binary @/tmp/teammate_payload.json “$API_URL/context” | jq .
```

4) Fetch insights

```
curl -sS -H “x-api-key: $PIA_API_KEY” 
“$API_URL/insights?user_id=dev-user&limit=5” | jq .
```

⸻

🧪 Product Math (LaTeX in Markdown)

Inline: \text{focus\_score} = \alpha \cdot \text{intent} + \beta \cdot \text{progress}

Block:

$$
\text{focus_score} = \alpha,\text{intent} + \beta,\text{progress}, \quad
\alpha + \beta = 1,\ \alpha,\beta \in [0,1]
$$

⸻

🔭 Observability

```bash
aws logs tail /aws/lambda/pia-ingest-context –since 15m –follow
aws logs tail /aws/lambda/pia-get-insights  –since 15m –follow
aws logs tail /aws/lambda/pia-health        –since 15m –follow
```

⸻

⛏️ Dev Tips

Find model IDs (Claude 4.5 Sonnet / Nova Pro):

```bash
aws bedrock list-foundation-models –region $AWS_REGION 
–query “modelSummaries[?contains(modelName,‘Claude 4.5’) || contains(modelName,‘Nova Pro’)].[modelName,modelId]” 
–output table
```

Git flow:

```bash
git checkout -b feat/aws-backend-mvp
git add .
git commit -m “Backend MVP: Claude 4.5 Sonnet + API + DDB”
git push -u origin feat/aws-backend-mvp

open PR to upstream/main

```

⸻

📎 Notes
	•	Models: Claude 4.5 Sonnet (primary summarizer) and Amazon Nova Pro (optional analytics/vision).
	•	Screenshots accepted as base64 (JPEG/PNG). Optional OCR via Textract merges text into summary.
	•	Activities are AI-generated and prioritized by the active tab.
