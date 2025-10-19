# backend/common/pia_common/bedrock.py
from __future__ import annotations

import os, json, uuid, re, base64
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

import boto3

# -----------------------
# Env / config
# -----------------------
def _bool(v) -> bool:
    return str(v).lower() in {"1", "true", "yes", "on"}

USE_BEDROCK    = _bool(os.getenv("USE_BEDROCK", "false"))
BEDROCK_REGION = os.getenv("BEDROCK_REGION", os.getenv("AWS_REGION", "us-east-1"))
BEDROCK_MODEL  = os.getenv("BEDROCK_MODEL", "anthropic.claude-3-haiku-20240307-v1:0")

# -----------------------
# Small helpers
# -----------------------
def _safe_get(d: dict, *keys, default=""):
    cur = d
    for k in keys:
        if not isinstance(cur, dict):
            return default
        cur = cur.get(k)
    return default if cur is None else cur

def _active_hash(payload: Dict[str, Any]) -> str:
    return payload.get("active_url_hash") or _safe_get(payload, "tabs", 0, "url_hash", default="")

def _host(url: str) -> str:
    try:
        return urlparse(url).hostname or ""
    except Exception:
        return ""

def _extract_json_block(text: str) -> Optional[Dict[str, Any]]:
    """
    Try to parse a JSON object from an LLM response that may include extra prose
    or markdown fences.
    """
    if not isinstance(text, str):
        return None
    # 1) direct JSON
    try:
        obj = json.loads(text)
        if isinstance(obj, dict):
            return obj
    except Exception:
        pass
    # 2) fenced ```json ... ```
    m = re.search(r"```json\s*(\{.*?\})\s*```", text, flags=re.S)
    if m:
        try:
            return json.loads(m.group(1))
        except Exception:
            pass
    # 3) first {...} blob
    m = re.search(r"(\{(?:[^{}]|(?1))*\})", text, flags=re.S)
    if m:
        try:
            return json.loads(m.group(1))
        except Exception:
            pass
    return None

# -----------------------
# Prompt builders
# -----------------------
def _make_text_prompt(payload: Dict[str, Any], ocr_text: Optional[str]) -> str:
    user_id = payload.get("user_id", "")
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
        urlh  = t.get("url_hash") or t.get("url") or ""
        sample= (t.get("text_sample") or "")[:300]
        ocr   = (t.get("ocr_excerpt") or "")[:300]
        part  = f"  • [{urlh}] {title}"
        if sample: part += f" :: {sample}"
        if ocr:    part += f" :: {ocr}"
        lines.append(part)
    if ocr_text:
        lines.append("\n[OCR MERGED]")
        lines.append(ocr_text[:2000])
    lines.append("\nReturn STRICT JSON with keys: correlation_id, summary, next_actions (array of 2 items), confidence (0..1).")
    return "\n".join(lines)

