# backend/lambdas/health/handler.py
import os, json, boto3

def handler(event, context):
    try:
        table = os.getenv("DDB_TABLE")
        if table:
            boto3.client("dynamodb").describe_table(TableName=table)
        return {
            "statusCode": 200,
            "headers": {
                "content-type": "application/json",
                "access-control-allow-origin": "*"
            },
            "body": json.dumps({"ok": True, "table": table})
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