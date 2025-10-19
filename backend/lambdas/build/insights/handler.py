# backend/lambdas/get_insights/handler.py
import os
import json
from decimal import Decimal
from typing import Any, Dict, List

import boto3
from boto3.dynamodb.conditions import Key


# ---------- small utils ----------

def _headers_ok() -> Dict[str, str]:
    return {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
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


# ---------- handler ----------

def handler(event, context):
    try:
        # Optional API key gate
        gated = _require_api_key(event if isinstance(event, dict) else {})
        if gated:
            return gated

        # Parse API Gateway HTTP API v2 query
        qs = {}
        if isinstance(event, dict) and event.get("version") == "2.0":
            qs = event.get("queryStringParameters") or {}

        user_id = (qs.get("user_id") or "dev-user").strip()
        limit = int(qs.get("limit") or "5")
        # Optional: choose "type" = "session" (default) or "activity"
        item_type = (qs.get("type") or "session").lower().strip()
        prefix = "SESSION#" if item_type != "activity" else "ACT#"

        table_name = os.environ["DDB_TABLE"]
        table = boto3.resource("dynamodb").Table(table_name)

        resp = table.query(
            KeyConditionExpression=Key("PK").eq(f"USER#{user_id}") & Key("SK").begins_with(prefix),
            ScanIndexForward=False,  # newest first
            Limit=limit,
        )

        items_out: List[Dict[str, Any]] = []
        for it in resp.get("Items", []):
            sk: str = it.get("SK", "")
            if prefix == "SESSION#":
                ts = sk.split("SESSION#", 1)[-1]
            else:
                # SK = ACT#{activity_id}#{ts}
                parts = sk.split("#", 2)
                ts = parts[-1] if len(parts) >= 3 else it.get("ts", "")

            items_out.append({
                "ts": ts,
                "summary": it.get("summary") or it.get("summary_text", ""),
                "next_actions": _dec_to_float(it.get("next_actions", [])),
                "confidence": float(it.get("confidence", 0.0)),
                # optional extras if present
                **({"activity_id": it.get("activity_id")} if "activity_id" in it else {}),
                **({"correlation_id": it.get("correlation_id")} if "correlation_id" in it else {}),
            })

        return _json(200, {"ok": True, "items": items_out})

    except Exception as e:
        # minimal logging surface
        print("ERROR get_insights:", repr(e))
        return _json(500, {"ok": False, "error": str(e)})