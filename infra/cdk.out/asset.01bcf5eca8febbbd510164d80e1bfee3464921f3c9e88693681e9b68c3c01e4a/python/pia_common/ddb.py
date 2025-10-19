# backend/common/pia_common/ddb.py
import os, time
from typing import Dict, List
from decimal import Decimal
import boto3

def _ddb_resource():
    endpoint = os.getenv("DDB_ENDPOINT_URL")
    region   = os.getenv("AWS_REGION", "us-east-1")
    if endpoint:
        # No explicit creds here: use the same default chain as the rest of your code
        return boto3.resource("dynamodb", endpoint_url=endpoint, region_name=region)
    return boto3.resource("dynamodb", region_name=region)

def _table():
    table = os.getenv("DDB_TABLE")
    if not table:
        raise RuntimeError("DDB_TABLE not set")
    return _ddb_resource().Table(table)

def put_session_summary(
    *, user_id: str, ts_iso: str, correlation_id: str,
    summary_text: str, confidence: float, next_actions: List[Dict],
    tab_hashes: List[str], raw_excerpt: str = "", ttl_days: int = 30
) -> Dict:
    ttl = int(time.time()) + ttl_days * 86400
    item = {
        "PK": f"USER#{user_id}",
        "SK": f"SESSION#{ts_iso}",
        "type": "session_summary",
        "user_id": user_id,
        "ts": ts_iso,
        "correlation_id": correlation_id,
        "summary_text": summary_text,
        "confidence": Decimal(str(confidence)),  # DynamoDB needs Decimal
        "next_actions": next_actions,
        "tab_hashes": tab_hashes,
        "raw_excerpt": (raw_excerpt or "")[:1500],
        "raw_key": "",
        "ttl": ttl,
    }
    _table().put_item(Item=item)
    return item