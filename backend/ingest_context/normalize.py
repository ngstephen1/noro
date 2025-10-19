# backend/ingest_context/normalize.py
from __future__ import annotations
from typing import Any, Dict, List
import hashlib, datetime

def _hash_url(url: str) -> str:
    if not url:
        return ""
    return hashlib.md5(url.encode("utf-8")).hexdigest()[:8]

def _iso_from_ms(ms: int | None) -> str:
    if not ms:
        return datetime.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
    return datetime.datetime.utcfromtimestamp(ms / 1000).replace(microsecond=0).isoformat() + "Z"

def _extract_text_from_tab(t: Dict[str, Any]) -> str:
    # Prefer structured data; fallback to title
    ty = (t.get("type") or "").lower()
    d  = t.get("data") or {}
    if ty == "google-sheets":
        rng = d.get("selectedRange") or d.get("activeCell") or ""
        sheet = d.get("activeSheet") or ""
        return f"{sheet} {rng}".strip() or t.get("title","")
    if ty == "google-docs":
        pos = d.get("cursorPos") or d.get("section") or ""
        return f"{pos}".strip() or t.get("title","")
    if ty == "google-slides":
        slide = d.get("slideNumber") or ""
        return f"Slide {slide}".strip() or t.get("title","")
    if ty == "gmail":
        subj = d.get("subject") or ""
        return subj or t.get("title","")
    # generic page
    return t.get("title","")

def normalize_to_internal(body: Dict[str, Any]) -> Dict[str, Any]:
    """
    Returns the compact 'internal' event our process_context already consumes:
    {
      correlation_id, user_id, ts, event, active_app, tabs:[{title,url_hash,text_sample}], signals, privacy
    }
    """
    # Already internal?
    if "tabs" in body and "user_id" in body:
        return body

    # New rich schema (your sample)
    if "sessionId" in body and "windows" in body:
        windows: List[Dict[str, Any]] = body.get("windows") or []
        first_w = windows[0] if windows else {}
        tabs: List[Dict[str, Any]] = []
        for t in (first_w.get("tabs") or []):
            tabs.append({
                "title": t.get("title",""),
                "url_hash": _hash_url(t.get("url","")),
                "text_sample": _extract_text_from_tab(t),
                "meta": {
                    "type": t.get("type"),
                    "data": t.get("data") or {}
                }
            })
        internal = {
            "correlation_id": body.get("sessionId"),
            "user_id": body.get("userId") or "dev-user",
            "ts": _iso_from_ms(body.get("timestamp")),
            "event": f"interruption:{body.get('interruptionType','unknown')}",
            "active_app": (tabs[0].get("meta") or {}).get("type","") if tabs else "",
            "tabs": tabs,
            "signals": {},  # we can map more later
            "privacy": {"redacted": True, "allowlist": []}
        }
        return internal

    raise ValueError("Unrecognized context payload shape")