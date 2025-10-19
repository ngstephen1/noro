\documentclass[11pt]{article}
\usepackage[margin=1in]{geometry}
\usepackage[T1]{fontenc}
\usepackage{hyperref}
\usepackage{enumitem}
\hypersetup{colorlinks=true, urlcolor=blue}

\title{Noro AWS Backend --- Handoff README}
\date{}
\begin{document}
\maketitle

\section*{TL;DR}
\textbf{Base URL}
\begin{verbatim}
https://<API_ID>.execute-api.<REGION>.amazonaws.com/prod
# our dev: https://sb21puxxcd.execute-api.us-east-1.amazonaws.com/prod
\end{verbatim}

\textbf{Auth header (simple shared key, validated in Lambda)}
\begin{verbatim}
x-api-key: <ask teammate for current value>
\end{verbatim}

\textbf{Endpoints}
\begin{itemize}[noitemsep,topsep=2pt]
  \item \texttt{GET /health} --- sanity check + table name
  \item \texttt{POST /context} --- send a session snapshot (tabs + optional screenshot)
  \item \texttt{GET /insights?user\_id=<uuid>\&limit=<N>} --- latest N summaries
\end{itemize}

CORS: \texttt{*}\quad|\quad Throttle: burst 10, rate 5 rps.

\section*{Request Payloads We Accept}
The backend accepts \emph{either} the extension's structure or a minimal canonical shape and normalizes internally.

\subsection*{A) Extension Shape (supported)}
\begin{verbatim}
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
          "data": { "workbook": "Q4 Sales Pipeline",
                    "activeSheet": "Pipeline", "selectedRange": "B5:D8" },
          "screenshot": {
            "data": "/9j/4AAQSkZJRgABAQEAAAAAAAD...",   // base64
            "format": "jpeg", "quality": 50, "size": 245
          }
        }
      ]
    }
  ],
  "userId": "dev-user"        // optional; default is "dev-user"
}
\end{verbatim}

\subsection*{B) Minimal Canonical Shape (also supported)}
\begin{verbatim}
{
  "correlation_id": "c-123",
  "user_id": "dev-user",
  "ts": "2025-10-19T19:00:00Z",
  "event": "manual_capture",
  "active_app": "chrome",
  "active_url_hash": "abcd1234",
  "tabs": [
    {"title": "Q4 Sales Pipeline - Google Sheets",
     "url": "https://docs.google.com/spreadsheets/d/xyz",
     "url_hash": "abcd1234",
     "text_sample": "selected B5:D8"}
  ],
  "screenshots": [
    {"mime": "image/jpeg", "dataBase64": "<base64>"}   // optional, up to 2
  ],
  "signals": {"idle_sec": 0},
  "privacy": {"redacted": true}
}
\end{verbatim}

\paragraph{Server-side processing}
\begin{itemize}[noitemsep,topsep=2pt]
  \item Normalizes A $\rightarrow$ B.
  \item Decodes up to 2 screenshots (in-memory); optional OCR via Textract (merge text).
  \item Clusters tabs into activities, prioritizes the active tab's cluster, generates a short AI label, and suggests next actions.
  \item Persists a session summary for \texttt{/insights}; persists activity items for future use.
\end{itemize}

\section*{Responses}
\subsection*{POST /context}
\begin{verbatim}
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
        {"action":"open_tab","target_url_hash":"","label":"Reopen last tab"},
        {"action":"start_timer","label":"Start 25-min focus timer","duration_min":25}
      ],
      "confidence": 0.7,
      "tab_hashes": ["https://docs.google.com/spreadsheets/d/xyz"],
      "active_url_hash": "https://docs.google.com/spreadsheets/d/xyz",
      "rank": 0
    }
  ]
}
\end{verbatim}

\subsection*{GET /insights}
\begin{verbatim}
{
  "ok": true,
  "items": [
    {
      "ts": "2025-10-19T19:00:00Z",
      "summary": "On \"Project plan – Google Docs\". Working with: UAT duration update...",
      "next_actions": [
        {"action":"open_tab","target_url_hash":"","label":"Reopen last tab"},
        {"action":"start_timer","label":"Start 25-min focus timer","duration_min":25}
      ],
      "confidence": 0.7,
      "correlation_id": "c-727e7334"
    }
  ]
}
\end{verbatim}

\section*{Quick Verification}
\begin{verbatim}
API_URL="https://sb21puxxcd.execute-api.us-east-1.amazonaws.com/prod"
API_KEY="<shared-key>"

# Health
curl -i -H "x-api-key: $API_KEY" "$API_URL/health"

# Context (extension JSON)
curl -s -H "x-api-key: $API_KEY" -H "content-type: application/json" \
  -d @/path/to/teammate_payload.json "$API_URL/context" | jq .

# Insights
curl -s -H "x-api-key: $API_KEY" \
  "$API_URL/insights?user_id=dev-user&limit=5" | jq .
\end{verbatim}

\section*{AI Models \& Config}
\begin{itemize}[noitemsep,topsep=2pt]
  \item Model: Bedrock Anthropic \texttt{anthropic.claude-3-haiku-20240307-v1:0}
  \item Switch: \texttt{USE\_BEDROCK=true|false} (falls back to stub on false)
  \item Region: \texttt{BEDROCK\_REGION=us-east-1}
  \item OCR (optional): \texttt{USE\_TEXTRACT=true} to enable Textract on screenshots (in-memory only)
