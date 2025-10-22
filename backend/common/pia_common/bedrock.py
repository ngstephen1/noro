# backend/common/pia_common/bedrock.py
from __future__ import annotations

import os, json, uuid, re, base64
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

import boto3

# ---------------------------------------------------------------------
# Env / config
# ---------------------------------------------------------------------

def _bool(v) -> bool:
    return str(v).lower() in {"1", "true", "yes", "on"}

USE_BEDROCK          = _bool(os.getenv("USE_BEDROCK", "false"))
BEDROCK_REGION       = os.getenv("BEDROCK_REGION", os.getenv("AWS_REGION", "us-east-1"))

# Prefer Claude 4.5 Sonnet; fall back to Haiku 3 if not allowed.
_DEFAULT_MODELS = [
    "anthropic.claude-sonnet-4.5-20250929-v1:0",
    "anthropic.claude-3-haiku-20240307-v1:0",
]
BEDROCK_MODEL        = os.getenv("BEDROCK_MODEL") or _DEFAULT_MODELS[0]

# Optional analytics model (Nova Pro) for pattern tips (non-blocking)
BEDROCK_ANALYTICS_MODEL = os.getenv("BEDROCK_ANALYTICS_MODEL", "amazon.nova-pro-v1:0")

# Summary style controls (read directly by this module; no handler changes needed)
SUMMARY_STYLE        = os.getenv("SUMMARY_STYLE", "concise")       # concise | balanced | detailed
SUMMARY_MAX_CHARS    = int(os.getenv("SUMMARY_MAX_CHARS", "110"))  # char cap for summary
NEXT_ACTIONS_COUNT   = int(os.getenv("NEXT_ACTIONS_COUNT", "2"))   # how many to return (min 2)

# ---------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------

def _safe_get(d: dict, *keys, default=""):
    cur = d
    for k in keys:
        if not isinstance(cur, dict):
            return default
        cur = cur.get(k)
    return default if cur is None else cur

def _active_hash(payload: Dict[str, Any]) -> str:
    return (
        payload.get("active_url_hash")
        or _safe_get(payload, "tabs", 0, "url_hash", default=_safe_get(payload, "tabs", 0, "url", default=""))
        or ""
    )

def _host(url: str) -> str:
    try:
        return urlparse(url).hostname or ""
    except Exception:
        return ""

def _extract_json_block(text: str) -> Optional[Dict[str, Any]]:
    """Try to parse a JSON object from an LLM response that may include extra prose or code fences."""
    if not isinstance(text, str):
        return None
    # direct JSON
    try:
        obj = json.loads(text)
        if isinstance(obj, dict):
            return obj
    except Exception:
        pass
    # ```json ... ```
    m = re.search(r"```json\s*(\{.*?\})\s*```", text, flags=re.S)
    if m:
        try:
            return json.loads(m.group(1))
        except Exception:
            pass
    # first {...} blob
    m = re.search(r"(\{(?:[^{}]|(?1))*\})", text, flags=re.S)
    if m:
        try:
            return json.loads(m.group(1))
        except Exception:
            pass
    return None

# ---------------------------------------------------------------------
# Content analysis helpers (used for insights + tags)
# ---------------------------------------------------------------------

STOP = {"the","and","a","an","to","of","for","in","on","with","your","you","are","is"}

def _tokens(s: str) -> List[str]:
    s = (s or "").lower()
    toks = re.findall(r"[a-z0-9]{2,}", s)
    return [t for t in toks if t not in STOP]

def _kind_from_url_or_title(url: str, title: str) -> str:
    u = url or ""; t = (title or "").lower()
    h = _host(u)
    if "docs.google.com" in h or "doc" in t:               return "docs"
    if "sheets" in u or "spreadsheets" in u or "sheet" in t: return "sheets"
    if "slides" in u or "presentation" in t:               return "slides"
    if "mail.google.com" in h or "gmail" in t or "outlook" in h: return "email"
    if "calendar.google.com" in h:                         return "calendar"
    if any(k in h for k in ["github.com","gitlab.com","bitbucket.org"]): return "code"
    if any(k in h for k in ["aws.amazon.com","console.aws.amazon.com"]): return "cloud"
    return "web"