def _vision_message_blocks(payload: Dict[str, Any], ocr_text: Optional[str], images: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Build Anthropic 'messages[].content' blocks combining text + up to 2 images.
    Each image item expects: {"mime": "...", "bytes": b"..."} or {"mime": "...", "b64": "..."}.
    """
    tabs = payload.get("tabs") or []
    text_parts = ["Tabs/context:"]
    for t in tabs[:6]:
        title = t.get("title", "")
        urlh  = t.get("url_hash") or t.get("url") or ""
        sample= (t.get("text_sample") or "")[:300]
        ocr   = (t.get("ocr_excerpt") or "")[:300]
        line  = f"- [{urlh}] {title}"
        if sample: line += f" :: {sample}"
        if ocr:    line += f" :: {ocr}"
        text_parts.append(line)
    if ocr_text:
        text_parts.append("\n[OCR MERGED]\n" + ocr_text[:2000])

    blocks: List[Dict[str, Any]] = [{"type": "text", "text": "\n".join(text_parts)}]
    for im in images[:2]:
        b64 = im.get("b64")
        if not b64 and "bytes" in im:
            try:
                b64 = base64.b64encode(im["bytes"]).decode("utf-8")
            except Exception:
                b64 = None
        mime = im.get("mime", "image/jpeg")
        if b64:
            blocks.append({
                "type": "image",
                "source": {"type": "base64", "media_type": mime, "data": b64}
            })
    return blocks

# -----------------------
# Bedrock invocation
# -----------------------
def _bedrock_client():
    return boto3.client("bedrock-runtime", region_name=BEDROCK_REGION)

def _call_bedrock_text(prompt: str) -> str:
    try:
        body = {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 256,
            "temperature": 0.2,
            "messages": [{"role": "user", "content": [{"type": "text", "text": prompt}]}],
        }
        resp = _bedrock_client().invoke_model(
            modelId=BEDROCK_MODEL,
            body=json.dumps(body),
            accept="application/json",
            contentType="application/json",
        )
        data = json.loads(resp["body"].read().decode("utf-8"))
        blocks = data.get("content") or []
        for b in blocks:
            if b.get("type") == "text" and b.get("text"):
                return b["text"].strip()
    except Exception:
        pass
    return ""

def _call_bedrock_vision(system: str, content_blocks: List[Dict[str, Any]]) -> str:
    try:
        body = {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 512,
            "temperature": 0.2,
            "system": system,
            "messages": [{"role": "user", "content": content_blocks}],
        }
        resp = _bedrock_client().invoke_model(
            modelId=BEDROCK_MODEL,
            body=json.dumps(body),
            accept="application/json",
            contentType="application/json",
        )
        data = json.loads(resp["body"].read().decode("utf-8"))
        blocks = data.get("content") or []
        for b in blocks:
            if b.get("type") == "text" and b.get("text"):
                return b["text"].strip()
    except Exception:
        pass
    return ""

# -----------------------
# Simple stub summary
# -----------------------
def _stub_summary(payload: Dict[str, Any], ocr_text: Optional[str]) -> Dict[str, Any]:
    tabs = payload.get("tabs") or []
    active = _active_hash(payload)
    t = next((x for x in tabs if x.get("url_hash") == active), None) or (tabs[0] if tabs else {})
    title = t.get("title") or "Current tab"
    sample = (t.get("text_sample") or "")[:140]
    if ocr_text:
        sample = (sample + " " + ocr_text[:160]).strip()
    text = f'On "{title}".'
    if sample:
        text += f" Working with: {sample}"
    target_hash = _active_hash(payload) or _safe_get(payload, "tabs", 0, "url_hash", default="")
    return {
        "correlation_id": payload.get("correlation_id") or f"c-{uuid.uuid4().hex[:8]}",
        "summary": text.strip(),
        "next_actions": [
            {"action": "open_tab", "target_url_hash": target_hash, "label": "Reopen last tab"},
            {"action": "start_timer", "label": "Start 25-min focus timer", "duration_min": 25},
        ],
        "confidence": 0.7,
    }

# -----------------------
# (Legacy) activity derivation (kept for compatibility; not used by new handler)
# -----------------------
def _derive_activities(payload: Dict[str, Any], llm_summary: str) -> Dict[str, Any]:
    tabs = payload.get("tabs") or []
    active = _active_hash(payload)

    def bucket_for(tab: Dict[str, Any]) -> str:
        title = (tab.get("title") or "").lower()
        url   = tab.get("url") or ""
        host  = _host(url)
        if "docs.google.com" in host or "notion.so" in host or "confluence" in host:
            return "Writing & Docs"
        if any(k in host for k in ["yelp.com", "tripadvisor", "airbnb", "booking.com"]):
            return "Research & Planning"
        if any(k in host for k in ["github.com", "gitlab.com", "bitbucket.org"]):
            return "Coding & Reviews"
        if any(k in host for k in ["calendar.google.com", "outlook.office.com"]):
            return "Calendar"
        if any(k in host for k in ["slack.com", "discord.com", "teams.microsoft.com"]):
            return "Comms & Chat"
        if any(k in host for k in ["mail.google.com", "outlook.live.com"]):
            return "Email"
        if any(k in host for k in ["docs", "sheet", "slides"]) or "report" in title:
            return "Writing & Docs"
        return "General Browsing"

    buckets: Dict[str, Dict[str, Any]] = {}
    for t in tabs:
        h = t.get("url_hash") or t.get("url") or ""
        b = bucket_for(t)
        if b not in buckets:
            buckets[b] = {"id": f"act-{uuid.uuid4().hex[:8]}", "label": b, "rank": 0.0, "tabs": [], "evidence": [], "summary": ""}
        buckets[b]["tabs"].append(h)
        snippet = (t.get("text_sample") or "")[:140]
        if snippet:
            buckets[b]["evidence"].append(snippet)

    for b in buckets.values():
        base = 0.4
        if active and active in (b.get("tabs") or []):
            base += 0.5
        base += min(0.1, 0.02 * len(b.get("evidence") or []))
        b["rank"] = round(min(1.0, base), 3)
        b["summary"] = (b["label"] + ": " + (llm_summary[:180] if llm_summary else "")).strip()

    acts = sorted(buckets.values(), key=lambda x: x["rank"], reverse=True)
    primary = acts[0]["id"] if acts else ""
    return {"activities": acts, "primary_activity_id": primary}

# -----------------------
# Public entry point
# -----------------------
def summarize(payload: Dict[str, Any],
              ocr_text: Optional[str] = None,
              images: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    """
    Summarize current user context.
      - If USE_BEDROCK=true and images provided => Bedrock Vision path (Claude 3 Haiku multimodal).
      - If USE_BEDROCK=true and no images      => Bedrock text path.
      - Else                                     stub summary (deterministic).
    Returns dict with: correlation_id, summary, confidence, next_actions
    (Plus legacy 'activities' & 'primary_activity_id' for compatibility.)
    """
    # ---------- STUB ----------
    if not USE_BEDROCK:
        out = _stub_summary(payload, ocr_text)
        # keep legacy compatibility fields (empty)
        out_acts = _derive_activities(payload, out["summary"])
        out.update({
            "activities": out_acts["activities"],
            "primary_activity_id": out_acts["primary_activity_id"],
        })
        return out

    # ---------- BEDROCK ----------
    corr_id = payload.get("correlation_id") or f"c-{uuid.uuid4().hex[:8]}"

    txt_only = not images
    if txt_only:
        prompt = _make_text_prompt(payload, ocr_text)
        raw_text = _call_bedrock_text(prompt)
    else:
        system = ("You summarize the user's active work context from browser tabs and screenshots. "
                  "Return STRICT JSON with keys: correlation_id, summary, next_actions (array of 2), confidence (0..1). "
                  "Keep the summary short, one sentence.")
        blocks = _vision_message_blocks(payload, ocr_text, images or [])
        raw_text = _call_bedrock_vision(system, blocks)

    obj = _extract_json_block(raw_text) if raw_text else None
    if not obj or not isinstance(obj, dict):
        # fallback to stub object but keep generated correlation id
        out = _stub_summary(payload, ocr_text)
        out["correlation_id"] = corr_id
        act_pack = _derive_activities(payload, out["summary"])
        out.update({
            "activities": act_pack["activities"],
            "primary_activity_id": act_pack["primary_activity_id"],
        })
        return out

    # sanitize and default
    target_hash = _active_hash(payload) or _safe_get(payload, "tabs", 0, "url_hash", default="")
    summary = str(obj.get("summary") or "").strip()
    if not summary:
        # minimal graceful fallback summary from tabs
        tabs = payload.get("tabs") or []
        title = (tabs[0].get("title") if tabs else "Current tab")
        summary = f'On "{title}".'

    next_actions = obj.get("next_actions") or [
        {"action": "open_tab", "target_url_hash": target_hash, "label": "Reopen last tab"},
        {"action": "start_timer", "label": "Start 25-min focus timer", "duration_min": 25},
    ]
    # ensure at least 2 actions
    if isinstance(next_actions, list) and len(next_actions) < 2:
        next_actions.append({"action": "start_timer", "label": "Start 25-min focus timer", "duration_min": 25})

    confidence = obj.get("confidence", 0.7)
    try:
        confidence = float(confidence)
    except Exception:
        confidence = 0.7

    out = {
        "correlation_id": str(obj.get("correlation_id") or corr_id),
        "summary": summary,
        "confidence": confidence,
        "next_actions": next_actions,
    }

    # legacy compatibility (not used by new ingest handler, but harmless)
    act_pack = _derive_activities(payload, summary)
    out.update({
        "activities": act_pack["activities"],
        "primary_activity_id": act_pack["primary_activity_id"],
    })
    return out