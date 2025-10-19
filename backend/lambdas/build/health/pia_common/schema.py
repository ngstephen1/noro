# backend/common/pia_common/schema.py
from __future__ import annotations
from typing import Any, Dict, List

def _err(msg: str) -> None:
    raise ValueError(f"Schema validation failed: {msg}")

def _req(d: dict, key: str, path: str) -> None:
    if key not in d:
        _err(f"{path}.{key}: required")

def validate(kind: str, data: Dict[str, Any]) -> bool:
    """
    Minimal, jsonschema-free validation just to catch obvious bad inputs.
    """
    if not isinstance(data, dict):
        _err("$. must be an object")

    if kind == "context_event":
        for k in ["user_id", "ts", "event", "active_app", "tabs", "signals", "privacy", "correlation_id"]:
            _req(data, k, "$")

        allowed = {"manual_capture", "interrupt_detected", "periodic"}
        if data["event"] not in allowed:
            _err("$.event: must be one of " + str(sorted(allowed)))

        # tabs
        tabs = data.get("tabs", [])
        if not isinstance(tabs, list):
            _err("$.tabs: must be an array")
        for i, t in enumerate(tabs):
            if not isinstance(t, dict):
                _err(f"$.tabs[{i}]: must be an object")
            for k in ["title", "url_hash", "text_sample"]:
                _req(t, k, f"$.tabs[{i}]")

        # signals
        sig = data.get("signals", {})
        if not isinstance(sig, dict):
            _err("$.signals: must be an object")

        # privacy
        priv = data.get("privacy", {})
        if not isinstance(priv, dict):
            _err("$.privacy: must be an object")

        return True

    if kind == "session_summary":
        for k in ["summary", "confidence", "next_actions", "correlation_id"]:
            _req(data, k, "$")
        if not isinstance(data["next_actions"], list):
            _err("$.next_actions: must be an array")
        return True

    # Unknown kind: accept for MVP
    return True