def _pattern_insights(tabs: List[Dict[str, Any]]) -> List[str]:
    """Very lightweight patterns/trends from current snapshot (non-invasive)."""
    if not tabs:
        return []
    kinds = [_kind_from_url_or_title(t.get("url") or t.get("url_hash",""), t.get("title","")) for t in tabs]
    kind_counts: Dict[str,int] = {}
    for k in kinds:
        kind_counts[k] = kind_counts.get(k,0) + 1
    distinct = len(kind_counts)
    tips: List[str] = []

    # Context switching heuristic
    total = len(tabs)
    if total >= 6 and distinct >= 3:
        tips.append("High context switching — cluster tabs by project and timebox 25–30 min blocks.")

    # Docs + Email frequent pairing
    if kind_counts.get("docs",0) >= 1 and kind_counts.get("email",0) >= 1:
        tips.append("You often bounce between docs and email — batch replies to protect focus.")

    # Sheets heavy sessions
    if kind_counts.get("sheets",0) >= 3:
        tips.append("Spreadsheet-heavy session — set a clear 'done' checkpoint (e.g., update KPI cells).")

    # Cloud/dev sessions
    if kind_counts.get("cloud",0) + kind_counts.get("code",0) >= 3:
        tips.append("Technical session — capture a short log line of 'next step' to speed resumption later.")

    return tips[:2]  # keep it tight

# ---------------------------------------------------------------------
# Summarization style: make it short & telegraphic
# ---------------------------------------------------------------------

def _telegraphify(line: str, max_chars: int) -> str:
    """
    Normalize the line:
    - remove leading 'The user (is|appears to be|seems to be)'
    - remove hedging ('likely', 'probably', 'appears')
    - convert to imperative/gerund fragments where possible
    - cap length and add … if needed
    """
    s = (line or "").strip()

    # strip boilerplate starts
    s = re.sub(r"^\s*(the\s+user\s+)(is|appears\s+to\s+be|seems\s+to\s+be)\s+", "", s, flags=re.I)
    s = re.sub(r"\b(user|they)\s+(are|is)\s+", "", s, flags=re.I)
    # remove hedges
    s = re.sub(r"\b(likely|probably|possibly|appears|seems|suggests|may be)\b[\s,]*", "", s, flags=re.I)
    # collapse whitespace
    s = re.sub(r"\s+", " ", s).strip()
    # prefer single sentence
    s = s.split("\n")[0]
    s = re.split(r"(?<=[.!?])\s+", s)[0]
    # trim trailing punctuation
    s = s.strip(" .")
    # cap length
    if len(s) > max_chars:
        s = s[: max(0, max_chars - 1)].rstrip()
        s += "…"
    return s

def _cap_actions(actions: List[Dict[str,Any]], want: int) -> List[Dict[str,Any]]:
    out = []
    for a in actions or []:
        if not isinstance(a, dict): 
            continue
        # minimal sanitize
        label = str(a.get("label") or "").strip()
        if len(label) > 60:
            label = label[:57] + "…"
        v = {"action": a.get("action",""), "label": label}
        if "target_url_hash" in a and a["target_url_hash"] is not None:
            v["target_url_hash"] = a["target_url_hash"]
        if "duration_min" in a and a["duration_min"] is not None:
            v["duration_min"] = a["duration_min"]
        out.append(v)
        if len(out) >= want:
            break
    return out

# Backward‑compatible helper kept for callers that import it
def _cleanup_oneliner(s: str) -> str:
    return _telegraphify(s, SUMMARY_MAX_CHARS)

# ---------------------------------------------------------------------
# Prompt builders
# ---------------------------------------------------------------------

