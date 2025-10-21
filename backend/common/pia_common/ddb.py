import os
import boto3
from functools import lru_cache
from decimal import Decimal
from typing import Any, Dict, List

# ---- session / resource ----
def _bool_env(name: str) -> bool:
    v = os.getenv(name)
    return str(v).lower() in ("1", "true", "yes", "on")

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

# ---- numeric coercion for DynamoDB (floats -> Decimal) ----
def _to_ddb(val: Any) -> Any:
    # Keep bools as bool (bool is a subclass of int in Python!)
    if isinstance(val, bool):
        return val
    # Convert all numbers to Decimal (boto3 requirement for DDB)
    if isinstance(val, (int, float, Decimal)):
        return Decimal(str(val))
    if isinstance(val, list):
        return [_to_ddb(v) for v in val]
    if isinstance(val, dict):
        return {k: _to_ddb(v) for k, v in val.items()}
    return val

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

    item = {
        "PK": f"USER#{user_id}",
        "SK": f"SESSION#{ts_iso}",
        "type": "session_summary",
        "user_id": user_id,
        "ts": ts_iso,
        "correlation_id": correlation_id,
        "summary_text": summary_text or "",
        "confidence": Decimal(str(confidence)),
        # Deep-convert any numeric fields inside actions (e.g., duration_min)
        "next_actions": _to_ddb(next_actions or []),
        "tab_hashes": tab_hashes or [],
        "raw_excerpt": raw_excerpt or "",
        "ttl": ttl,
    }
    _table().put_item(Item=item)

def put_activity_summary(
    *,
    user_id: str,
    activity_id: str,
    ts_iso: str,
    label: str,
    summary_text: str,
    confidence: float,
    next_actions: List[Dict[str, Any]],
    is_active: bool,
    rank: int,
    related_hashes: List[str],
    active_url_hash: str,
    ttl_days: int = 7,
) -> None:
    from datetime import datetime, timedelta, timezone
    ttl = int((datetime.now(tz=timezone.utc) + timedelta(days=ttl_days)).timestamp())

    item = {
        "PK": f"USER#{user_id}",
        "SK": f"ACT#{activity_id}#{ts_iso}",
        "type": "activity",
        "user_id": user_id,
        "activity_id": activity_id,
        "ts": ts_iso,
        "label": label or "",
        "summary_text": summary_text or "",
        "confidence": Decimal(str(confidence)),
        "next_actions": _to_ddb(next_actions or []),
        "is_active": bool(is_active),
        "rank": Decimal(str(rank)),
        "related_hashes": related_hashes or [],
        "active_url_hash": active_url_hash or "",
        "ttl": ttl,
    }
    _table().put_item(Item=item)

def query_latest_summaries(user_id: str, limit: int = 5) -> List[Dict[str, Any]]:
    from boto3.dynamodb.conditions import Key
    resp = _table().query(
        KeyConditionExpression=Key("PK").eq(f"USER#{user_id}") &
                              Key("SK").begins_with("SESSION#"),
        ScanIndexForward=False,
        Limit=limit,
    )
    return resp.get("Items", [])