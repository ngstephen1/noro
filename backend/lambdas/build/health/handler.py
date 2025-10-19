# backend/lambdas/health/handler.py
import os
import json
import boto3

def _cors_headers():
    return {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "*",
        "access-control-max-age": "300",
    }

def _ok(body: dict, code: int = 200):
    return {"statusCode": code, "headers": _cors_headers(), "body": json.dumps(body)}

def _err(msg: str, code: int = 500):
    return _ok({"ok": False, "error": msg}, code)

def _method(event) -> str:
    # HTTP API v2 event
    try:
        return (event.get("requestContext", {}).get("http", {}).get("method") or "").upper()
    except Exception:
        return ""

def _check_api_key(event):
    """If API_KEY env is set, require x-api-key header to match."""
    required = os.getenv("API_KEY")
    if not required:
        return None  # not enforced
    headers = event.get("headers") or {}
    supplied = headers.get("x-api-key") or headers.get("X-Api-Key")
    if supplied != required:
        return _err("forbidden", 403)
    return None

def handler(event, context):
    # CORS preflight
    if _method(event) == "OPTIONS":
        return _ok({"ok": True}, 204)

    fail = _check_api_key(event)
    if fail:
        return fail

    try:
        table = os.getenv("DDB_TABLE")
        if table:
            boto3.client("dynamodb").describe_table(TableName=table)
        return _ok({"ok": True, "table": table})
    except Exception as e:
        return _err(str(e), 500)