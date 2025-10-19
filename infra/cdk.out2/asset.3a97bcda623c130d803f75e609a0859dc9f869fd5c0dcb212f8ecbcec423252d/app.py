# backend/ingest_context/app.py
import os
import json
import base64
from typing import Any, Dict
import boto3

from pia_common.schema import validate
from pia_common.logging import get_logger

log = get_logger("ingest")

# Optional: if set, we enqueue to SQS; otherwise we just 202-accept (dev mode).
QUEUE_URL = os.getenv("QUEUE_URL")


def _cors_headers():
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type,Authorization,x-api-key",
        "Access-Control-Allow-Methods": "OPTIONS,POST,GET",
    }


def _parse_body(event: Dict[str, Any]) -> Dict[str, Any]:
    """
    Works for API Gateway v2 (HTTP API) and v1 (REST).
    If invoked locally, you can just pass {'body': <json or dict>}.
    """
    body = event.get("body")
    if body is None:
        return {}
    if event.get("isBase64Encoded"):
        body = base64.b64decode(body).decode("utf-8")
    if isinstance(body, str):
        return json.loads(body)
    return body


def handler(event, context):
    # CORS preflight
    if event.get("httpMethod") == "OPTIONS" or (
        event.get("requestContext", {}).get("http", {}).get("method") == "OPTIONS"
    ):
        return {"statusCode": 200, "headers": _cors_headers(), "body": ""}

    try:
        payload = _parse_body(event)
        # Contract check (shared/schemas/context_event.schema.json)
        validate("context_event", payload)

        if QUEUE_URL:
            sqs = boto3.client("sqs")
            sqs.send_message(QueueUrl=QUEUE_URL, MessageBody=json.dumps(payload))
            log.info(json.dumps({"ingest": "queued", "correlation_id": payload.get("correlation_id")}))
            queued = True
        else:
            # Dev path: accept without queue
            log.info(json.dumps({"ingest": "accepted-dev", "correlation_id": payload.get("correlation_id")}))
            queued = False

        return {
            "statusCode": 202,
            "headers": _cors_headers(),
            "body": json.dumps({"ok": True, "queued": queued}),
        }

    except ValueError as ve:
        # Schema/validation error
        return {
            "statusCode": 400,
            "headers": _cors_headers(),
            "body": json.dumps({"ok": False, "error": str(ve)}),
        }
    except Exception as e:
        log.info(json.dumps({"error": str(e)}))
        return {
            "statusCode": 500,
            "headers": _cors_headers(),
            "body": json.dumps({"ok": False, "error": "internal_error"}),
        }