def _make_text_prompt(payload: Dict[str, Any], ocr_text: Optional[str]) -> str:
    """
    Aimed at concise, telegraphic output. We instruct strictly on JSON + style.
    """
    user_id = payload.get("user_id", "")
    active  = _active_hash(payload)
    tabs    = payload.get("tabs") or []

    def tab_line(t: Dict[str,Any]) -> str:
        title = t.get("title") or ""
        urlh  = t.get("url_hash") or t.get("url") or ""
        sample= (t.get("text_sample") or "")[:300]
        ocr   = (t.get("ocr_excerpt") or "")[:300]
        parts = [f"[{urlh}] {title}"]
        if sample: parts.append(sample)
        if ocr:    parts.append(ocr)
        return " :: ".join(parts)

    lines = [
        "ROLE: You are an assistant that writes ultra-concise activity summaries for a productivity app.",
        "GOAL: Capture the user's *current* task context in <= 2 clauses (telegraphic style).",
        "STYLE RULES:",
        "- Do NOT start with 'The user ...' or hedges (likely, appears).",
        "- Use imperative/gerund fragments (e.g., 'Reviewing contract draft; update section 3').",
        f"- Hard cap length at {SUMMARY_MAX_CHARS} characters.",
        "OUTPUT: return STRICT JSON with the keys exactly:",
        '{ "correlation_id": "<string>", "summary": "<string>", "next_actions": [ { ... }, { ... } ], "confidence": <float 0..1> }',
        "NEXT ACTIONS: Provide exactly two helpful, deterministic hints (short labels).",
        "AVAILABLE CONTEXT:",
        f"- user_id: {user_id}",
        f"- active_url_hash: {active}",
        "- tabs:",
    ]
    for t in tabs[:8]:
        lines.append("  • " + tab_line(t))
    if ocr_text:
        lines.append("\nOCR_EXTRACT (trimmed):\n" + ocr_text[:1500])

    return "\n".join(lines)

