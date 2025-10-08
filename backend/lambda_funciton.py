import os, json
from datetime import datetime, timedelta, timezone
import boto3

DDB_TABLE = os.getenv("DDB_TABLE")
MODEL_ID  = os.getenv("MODEL_ID")  # e.g., anthropic.claude-3-5-sonnet-20240620-v1:0
REGION    = os.getenv("AWS_REGION", "us-east-1")

ddb = boto3.resource("dynamodb") if DDB_TABLE else None
table = ddb.Table(DDB_TABLE) if DDB_TABLE else None
br = boto3.client("bedrock-runtime", region_name=REGION) if MODEL_ID else None

PROMPT = (
    "You are Noro. Summarize the last {mins} minutes from JSON snapshots.\n"
    "Return JSON with keys: summary, highlights (2-4 bullets), nextSteps (2), links (2-3 with label/url).\n"
    "Keep text under 120 words total.\n"
    "SNAPSHOTS:\n{snaps}"
)

def _heuristic(snaps):
    latest = max(snaps, key=lambda s: s["t"])
    title = latest.get("signals",{}).get("title") or latest["url"].split("/")[2]
    app = latest.get("app")
    path = " › ".join(latest.get("signals",{}).get("headingPath", [])[:3])
    cursor = (latest.get("signals",{}).get("cursorText") or "")[:80]
    highlights=[]
    if app=="gdocs":
        highlights.append(f"Edited **{path or 'document'}** in **{title}** (Docs).")
        if cursor: highlights.append(f"Cursor near: “{cursor}”")
    else:
        highlights.append(f"Worked in **{title}**.")
    return {
        "summary": " ".join(highlights)[:220],
        "highlights": highlights[:4],
        "nextSteps": ["Pick up where you stopped","Jot the next subtask"],
        "links": [{"label": f"Open {title}", "url": latest["url"]}],
    }

def lambda_handler(event, _ctx):
    headers = {
        "Content-Type":"application/json",
        "Access-Control-Allow-Origin":"*",
        "Access-Control-Allow-Headers":"Content-Type",
        "Access-Control-Allow-Methods":"OPTIONS,POST"
    }
    if event.get("httpMethod")=="OPTIONS":
        return {"statusCode":200,"headers":headers,"body":""}

    body = json.loads(event.get("body") or "{}")
    user = body.get("userId","anon")
    mins = int(body.get("windowMinutes",8))
    snaps = body.get("snapshots",[])
    if not snaps:
        now = int(datetime.now(timezone.utc).timestamp()*1000)
        resp = {
            "windowStart": now - mins*60_000,
            "windowEnd": now,
            "summary": "No recent activity detected.",
            "highlights": [], "nextSteps": ["Resume work"], "links": [],
            "userId": user, "ts": now
        }
        return {"statusCode":200,"headers":headers,"body":json.dumps(resp)}

    # Build with Bedrock if configured, else heuristic
    if br:
        prompt = PROMPT.format(mins=mins, snaps=json.dumps(snaps)[:6000])
        br_out = br.invoke_model(
            modelId=MODEL_ID, accept="application/json",
            contentType="application/json",
            body=json.dumps({
                "anthropic_version":"bedrock-2023-05-31",
                "max_tokens":350, "temperature":0.2,
                "messages":[{"role":"user","content":[{"type":"text","text":prompt}]}]
            })
        )
        txt = json.loads(br_out["body"].read())["content"][0]["text"]
        # try to parse JSON the model returns; if not, fall back
        try:
            parsed = json.loads(txt)
        except Exception:
            parsed = _heuristic(snaps)
    else:
        parsed = _heuristic(snaps)

    window_start = min(s["t"] for s in snaps)
    window_end   = max(s["t"] for s in snaps)
    now_ms = int(datetime.now(timezone.utc).timestamp()*1000)
    item = {
        "userId": user, "ts": now_ms,
        "summary": parsed["summary"],
        "links": parsed.get("links",[])
    }
    if table:
        ttl_sec = int((datetime.now(timezone.utc) + timedelta(hours=24)).timestamp())
        item["ttl"] = ttl_sec
        table.put_item(Item=item)

    resp = {
        "windowStart": window_start, "windowEnd": window_end,
        "userId": user, "ts": now_ms, **parsed
    }
    return {"statusCode":200,"headers":headers,"body":json.dumps(resp)}