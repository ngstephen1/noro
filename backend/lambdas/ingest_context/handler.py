# backend/lambdas/ingest_context/handler.py
import os, json
from pia_common.bedrock import summarize  # decides stub vs bedrock via env
from pia_common.ddb import put_session_summary

def _parse_apigw_v2(event):
    # Accept API Gateway HTTP API v2 or raw body
    if isinstance(event, dict) and event.get("version") == "2.0" and "requestContext" in event:
        body = event.get("body")
        if isinstance(body, str):
            return json.loads(body)
        return body or {}
    if isinstance(event, dict) and "body" in event:
        b = event["body"]
        return json.loads(b) if isinstance(b, str) else (b or {})
    return event if isinstance(event, dict) else {}

def handler(event, context):
    try:
        payload = _parse_apigw_v2(event)

        # minimal defaults
        payload.setdefault("user_id", "dev-user")
        payload.setdefault("ts", "")
        payload.setdefault("event", "manual_capture")
        payload.setdefault("active_app", "chrome")
        tabs = payload.get("tabs") or []
        if not tabs:
            tabs = [{"title": payload.get("active_app",""), "url_hash":"", "text_sample":""}]
            payload["tabs"] = tabs

        # summarize (stub or bedrock depending on env USE_BEDROCK)
        summary = summarize(payload)

        # write to DynamoDB if configured
        table = os.getenv("DDB_TABLE")
        if table:
            user_id = payload["user_id"]
            ts_iso = payload["ts"]
            tab_hashes = [t.get("url_hash","") for t in tabs]
            raw_excerpt = (tabs[0].get("text_sample") or "")[:300]
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

        return {
            "statusCode": 200,
            "headers": {
                "content-type": "application/json",
                "access-control-allow-origin": "*"
            },
            "body": json.dumps({"ok": True})
        }
    except Exception as e:
        return {
            "statusCode": 500,
            "headers": {
                "content-type": "application/json",
                "access-control-allow-origin": "*"
            },
            "body": json.dumps({"ok": False, "error": str(e)})
        }