def _vision_message_blocks(payload: Dict[str, Any], ocr_text: Optional[str], images: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Anthropic images + text blocks (max 2 images)."""
    tabs = payload.get("tabs") or []
    text_parts = [
        "Summarize current task concisely; JSON only; no preamble; two next actions; no 'The user ...'; cap length.",
        f"Hard length cap: {SUMMARY_MAX_CHARS} chars.",
        "Tabs/context:"
    ]
    for t in tabs[:8]:
        title = t.get("title", "")
        urlh  = t.get("url_hash") or t.get("url") or ""
        sample= (t.get("text_sample") or "")[:300]
        ocr   = (t.get("ocr_excerpt") or "")[:300]
        line  = f"- [{urlh}] {title}"
        if sample: line += f" :: {sample}"
        if ocr:    line += f" :: {ocr}"
        text_parts.append(line)
    if ocr_text:
        text_parts.append("\nOCR_EXTRACT:\n" + ocr_text[:1500])

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
            blocks.append({"type":"image","source":{"type":"base64","media_type":mime,"data":b64}})
    return blocks

# ---------------------------------------------------------------------
# Bedrock clients
# ---------------------------------------------------------------------

def _bedrock_client():
    return boto3.client("bedrock-runtime", region_name=BEDROCK_REGION)

def _is_nova(model_id: str) -> bool:
    return str(model_id).startswith("amazon.nova")

# Nova needs Converse API
def _converse_content_blocks(text: str, images: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    blocks: List[Dict[str, Any]] = []
    if text:
        blocks.append({"text": text})
    for im in images[:2]:
        raw = im.get("bytes")
        if not raw:
            b64 = im.get("b64")
            if b64:
                try:
                    raw = base64.b64decode(b64)
                except Exception:
                    raw = None
        if not raw:
            continue
        fmt = "jpeg"
        m = (im.get("mime","") or "").lower()
        if "png" in m:  fmt = "png"
        if "webp" in m: fmt = "webp"
        blocks.append({"image": {"format": fmt, "source": {"bytes": raw}}})
    return blocks

# ---------------------------------------------------------------------
# Bedrock calls
# ---------------------------------------------------------------------

def _call_bedrock_converse(model_id: str, text: str, images: Optional[List[Dict[str, Any]]]=None, max_tokens=384) -> str:
    try:
        client = _bedrock_client()
        content = _converse_content_blocks(text, images or [])
        resp = client.converse(
            modelId=model_id,
            messages=[{"role": "user", "content": content}],
            inferenceConfig={"maxTokens": max_tokens, "temperature": 0.2},
        )
        msg = (resp.get("output", {}) or {}).get("message", {})
        for p in (msg.get("content") or []):
            if "text" in p and p["text"]:
                return p["text"].strip()
    except Exception:
        pass
    return ""

def _call_bedrock_anthropic_text(model_id: str, prompt: str, max_tokens=320) -> str:
    try:
        body = {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": max_tokens,
            "temperature": 0.2,
            "system": (
                "You are Noro’s summarizer for a productivity extension. "
                "Return only STRICT JSON (no prose, no markdown). "
                f"Write a concise present‑tense one‑liner (≤{SUMMARY_MAX_CHARS} chars) that captures the primary task, "
                "starting with a verb or noun phrase (never 'The user'). "
                "Avoid hedging. Keep it specific and readable. "
                "Use exactly two next_actions: "
                "[open_tab -> target_url_hash, start_timer -> duration_min=25]. "
                "Set confidence in [0.0,1.0]. Do not include PII."
            ),
            "messages": [{"role": "user", "content": [{"type":"text","text": prompt}]}],
        }
        resp = _bedrock_client().invoke_model(
            modelId=model_id,
            body=json.dumps(body),
            accept="application/json",
            contentType="application/json",
        )
        data = json.loads(resp["body"].read().decode("utf-8"))
        for b in (data.get("content") or []):
            if b.get("type") == "text" and b.get("text"):
                return b["text"].strip()
    except Exception:
        pass
    return ""

def _call_bedrock_anthropic_vision(model_id: str, system: str, blocks: List[Dict[str, Any]], max_tokens=512) -> str:
    try:
        body = {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": max_tokens, "temperature": 0.2,
            "system": system,
            "messages": [{"role":"user","content": blocks}],
        }
        resp = _bedrock_client().invoke_model(
            modelId=model_id, body=json.dumps(body),
            accept="application/json", contentType="application/json")
        data = json.loads(resp["body"].read().decode("utf-8"))
        for b in (data.get("content") or []):
            if b.get("type") == "text" and b.get("text"):
                return b["text"].strip()
    except Exception:
        pass
    return ""

# ---------------------------------------------------------------------
# Stub fallback
# ---------------------------------------------------------------------

def _stub_summary(payload: Dict[str, Any], ocr_text: Optional[str]) -> Dict[str, Any]:
    tabs = payload.get("tabs") or []
    active = _active_hash(payload)
    t = next((x for x in tabs if (x.get("url_hash") or x.get("url","")) == active), None) or (tabs[0] if tabs else {})
    title = t.get("title") or "Current tab"
    sample = (t.get("text_sample") or "")[:140]
    if ocr_text:
        sample = (sample + " " + ocr_text[:160]).strip()
    summary = f'{title}: {sample}' if sample else f'Working in {title}'
    summary = _telegraphify(summary, SUMMARY_MAX_CHARS)

    target_hash = _active_hash(payload) or _safe_get(payload, "tabs", 0, "url_hash", default="")
    return {
        "correlation_id": payload.get("correlation_id") or f"c-{uuid.uuid4().hex[:8]}",
        "summary": summary,
        "next_actions": [
            {"action": "open_tab", "target_url_hash": target_hash, "label": "Reopen last tab"},
            {"action": "start_timer", "label": "Start 25-min focus timer", "duration_min": 25},
        ],
        "confidence": 0.7,
        "insight_bullets": _pattern_insights(tabs),
        "tags": list({ _kind_from_url_or_title(t.get("url") or t.get("url_hash",""), t.get("title","")) for t in tabs })[:4],
    }

# ---------------------------------------------------------------------
# (Legacy) activity derivation (kept for compatibility; not used by new handler)
# ---------------------------------------------------------------------

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

# ---------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------

def summarize(payload: Dict[str, Any],
              ocr_text: Optional[str] = None,
              images: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    """
    Summarize current user context.
      - If USE_BEDROCK=true and images provided => Bedrock Vision path (Anthropic multimodal or Nova converse).
      - If USE_BEDROCK=true and no images      => Bedrock text path.
      - Else                                     stub summary (deterministic).
    Returns dict with: correlation_id, summary, confidence, next_actions
    (Plus non-breaking: insight_bullets, tags; and legacy 'activities' & 'primary_activity_id'.)
    """
    # ---------- STUB ----------
    if not USE_BEDROCK:
        return _stub_summary(payload, ocr_text)

    # ---------- BEDROCK ----------
    corr_id = payload.get("correlation_id") or f"c-{uuid.uuid4().hex[:8]}"

    txt_only = not images
    prompt = _make_text_prompt(payload, ocr_text)

    if _is_nova(BEDROCK_MODEL):
        raw_text = _call_bedrock_converse(BEDROCK_MODEL, prompt, images=None if txt_only else images)
    else:
        if txt_only:
            raw_text = _call_bedrock_anthropic_text(BEDROCK_MODEL, prompt)
        else:
            system = (
                f"You write concise task summaries. JSON only. Two next actions. Cap at {SUMMARY_MAX_CHARS} chars. "
                "No 'The user ...' or hedges."
            )
            blocks = _vision_message_blocks(payload, ocr_text, images or [])
            raw_text = _call_bedrock_anthropic_vision(BEDROCK_MODEL, system, blocks)

    obj = _extract_json_block(raw_text) if raw_text else None
    if not obj or not isinstance(obj, dict):
        out = _stub_summary(payload, ocr_text)
        out["correlation_id"] = corr_id
        # legacy compatibility
        act_pack = _derive_activities(payload, out["summary"])
        out.update({
            "activities": act_pack["activities"],
            "primary_activity_id": act_pack["primary_activity_id"],
        })
        return out

    # sanitize and default
    tabs        = payload.get("tabs") or []
    target_hash = _active_hash(payload) or _safe_get(payload, "tabs", 0, "url_hash", default="")

    summary = _telegraphify(str(obj.get("summary") or ""), SUMMARY_MAX_CHARS)
    if not summary:
        title = (tabs[0].get("title") if tabs else "Current tab") or "Current work"
        summary = _telegraphify(f"Working in {title}", SUMMARY_MAX_CHARS)

    actions_in  = obj.get("next_actions") or []
    actions     = _cap_actions(actions_in, max(NEXT_ACTIONS_COUNT, 2))
    if len(actions) < 2:
        actions.append({"action":"start_timer","label":"Start 25-min focus timer","duration_min":25})

    conf = obj.get("confidence", 0.7)
    try:
        conf = float(conf)
    except Exception:
        conf = 0.7
    conf = max(0.0, min(1.0, conf))

    # lightweight tags/insights (won’t break anything if ignored)
    insights = obj.get("insight_bullets") or _pattern_insights(tabs)
    tags     = obj.get("tags") or list({ _kind_from_url_or_title(t.get("url") or t.get("url_hash",""), t.get("title","")) for t in tabs })[:4]

    out = {
        "correlation_id": str(obj.get("correlation_id") or corr_id),
        "summary": summary,
        "confidence": conf,
        "next_actions": actions,
        "insight_bullets": insights,
        "tags": tags,
    }

    # legacy compatibility (not used by new ingest handler, but harmless)
    act_pack = _derive_activities(payload, summary)
    out.update({
        "activities": act_pack["activities"],
        "primary_activity_id": act_pack["primary_activity_id"],
    })
    return out