\end{itemize}

\section*{Auth, CORS, Rate Limiting}
\begin{itemize}[noitemsep,topsep=2pt]
  \item Auth: shared header \texttt{x-api-key} checked inside Lambdas.
  \item CORS: \texttt{AllowOrigins:*}, methods \texttt{GET, POST, OPTIONS}.
  \item Throttle: burst 10, rate 5 rps (HTTP API route settings).
\end{itemize}

\section*{AWS Resources (dev env)}
\begin{itemize}[noitemsep,topsep=2pt]
  \item API Gateway HTTP API (v2): \texttt{pia-http} (API ID \texttt{sb21puxxcd}, stage \texttt{prod})
  \item Routes: \texttt{GET /health → pia-health}, \texttt{POST /context → pia-ingest-context}, \texttt{GET /insights → pia-get-insights}
  \item DynamoDB: table \texttt{pia-dev}, keys \texttt{PK}, \texttt{SK}, TTL attr \texttt{ttl}
  \item Lambdas: \texttt{pia-health}, \texttt{pia-ingest-context}, \texttt{pia-get-insights}
\end{itemize}

\section*{DynamoDB Model (MVP)}
\paragraph{Session summary (used by /insights)}
\begin{verbatim}
PK = USER#<user_id>
SK = SESSION#<iso_ts>
{
  type, user_id, ts, correlation_id,
  summary_text, confidence (Number/Decimal),
  next_actions: [ ... ],
  tab_hashes: [ ... ],
  raw_excerpt, ttl
}
\end{verbatim}

\paragraph{Activity items (persisted for future)}
\begin{verbatim}
PK = USER#<user_id>
SK = ACT#<activity_id>#<iso_ts>
{
  type, activity_id, label, is_active, rank, tab_hashes,
  summary_text, confidence, next_actions, ttl
}
\end{verbatim}

\section*{Environment Variables (per Lambda)}
\begin{verbatim}
API_KEY=<shared-key>
DDB_TABLE=pia-dev
USE_BEDROCK=true|false
BEDROCK_REGION=us-east-1
BEDROCK_MODEL=anthropic.claude-3-haiku-20240307-v1:0
USE_TEXTRACT=true|false
\end{verbatim}

\section*{Logs \& Troubleshooting}
\begin{verbatim}
aws logs tail /aws/lambda/pia-ingest-context --since 5m
aws logs tail /aws/lambda/pia-get-insights  --since 5m
aws logs tail /aws/lambda/pia-health        --since 5m
\end{verbatim}
\textbf{403 forbidden}: missing/wrong \texttt{x-api-key} or Lambda \texttt{API\_KEY} not set.\\
\textbf{Decimal errors}: floats are coerced to Decimal before DDB writes in current code.\\
\textbf{Import errors}: ensure \texttt{backend/common/pia\_common/*.py} is packaged into each Lambda zip.

\section*{(Optional) Repackage \& Deploy}
\begin{verbatim}
ST=/tmp/pia_pkg; OUT=backend/lambdas/dist
rm -rf "$ST" && mkdir -p "$ST" "$OUT"
for fn in ingest insights health; do mkdir -p "$ST/$fn/pia_common"; done

cp backend/lambdas/ingest_context/handler.py "$ST/ingest/handler.py"
cp backend/lambdas/get_insights/handler.py     "$ST/insights/handler.py"
cp backend/lambdas/health/handler.py           "$ST/health/handler.py"
cp backend/common/pia_common/*.py              "$ST/ingest/pia_common/"
cp backend/common/pia_common/*.py              "$ST/insights/pia_common/"
cp backend/common/pia_common/*.py              "$ST/health/pia_common/"

( cd "$ST/ingest"   && zip -r dist_ingest.zip   handler.py pia_common >/dev/null )
( cd "$ST/insights" && zip -r dist_insights.zip handler.py pia_common >/dev/null )
( cd "$ST/health"   && zip -r dist_health.zip   handler.py pia_common >/dev/null )

mv "$ST/ingest/dist_ingest.zip"     "$OUT/dist_ingest.zip"
mv "$ST/insights/dist_insights.zip" "$OUT/dist_insights.zip"
mv "$ST/health/dist_health.zip"     "$OUT/dist_health.zip"

aws lambda update-function-code --function-name pia-ingest-context \
  --zip-file fileb://"$(pwd)"/backend/lambdas/dist/dist_ingest.zip
aws lambda update-function-code --function-name pia-get-insights \
  --zip-file fileb://"$(pwd)"/backend/lambdas/dist/dist_insights.zip
aws lambda update-function-code --function-name pia-health \
  --zip-file fileb://"$(pwd)"/backend/lambdas/dist/dist_health.zip
\end{verbatim}

\section*{Nice-to-haves (post-MVP)}
\begin{itemize}[noitemsep,topsep=2pt]
  \item Expose activity items in \texttt{/insights}.
  \item Consider Bedrock Vision for richer multimodal summaries.
  \item Replace shared key with JWT or SigV4 when needed.
\end{itemize}

\end{document}