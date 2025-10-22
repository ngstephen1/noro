# backend/lambdas/get_insights/handler.py
import os
import json
from decimal import Decimal
from typing import Any, Dict, List
import base64
from datetime import datetime

import boto3
from boto3.dynamodb.conditions import Key


# ---------- small utils ----------

def _headers_ok() -> Dict[str, str]:
    return {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,OPTIONS",
        "access-control-allow-headers": "*,Authorization,x-api-key,content-type",
    }


def _json(status: int, obj: Dict[str, Any]) -> Dict[str, Any]:
    return {"statusCode": status, "headers": _headers_ok(), "body": json.dumps(obj)}


def _dec_to_float(x: Any) -> Any:
    if isinstance(x, list):
        return [_dec_to_float(v) for v in x]
    if isinstance(x, dict):
        return {k: _dec_to_float(v) for k, v in x.items()}
    if isinstance(x, Decimal):
        # keep ints as ints when possible
        as_float = float(x)
        return int(as_float) if as_float.is_integer() else as_float
    return x


def _get_header(event: Dict[str, Any], name: str) -> str:
    hs = (event.get("headers") or {})
    # case-insensitive
    for k, v in hs.items():
        if k.lower() == name.lower():
            return v
    return ""


def _require_api_key(event: Dict[str, Any]) -> Dict[str, Any] | None:
    """Return a response if forbidden, else None to continue."""
    expected = os.getenv("API_KEY", "")
    if not expected:
        return None  # not enforced

    key = _get_header(event, "x-api-key")
    if not key:
        auth = _get_header(event, "authorization")
        if auth.lower().startswith("bearer "):
            key = auth.split(None, 1)[1].strip()

    if key != expected:
        return _json(401, {"ok": False, "error": "missing_or_invalid_api_key"})
    return None


def _encode_cursor(key: Dict[str, Any] | None) -> str | None:
    if not key:
        return None
    try:
        raw = json.dumps(key).encode("utf-8")
        return base64.urlsafe_b64encode(raw).decode("utf-8")
    except Exception:
        return None

def _decode_cursor(s: str | None) -> Dict[str, Any] | None:
    if not s:
        return None
    try:
        raw = base64.urlsafe_b64decode(s.encode("utf-8"))
        return json.loads(raw.decode("utf-8"))
    except Exception:
        return None

def _is_http_options(event: Dict[str, Any]) -> bool:
    try:
        method = (event.get("requestContext") or {}).get("http", {}).get("method", "")
        return method.upper() == "OPTIONS"
    except Exception:
        return False


# ---------- handler ----------

def handler(event, context):
    try:
        # CORS preflight for HTTP API v2
        if isinstance(event, dict) and _is_http_options(event):
            return {"statusCode": 204, "headers": _headers_ok(), "body": ""}

        # Optional API key gate
        gated = _require_api_key(event if isinstance(event, dict) else {})
        if gated:
            return gated

        # Parse API Gateway HTTP API v2 query
        qs = {}
        if isinstance(event, dict) and event.get("version") == "2.0":
            qs = event.get("queryStringParameters") or {}

        user_id = (qs.get("user_id") or "dev-user").strip()
        # clamp limit to [1, 50]
        try:
            limit = int(qs.get("limit") or "5")
        except Exception:
            limit = 5
        limit = max(1, min(50, limit))

        # Optional: choose "type" = "session" (default) or "activity"
        item_type = (qs.get("type") or "session").lower().strip()
        prefix = "SESSION#" if item_type != "activity" else "ACT#"

        # Optional cursor (pagination) and since filter
        start_key = _decode_cursor(qs.get("cursor"))
        since_iso = (qs.get("since") or "").strip()

        table_name = os.environ["DDB_TABLE"]
        table = boto3.resource("dynamodb").Table(table_name)

        query_kwargs = {
            "KeyConditionExpression": Key("PK").eq(f"USER#{user_id}") & Key("SK").begins_with(prefix),
            "ScanIndexForward": False,  # newest first
            "Limit": limit,
            "ProjectionExpression": "PK,SK,ts,summary_text,summary,next_actions,confidence,correlation_id,tags,insight_bullets,activity_id",
        }
        if start_key:
            query_kwargs["ExclusiveStartKey"] = start_key

        resp = table.query(**query_kwargs)
        raw_items = resp.get("Items", [])

        items_out: List[Dict[str, Any]] = []

        # optional since filter; uses the 'ts' attribute if present, else derives from SK
        if since_iso:
            try:
                cutoff = since_iso
                raw_items = [x for x in raw_items if (x.get("ts") or (x.get("SK","").split("#")[-1])) >= cutoff]
            except Exception:
                pass

        for it in raw_items:
            sk: str = it.get("SK", "")
            if prefix == "SESSION#":
                ts = sk.split("SESSION#", 1)[-1] or it.get("ts", "")
            else:
                parts = sk.split("#", 2)
                ts = parts[-1] if len(parts) >= 3 else it.get("ts", "")
            items_out.append({
                "ts": ts,
                # prefer new field; fall back to legacy
                "summary": it.get("summary_text") or it.get("summary", ""),
                "next_actions": _dec_to_float(it.get("next_actions", [])),
                "confidence": float(it.get("confidence", 0.0)),
                "correlation_id": it.get("correlation_id", ""),
                # optional extras (non-breaking)
                **({"activity_id": it.get("activity_id")} if "activity_id" in it else {}),
                **({"tags": it.get("tags")} if "tags" in it else {}),
                **({"insight_bullets": it.get("insight_bullets")} if "insight_bullets" in it else {}),
            })

        next_cursor = _encode_cursor(resp.get("LastEvaluatedKey"))
        body = {"ok": True, "items": items_out}
        if next_cursor:
            body["cursor"] = next_cursor
        return _json(200, body)

    except Exception as e:
        # minimal logging surface
        print("ERROR get_insights:", repr(e))
        return _json(500, {"ok": False, "error": str(e)})