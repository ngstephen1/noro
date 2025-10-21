# backend/lambdas/ingest_context/handler.py
import os, json, base64, binascii, re
from collections import defaultdict
from typing import Any, Dict, List
from urllib.parse import urlparse

import boto3

from pia_common.bedrock import summarize               # real or stub (by env)
from pia_common.ddb import put_activity_summary        # writes ACT# items

# ----------------------- API Gateway helpers -------------------------------

def _parse_apigw_v2(event):
    """Accept API Gateway HTTP API v2 or raw JSON."""
    if isinstance(event, dict) and event.get("version") == "2.0" and "requestContext" in event:
        body = event.get("body")
        return json.loads(body) if isinstance(body, str) else (body or {})
    if isinstance(event, dict) and "body" in event:
        b = event["body"]
        return json.loads(b) if isinstance(b, str) else (b or {})
    return event if isinstance(event, dict) else {}

def _bool(v) -> bool:
    return str(v).lower() in {"1","true","yes","on"}

# --------------------- Screenshot normalization / OCR ----------------------

def _normalize_screenshots(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Accepts payload.screenshots as:
      [{ mime: "image/png", dataBase64: "..." }]  (preferred)
      [{ mime: "image/png", data_base64: "..." }] (legacy)
    Returns up to 2 decoded items:
      { "mime": "image/png", "bytes": b"...", "b64": "<base64>" }
    """
    out: List[Dict[str, Any]] = []
    items = payload.get("screenshots") or []
    if not isinstance(items, list):
        return out

    for it in items:
        if not isinstance(it, dict):
            continue
        mime = (it.get("mime") or "image/png").strip()
        b64  = it.get("dataBase64") or it.get("data_base64") or ""
        if not b64:
            continue
        try:
            raw = base64.b64decode(b64, validate=True)
        except (binascii.Error, ValueError):
            continue
        if len(raw) > 5 * 1024 * 1024:  # <= 5 MB
            continue
        out.append({"mime": mime, "bytes": raw, "b64": b64})
        if len(out) >= 2:
            break
    return out

def _ocr_with_textract(images: List[Dict[str, Any]]) -> str:
    """
    Optional OCR using Textract DetectDocumentText on in-memory bytes.
    Enable with env USE_TEXTRACT=true and ensure IAM allows textract:DetectDocumentText.
    """
    if not images:
        return ""
    textract = boto3.client("textract", region_name=os.getenv("AWS_REGION","us-east-1"))
    chunks: List[str] = []
    for im in images[:2]:
        try:
            resp = textract.detect_document_text(Document={"Bytes": im["bytes"]})
            lines = [b["Text"] for b in resp.get("Blocks", []) if b.get("BlockType") == "LINE" and b.get("Text")]
            if lines:
                chunks.append("\n".join(lines[:40]))
        except Exception:
            continue
    return "\n\n".join(chunks)

# -------------------------- Clustering helpers -----------------------------

_STOP = {"the","and","a","an","to","of","for","in","on","with","your","you"}

def _tokens(s: str):
    s = (s or "").lower()
    toks = re.findall(r"[a-z0-9]{2,}", s)
    return {t for t in toks if t not in _STOP}

def _root_domain(u: str):
    try:
        h = urlparse(u or "").hostname or ""
    except Exception:
        h = ""
    parts = h.split(".")
    return ".".join(parts[-2:]) if len(parts) >= 2 else h

def _app_kind(u: str, title: str):
    u = u or ""; t = (title or "").lower()
    if "docs.google.com" in u:                   return "gdocs"
    if "spreadsheets" in u or "sheets" in u:     return "gsheets"
    if "presentation" in u or "slides" in u:     return "gslides"
    if "wikipedia.org" in u:                     return "wiki"
    if "mail.google.com" in u or "gmail" in t:   return "gmail"
    return "web"

def _sim(a, b):
    # 0..1 similarity using app+domain + Jaccard over title/sample tokens
    score = 0.0
    if a["root"] and a["root"] == b["root"] and a["kind"] == b["kind"]:
        score += 0.5
    def jac(x,y):
        if not x or not y: return 0.0
        inter = len(x & y); union = len(x | y)
        return inter/union if union else 0.0
    score += 0.3 * jac(a["title_tokens"], b["title_tokens"])
    score += 0.2 * jac(a["sample_tokens"], b["sample_tokens"])
    return min(score, 1.0)

def _featurize_tabs(tabs: List[Dict[str,Any]]):
    feats = []
    for i, t in enumerate(tabs):
        u = t.get("url") or t.get("url_hash","")
        title = t.get("title","")
        sample = (t.get("text_sample") or "") + " " + (t.get("ocr_excerpt") or "")
        feats.append({
            "i": i,
            "root": _root_domain(u),
            "kind": _app_kind(u, title),
            "title_tokens": _tokens(title),
            "sample_tokens": _tokens(sample),
        })
    return feats

def _cluster_tabs_idx(tabs: List[Dict[str,Any]]):
    """Single-link clustering with a simple similarity threshold."""
    feats = _featurize_tabs(tabs)
    n = len(feats)
    parent = list(range(n))
    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    def union(a,b):
        ra, rb = find(a), find(b)
        if ra != rb: parent[rb] = ra
    THRESH = 0.55
    for i in range(n):
        for j in range(i+1, n):
            if _sim(feats[i], feats[j]) >= THRESH:
                union(i,j)
    buckets = defaultdict(list)
    for idx in range(n):
        buckets[find(idx)].append(idx)
    return list(buckets.values()) if buckets else [[0]]

# -------------------------- AI label helper --------------------------------

def _ai_label_from_text(text: str) -> str:
    """
    Very short (2–4 words) Title-Case label for an activity.
    Uses Bedrock if enabled, else a heuristic.
    """
    use_bedrock = _bool(os.getenv("USE_BEDROCK", "false"))
    label = ""
    if use_bedrock:
        try:
            client = boto3.client("bedrock-runtime", region_name=os.getenv("BEDROCK_REGION","us-east-1"))
            model  = os.getenv("BEDROCK_MODEL","anthropic.claude-3-haiku-20240307-v1:0")
            prompt = (
                "Create a very short label (2-4 words, Title Case, no punctuation) for this task context.\n"
                "Return strictly JSON: {\"label\": \"...\"}\n\n"
                f"CONTEXT:\n{text[:2000]}"
            )
            body = {
                "anthropic_version":"bedrock-2023-05-31",
                "max_tokens": 64,
                "temperature": 0.2,
                "messages":[{"role":"user","content":[{"type":"text","text":prompt}]}]
            }
            resp = client.invoke_model(modelId=model, body=json.dumps(body))
            raw  = json.loads(resp["body"].read())
            txt  = raw["content"][0]["text"]
            try:
                label = json.loads(txt).get("label","")
            except Exception:
                label = (txt or "").splitlines()[0].strip()
        except Exception:
            label = ""
    if not label:
        # heuristic: first 3 capitalized keywords
        toks = [t.capitalize() for t in list(_tokens(text))[:3]]
        label = " ".join(toks) or "Activity"
    label = re.sub(r"[^A-Za-z0-9 ]+","", label).strip().title()
    return label or "Activity"

# ------------------------------- Handler -----------------------------------

def handler(event, context):
    try:
        payload = _parse_apigw_v2(event)

        # Minimal defaults
        payload.setdefault("user_id", "dev-user")
        payload.setdefault("ts", "")
        payload.setdefault("event", "manual_capture")
        payload.setdefault("active_app", "chrome")
        tabs = payload.get("tabs") or []
        if not tabs:
            tabs = [{"title": payload.get("active_app",""), "url_hash":"", "text_sample":""}]
            payload["tabs"] = tabs

        # Identify active tab (prefer explicit hash if provided)
        active_hash = payload.get("active_url_hash") or (tabs[0].get("url_hash") if tabs else "")
        active_idx = 0
        for i, t in enumerate(tabs):
            if active_hash and t.get("url_hash") == active_hash:
                active_idx = i
                break

        # ---- Screenshots & optional OCR
        images = _normalize_screenshots(payload)
        ocr_text = _ocr_with_textract(images) if _bool(os.getenv("USE_TEXTRACT")) else ""

        # ---- Cluster tabs into activities
        clusters_idx = _cluster_tabs_idx(tabs) if len(tabs) > 1 else [[0]]
        activities: List[Dict[str, Any]] = []

        # Summarize each cluster; build activity objects
        for idxs in clusters_idx:
            cl_tabs = [tabs[i] for i in idxs]
            is_active = active_idx in idxs

            # Summarize cluster (LLM can use titles + text samples + OCR; images optional)
            cluster_payload = {
                "user_id": payload["user_id"],
                "event": payload.get("event","manual_capture"),
                "tabs": cl_tabs,
                "active_cluster": is_active
            }
            summ = summarize(cluster_payload, ocr_text=ocr_text, images=images)
            # Create short AI label
            label_src = " ".join([t.get("title","") for t in cl_tabs]) + " " + summ.get("summary","")
            label = _ai_label_from_text(label_src)

            activities.append({
                "activity_id":   summ["correlation_id"],
                "label":         label,
                "tab_count":     len(cl_tabs),
                "is_active":     is_active,
                "summary":       summ.get("summary",""),
                "next_actions":  summ.get("next_actions", []),
                "confidence":    float(summ.get("confidence", 0.7)),
                "tab_hashes":    [t.get("url_hash","") for t in cl_tabs],
            })

        # ---- Prioritize: active first, then by cluster size desc
        activities.sort(key=lambda a: (not a["is_active"], -a["tab_count"]))
        # assign ranks after sorting
        for r, a in enumerate(activities):
            a["rank"] = r

        # ---- Persist activities to DDB (no images stored)
        table = os.getenv("DDB_TABLE")
        if table:
            for a in activities:
                put_activity_summary(
                    user_id=payload["user_id"],
                    activity_id=a["activity_id"],
                    ts_iso=payload.get("ts",""),
                    label=a["label"],
                    summary_text=a["summary"],
                    confidence=a["confidence"],
                    next_actions=a["next_actions"],
                    tab_hashes=a["tab_hashes"],
                    is_active=a["is_active"],
                    rank=a["rank"],
                    ttl_days=30,
                )

        # ---- Respond immediately with ranked activities
        return {
            "statusCode": 200,
            "headers": {
                "content-type": "application/json",
                "access-control-allow-origin": "*"
            },
            "body": json.dumps({
                "ok": True,
                "primary_activity_id": activities[0]["activity_id"] if activities else None,
                "activities": activities
            })
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