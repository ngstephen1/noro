# backend/common/pia_common/bedrock.py
from __future__ import annotations

import os, json, uuid, re
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

import boto3

# -----------------------
# Env / config
# -----------------------
USE_BEDROCK = str(os.getenv("USE_BEDROCK", "")).lower() in {"1","true","yes","on"}
BEDROCK_REGION = os.getenv("BEDROCK_REGION", os.getenv("AWS_REGION", "us-east-1"))
BEDROCK_MODEL  = os.getenv("BEDROCK_MODEL", "anthropic.claude-3-haiku-20240307-v1:0")

def _safe_get(d: dict, *keys, default=""):
    cur = d
    for k in keys:
        if not isinstance(cur, dict): return default
        cur = cur.get(k)
    return cur if cur is not None else default

def _active_hash(payload: Dict[str, Any]) -> str:
    return payload.get("active_url_hash") or _safe_get(payload, "tabs", 0, "url_hash", default="")

def _host(url: str) -> str:
    try:
        return urlparse(url).hostname or ""
    except Exception:
        return ""

def _derive_activities(payload: Dict[str, Any], llm_summary: str) -> Dict[str, Any]:
    """
    Produce activity buckets (AI-ish heuristic) and rank with active tab first.
    Returns: { "activities":[...], "primary_activity_id": "..." }
    """
    tabs = payload.get("tabs") or []
    active = _active_hash(payload)
    # bucket key = coarse intent by site/category + short title keyword
    def bucket_for(tab: Dict[str, Any]) -> str:
        title = (tab.get("title") or "").lower()
        url   = tab.get("url") or ""
        host  = _host(url)
        if "docs.google.com" in host or "notion.so" in host or "confluence" in host:
            return "Writing & Docs"
        if any(k in host for k in ["yelp.com","tripadvisor","airbnb","booking.com"]):
            return "Research & Planning"
        if any(k in host for k in ["github.com","gitlab.com","bitbucket.org"]):
            return "Coding & Reviews"
        if any(k in host for k in ["calendar.google.com","outlook.office.com"]):
            return "Calendar"
        if any(k in host for k in ["slack.com","discord.com","teams.microsoft.com"]):
            return "Comms & Chat"
        if any(k in host for k in ["mail.google.com","outlook.live.com"]):
            return "Email"
        if any(k in host for k in ["docs","sheet","slides"]) or "report" in title:
            return "Writing & Docs"
        return "General Browsing"

    buckets: Dict[str, Dict[str, Any]] = {}
    for t in tabs:
        h = t.get("url_hash") or ""
        b = bucket_for(t)
        if b not in buckets:
            buckets[b] = {"id": f"act-{uuid.uuid4().hex[:8]}",
                          "label": b,
                          "rank": 0.0,
                          "tabs": [],
                          "evidence": [],
                          "summary": ""}
        buckets[b]["tabs"].append(h)
        snippet = (t.get("text_sample") or "")[:140]
        if snippet:
            buckets[b]["evidence"].append(snippet)

    # rank heuristic: active tab’s bucket boosted to top
    # plus mild boosts by evidence length
    for b in buckets.values():
        base = 0.4
        if active and active in (b.get("tabs") or []):
            base += 0.5
        base += min(0.1, 0.02 * len(b.get("evidence") or []))
        b["rank"] = round(min(1.0, base), 3)
        # fill activity summary: brief line + hint from llm_summary when present
        b["summary"] = (b["label"] + ": " + (llm_summary[:180] if llm_summary else "")).strip()

    # sort by rank desc
    acts = sorted(buckets.values(), key=lambda x: x["rank"], reverse=True)
    primary = acts[0]["id"] if acts else ""
    return {"activities": acts, "primary_activity_id": primary}

def _make_text_prompt(payload: Dict[str, Any], ocr_text: Optional[str]) -> str:
    user_id = payload.get("user_id","")
    active  = _active_hash(payload)
    tabs    = payload.get("tabs") or []
    lines = [
        "You are a productivity assistant. Summarize what the user is working on from recent browser context:",
        f"- user_id: {user_id}",
        f"- active_url_hash: {active}",
        "- tabs:",
    ]
    for t in tabs[:6]:
        title = t.get("title") or ""
        urlh  = t.get("url_hash") or ""
        sample= (t.get("text_sample") or "")[:300]
        lines.append(f"  • [{urlh}] {title} :: {sample}")
    if ocr_text:
        lines.append("\nExtracted text from screenshots:")
        lines.append(ocr_text[:2000])
    lines.append("\nReturn a short 1–2 sentence summary focused on current task.")
    return "\n".join(lines)

def _bedrock_client():
    return boto3.client("bedrock-runtime", region_name=BEDROCK_REGION)

def _call_bedrock(prompt: str) -> str:
    """
    Minimal Anthropic Claude text call via Bedrock. (Text-only for robustness.)
    Falls back silently on any exception.
    """
    try:
        body = {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 256,
            "temperature": 0.2,
            "messages": [
                {"role": "user", "content": [{"type": "text", "text": prompt}]}
            ],
        }
        resp = _bedrock_client().invoke_model(
            modelId=BEDROCK_MODEL,
            body=json.dumps(body),
            accept="application/json",
            contentType="application/json"
        )
        data = json.loads(resp["body"].read().decode("utf-8"))
        # Anthropic response: data["content"] is a list of blocks
        blocks = data.get("content") or []
        for b in blocks:
            if b.get("type") == "text" and b.get("text"):
                return b["text"].strip()
        # fallback: maybe "output_text"
        if "output_text" in data:
            return str(data["output_text"]).strip()
    except Exception:
        pass
    return ""

def _stub_summary(payload: Dict[str, Any], ocr_text: Optional[str]) -> str:
    # Very simple deterministic line from active tab + sample text/ocr
    tabs = payload.get("tabs") or []
    active = _active_hash(payload)
    t = next((x for x in tabs if x.get("url_hash")==active), None) or (tabs[0] if tabs else {})
    title = t.get("title") or "Current tab"
    sample = (t.get("text_sample") or "")[:140]
    if ocr_text:
        sample = (sample + " " + ocr_text[:160]).strip()
    return f'On "{title}". {("Working with: " + sample) if sample else ""}'.strip()

def summarize(payload: Dict[str, Any],
              ocr_text: Optional[str] = None,
              images: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    """
    Public entry point used by Lambdas.
    Accepts optional OCR text and image list (even if currently unused in Bedrock call).
    Returns a dict containing:
      correlation_id, summary, confidence, next_actions, activities, primary_activity_id
    """
    correlation_id = payload.get("correlation_id") or f"c-{uuid.uuid4().hex[:8]}"
    prompt = _make_text_prompt(payload, ocr_text)

    if USE_BEDROCK:
        llm_text = _call_bedrock(prompt)
    else:
        llm_text = _stub_summary(payload, ocr_text)

    if not llm_text:
        llm_text = _stub_summary(payload, ocr_text)

    # Activities (ranked by active tab)
    act_pack = _derive_activities(payload, llm_text)

    # Next actions (simple, deterministic)
    target_hash = _active_hash(payload) or _safe_get(payload, "tabs", 0, "url_hash", default="")
    next_actions = [
        {"action": "open_tab", "target_url_hash": target_hash, "label": "Reopen last tab"},
        {"action": "start_timer", "label": "Start 25-min focus timer", "duration_min": 25.0},
    ]

    return {
        "correlation_id": correlation_id,
        "summary": llm_text,
        "confidence": 0.7,
        "next_actions": next_actions,
        "activities": act_pack["activities"],
        "primary_activity_id": act_pack["primary_activity_id"],
    }