import json
from typing import Any, Dict, List
from pia_common.schema import validate
from pia_common.logging import get_logger
from pia_common.bedrock import summarize_stub

log = get_logger("process")

def _coerce_record_body(record: Dict[str, Any]) -> Dict[str, Any]:
    body = record.get("body", record)
    if isinstance(body, str):
        return json.loads(body)
    return body

def handler(event, context):
    records: List[Dict[str, Any]] = event.get("Records", [])
    results = []
    for rec in records:
        try:
            payload = _coerce_record_body(rec)
            validate("context_event", payload)
            summary = summarize_stub(payload)
            validate("session_summary", summary)
            log.info(json.dumps({"ok": True, "correlation_id": summary["correlation_id"], "summary": summary["summary"]}))
            results.append({"ok": True, "correlation_id": summary["correlation_id"]})
        except ValueError as ve:
            log.info(json.dumps({"ok": False, "error": str(ve)}))
            results.append({"ok": False, "error": str(ve)})
        except Exception as e:
            log.info(json.dumps({"ok": False, "error": f"internal: {e}"}))
            results.append({"ok": False, "error": "internal_error"})
    return {"processed": len(results), "results": results}
