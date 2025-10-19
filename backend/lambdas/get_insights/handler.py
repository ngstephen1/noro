# backend/lambdas/get_insights/handler.py
import os, json, boto3
from decimal import Decimal
from boto3.dynamodb.conditions import Key

def _dec(v):
    if isinstance(v, list):  return [_dec(x) for x in v]
    if isinstance(v, dict):  return {k:_dec(v) for k,v in v.items()}
    if isinstance(v, Decimal): return float(v)
    return v

def handler(event, context):
    try:
        # Read query params from API Gateway v2
        qs = {}
        if isinstance(event, dict) and event.get("version") == "2.0":
            qs = event.get("queryStringParameters") or {}
        user_id = (qs.get("user_id") or "dev-user")
        limit   = int(qs.get("limit") or "5")

        table_name = os.environ["DDB_TABLE"]
        table = boto3.resource("dynamodb").Table(table_name)

        resp = table.query(
            KeyConditionExpression=Key("PK").eq(f"USER#{user_id}") & Key("SK").begins_with("SESSION#"),
            ScanIndexForward=False,  # newest first
            Limit=limit
        )

        items=[]
        for it in resp.get("Items", []):
            items.append({
                "ts": it["SK"].split("SESSION#")[-1],
                "summary": it.get("summary", ""),
                "next_actions": _dec(it.get("next_actions", [])),
                "confidence": float(it.get("confidence", 0.0)),
            })

        return {
            "statusCode": 200,
            "headers": {
                "content-type": "application/json",
                "access-control-allow-origin": "*"
            },
            "body": json.dumps({"ok": True, "items": items})
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