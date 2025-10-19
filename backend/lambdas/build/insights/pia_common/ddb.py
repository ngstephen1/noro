# backend/common/pia_common/ddb.py
import os
import boto3
from functools import lru_cache
from decimal import Decimal
from typing import Any, Dict, List
from datetime import datetime, timedelta, timezone

# -----------------------
# DynamoDB session helpers
# -----------------------

def _bool_env(name: str) -> bool:
    v = (os.getenv(name) or "").strip().lower()
    return v in {"1", "true", "yes", "on"}

@lru_cache(maxsize=1)
def _resource():
    """
    Returns a cached DynamoDB resource.
    Honors local testing via:
      USE_LOCAL_DDB=1
      DDB_ENDPOINT_URL=http://localhost:8000
    """
    region = os.getenv("AWS_REGION", "us-east-1")
    endpoint = os.getenv("DDB_ENDPOINT_URL") if _bool_env("USE_LOCAL_DDB") else None
    return boto3.resource("dynamodb", region_name=region, endpoint_url=endpoint)

@lru_cache(maxsize=1)
def _table():
    """
    Returns the primary app table from env DDB_TABLE.
    """
    name = os.environ["DDB_TABLE"]
    return _resource().Table(name)

# -----------------------
# Writes
# -----------------------

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
    """
    Persist a session-level summary:
      PK = USER#{user_id}
      SK = SESSION#{ts_iso}
    """
    ttl = int((datetime.now(timezone.utc) + timedelta(days=ttl_days)).timestamp())
    item = {
        "PK": f"USER#{user_id}",
        "SK": f"SESSION#{ts_iso}",
        "type": "session_summary",
        "user_id": user_id,
        "ts": ts_iso,
        "correlation_id": correlation_id,
        "summary_text": summary_text or "",
        "confidence": Decimal(str(confidence)),
        "next_actions": next_actions or [],
        "tab_hashes": tab_hashes or [],
        "raw_excerpt": (raw_excerpt or "")[:1000],
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
    ttl_days: int = 7,
    is_active: bool = False,
) -> None:
    """
    Persist an AI-generated activity/categorization record:
      PK = USER#{user_id}
      SK = ACT#{activity_id}#{ts_iso}

    `label` is a human-friendly category name (e.g., "Project plan – Google Docs").
    `is_active` marks the activity associated with the active tab at capture time.
    """
    ttl = int((datetime.now(timezone.utc) + timedelta(days=ttl_days)).timestamp())
    item = {
        "PK": f"USER#{user_id}",
        "SK": f"ACT#{activity_id}#{ts_iso}",
        "type": "activity",
        "activity_id": activity_id,
        "label": label or "",
        "ts": ts_iso,
        "summary": summary_text or "",
        "confidence": Decimal(str(confidence)),
        "next_actions": next_actions or [],
        "is_active": bool(is_active),
        "ttl": ttl,
    }
    _table().put_item(Item=item)

# -----------------------
# Reads
# -----------------------

def query_latest_summaries(user_id: str, limit: int = 5) -> List[Dict[str, Any]]:
    """
    Return the latest session summaries for a user (newest first).
    """
    from boto3.dynamodb.conditions import Key
    resp = _table().query(
        KeyConditionExpression=Key("PK").eq(f"USER#{user_id}") & Key("SK").begins_with("SESSION#"),
        ScanIndexForward=False,
        Limit=limit,
    )
    return resp.get("Items", [])