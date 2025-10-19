# backend/process_context/app.py
from __future__ import annotations

import json
import os
from typing import Any, Dict, List

from pia_common.schema import validate
from pia_common.logging import get_logger
from pia_common.ddb import put_session_summary
from pia_common.bedrock import summarize_bedrock, summarize_stub  # switch at runtime

log = get_logger("process")

# If set, summaries will be persisted to DynamoDB (either AWS or DynamoDB Local)
DDB_TABLE = os.getenv("DDB_TABLE")

# Toggle Bedrock (otherwise use the local stub)
USE_BEDROCK = os.getenv("USE_BEDROCK", "").lower() in {"1", "true", "yes", "on"}


def _coerce_record_body(record: Dict[str, Any]) -> Dict[str, Any]:
    """Accept SQS-style {'body': '<json>'} or a direct dict for local tests."""
    body = record.get("body", record)
    if isinstance(body, str):
        return json.loads(body)
    return body


def _sanitize_context(evt: Dict[str, Any]) -> Dict[str, Any]:
    """
    Remove/normalize fields our schema doesn't know about to avoid validation errors.
    Also performs back-compat normalization.
    """
    evt = dict(evt)  # shallow copy

    # --- BACKCOMPAT: legacy emitter used "auto_capture" -> map to schema's 'periodic'
    if str(evt.get("event", "")).lower() == "auto_capture":
        evt["event"] = "periodic"
    # ------------------------------------------------------------------------------

    # tabs: keep only known keys
    tabs: List[Dict[str, Any]] = []
    for t in evt.get("tabs", []) or []:
        if not isinstance(t, dict):
            continue
        t2 = {k: v for k, v in t.items() if k in {"title", "url_hash", "text_sample"}}
        # normalize types / lengths
        t2["title"] = (t2.get("title") or "")[:300]
        t2["url_hash"] = (t2.get("url_hash") or "")[:64]
        t2["text_sample"] = (t2.get("text_sample") or "")[:4000]
        tabs.append(t2)
    evt["tabs"] = tabs

    # signals: allow only documented keys
    sig = evt.get("signals") or {}
    evt["signals"] = {
        "idle_sec": int(sig.get("idle_sec", 0) or 0),
        "calendar_busy": bool(sig.get("calendar_busy", False)),
        "slack_ping": bool(sig.get("slack_ping", False)),
    }

    # privacy: allowlist only
    priv = evt.get("privacy") or {}
    allowlist = priv.get("allowlist") or []
    if isinstance(allowlist, list):
        allowlist = [str(x) for x in allowlist][:50]
    else:
        allowlist = []
    evt["privacy"] = {"redacted": bool(priv.get("redacted", True)), "allowlist": allowlist}

    # minimal requireds (avoid KeyErrors later)
    evt["user_id"] = str(evt.get("user_id") or "dev-user")
    evt["ts"] = str(evt.get("ts") or "")
    evt["event"] = str(evt.get("event") or "manual_capture")
    evt["active_app"] = str(evt.get("active_app") or "chrome")
    evt["correlation_id"] = str(evt.get("correlation_id") or f"c-{evt['user_id']}")

    return evt


def handler(event, context):
    """
    Expected SQS event:
      {"Records": [{"body": "{...context_event json...}"}]}
    For local testing you may also pass:
      {"Records": [{"body": {...dict...}}]}  or just {"body": {...}}
    """
    records: List[Dict[str, Any]] = event.get("Records") or ([event] if "body" in event else [])
    results: List[Dict[str, Any]] = []

    for rec in records:
        try:
            # 1) Parse + sanitize + validate input (context_event)
            raw_payload = _coerce_record_body(rec)
            payload = _sanitize_context(raw_payload)
            validate("context_event", payload)

            # 2) Summarize (Bedrock if enabled; else local stub)
            if USE_BEDROCK:
                summary = summarize_bedrock(payload)
            else:
                summary = summarize_stub(payload)

            # 3) Validate generated model output (session_summary)
            validate("session_summary", summary)

            # 4) Optional: write to DynamoDB
            wrote = False
            if DDB_TABLE:
                user_id = payload["user_id"]
                ts_iso = payload["ts"]
                tab_hashes = [t.get("url_hash", "") for t in payload.get("tabs", [])]
                raw_excerpt = (payload.get("tabs", [{}])[0].get("text_sample") or "")[:300]

                put_session_summary(
                    user_id=user_id,
                    ts_iso=ts_iso,
                    correlation_id=summary["correlation_id"],
                    summary_text=summary["summary"],
                    confidence=summary["confidence"],
                    next_actions=summary["next_actions"],
                    tab_hashes=tab_hashes,
                    raw_excerpt=raw_excerpt,
                    ttl_days=30,
                )
                wrote = True

            log.info(
                json.dumps(
                    {
                        "ok": True,
                        "correlation_id": summary["correlation_id"],
                        "summary": summary["summary"],
                        "ddb": wrote,
                    }
                )
            )
            results.append({"ok": True, "correlation_id": summary["correlation_id"]})

        except ValueError as ve:
            # Schema errors
            log.info(json.dumps({"ok": False, "error": str(ve)}))
            results.append({"ok": False, "error": str(ve)})
        except Exception as e:
            log.info(json.dumps({"ok": False, "error": f"internal: {e}"}))
            results.append({"ok": False, "error": "internal_error"})

    return {"processed": len(results), "results": results}