# backend/get_insights/app.py
import os
import json
import boto3
from boto3.dynamodb.conditions import Key

DDB_TABLE = os.getenv("DDB_TABLE")                # e.g., "pia-dev"
DDB_ENDPOINT_URL = os.getenv("DDB_ENDPOINT_URL")  # e.g., "http://localhost:8000"
AWS_REGION = os.getenv("AWS_REGION", "us-east-1")

if not DDB_TABLE:
    raise RuntimeError("DDB_TABLE not set")

# Use the same default cred chain everywhere; only override the endpoint for local DynamoDB.
if DDB_ENDPOINT_URL:
    dynamo = boto3.resource("dynamodb", endpoint_url=DDB_ENDPOINT_URL, region_name=AWS_REGION)
else:
    dynamo = boto3.resource("dynamodb", region_name=AWS_REGION)

table = dynamo.Table(DDB_TABLE)


def _cors():
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type,Authorization,x-api-key",
        "Access-Control-Allow-Methods": "OPTIONS,GET",
    }


def _http_method(event):
    # Support API Gateway v1, v2 and plain local calls
    if "httpMethod" in event:
        return event["httpMethod"]
    return event.get("requestContext", {}).get("http", {}).get("method", "GET")


def handler(event, context):
    # CORS preflight
    if _http_method(event) == "OPTIONS":
        return {"statusCode": 200, "headers": _cors(), "body": ""}

    try:
        qs = event.get("queryStringParameters") or {}
        user_id = qs.get("user_id", "dev-user")
        limit = int(qs.get("limit", "10"))

        resp = table.query(
            KeyConditionExpression=Key("PK").eq(f"USER#{user_id}") & Key("SK").begins_with("SESSION#"),
            ScanIndexForward=False,  # newest first if SK is ISO timestamp
            Limit=limit,
        )

        items = resp.get("Items", [])
        # Project + coerce Decimal -> float for JSON
        out = [
            {
                "ts": it.get("ts"),
                "summary": it.get("summary_text"),
                "next_actions": it.get("next_actions", []),
                "confidence": float(it.get("confidence", 0)),
            }
            for it in items
        ]

        return {"statusCode": 200, "headers": _cors(), "body": json.dumps({"ok": True, "items": out})}

    except dynamo.meta.client.exceptions.ResourceNotFoundException:
        return {
            "statusCode": 500,
            "headers": _cors(),
            "body": json.dumps({"ok": False, "error": f"DynamoDB table '{DDB_TABLE}' not found"}),
        }
    except Exception as e:
        return {"statusCode": 500, "headers": _cors(), "body": json.dumps({"ok": False, "error": str(e)})}