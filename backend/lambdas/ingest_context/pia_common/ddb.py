# backend/common/pia_common/ddb.py
import os
import boto3
from functools import lru_cache
from decimal import Decimal
from typing import Any, Dict, List, Optional

# ---- session / resource ----
def _bool_env(name: str) -> bool:
    v = os.getenv(name)
    return v in ("1", "true", "TRUE", "yes", "YES")

@lru_cache(maxsize=1)
def _resource():
    region = os.getenv("AWS_REGION", "us-east-1")
    use_local = _bool_env("USE_LOCAL_DDB")
    endpoint = os.getenv("DDB_ENDPOINT_URL") if use_local else None
    return boto3.resource("dynamodb", region_name=region, endpoint_url=endpoint)

@lru_cache(maxsize=1)
def _table():
    name = os.environ["DDB_TABLE"]
    return _resource().Table(name)

# ---- helpers you already call from handlers ----
def put_session_summary(
    *,
    user_id: str,
    ts_iso: str,
    correlation_id: str,
    summary_text: str,
    confidence: float,
    next_actions: List[Dict[str, Any]],
    tab_hashes: List[str],
    raw_excerpt: str,
    ttl_days: int = 30,
) -> None:
    from datetime import datetime, timedelta, timezone
    ttl = int((datetime.now(tz=timezone.utc) + timedelta(days=ttl_days)).timestamp())

    # botocore requires Decimal for numbers in DDB
    d_conf = Decimal(str(confidence))
    item = {
        "PK": f"USER#{user_id}",
        "SK": f"SESSION#{ts_iso}",
        "type": "session_summary",
        "user_id": user_id,
        "ts": ts_iso,
        "correlation_id": correlation_id,
        "summary_text": summary_text,
        "confidence": d_conf,
        "next_actions": next_actions or [],
        "tab_hashes": tab_hashes or [],
        "raw_excerpt": raw_excerpt or "",
        "ttl": ttl,
    }
    _table().put_item(Item=item)

def query_latest_summaries(user_id: str, limit: int = 5) -> List[Dict[str, Any]]:
    resp = _table().query(
        KeyConditionExpression=boto3.dynamodb.conditions.Key("PK").eq(f"USER#{user_id}") &
                              boto3.dynamodb.conditions.Key("SK").begins_with("SESSION#"),
        ScanIndexForward=False,
        Limit=limit,
    )
    return resp.get("Items", [])