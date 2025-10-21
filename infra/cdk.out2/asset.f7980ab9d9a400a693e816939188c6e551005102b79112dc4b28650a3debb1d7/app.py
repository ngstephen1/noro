# backend/process_context/app.py
import os
import json
from typing import Any, Dict, List

from pia_common.schema import validate
from pia_common.logging import get_logger
from pia_common.bedrock import summarize_stub
from pia_common.ddb import put_session_summary  # writes to DDB if DDB_TABLE is set

log = get_logger("process")

# If set, we persist summaries to DynamoDB (real AWS or DynamoDB Local).
DDB_TABLE = os.getenv("DDB_TABLE")


def _coerce_record_body(record: Dict[str, Any]) -> Dict[str, Any]:
    """Accept SQS-style {'body': '<json>'} or a direct dict for local tests."""
    body = record.get("body", record)
    if isinstance(body, str):
        return json.loads(body)
    return body


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
            # 1) Parse + validate input (context_event)
            payload = _coerce_record_body(rec)
            validate("context_event", payload)

            # 2) Summarize (stub now; later: Bedrock)
            summary = summarize_stub(payload)

            # 3) Validate model output (session_summary)
            validate("session_summary", summary)

            # 4) Optional: write to DynamoDB (enabled when DDB_TABLE is set)
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

            # 5) Log success
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