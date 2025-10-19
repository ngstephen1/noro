# backend/common/pia_common/bedrock.py
from __future__ import annotations

import json
import os
import textwrap
from typing import Any, Dict, List

try:
    import boto3  # type: ignore
    from botocore.exceptions import BotoCoreError, ClientError  # type: ignore
except Exception:  # boto3 not required for the stub
    boto3 = None
    BotoCoreError = ClientError = Exception  # type: ignore


# ---------------------------- helpers -----------------------------------------

def _first_tab(evt: Dict[str, Any]) -> Dict[str, Any]:
    tabs = evt.get("tabs") or []
    return tabs[0] if tabs and isinstance(tabs[0], dict) else {}

def _safe_str(x: Any, max_len: int = 4000) -> str:
    s = "" if x is None else str(x)
    return s[:max_len]

def _default_actions(evt: Dict[str, Any]) -> List[Dict[str, Any]]:
    tab = _first_tab(evt)
    h = _safe_str(tab.get("url_hash"), 64)
    actions: List[Dict[str, Any]] = []
    if h:
        actions.append({"action": "open_tab", "target_url_hash": h, "label": "Reopen last tab"})
    actions.append({"action": "start_timer", "label": "Start 25-min focus timer", "duration_min": 25})
    return actions

def _title_from(evt: Dict[str, Any]) -> str:
    return _safe_str(_first_tab(evt).get("title") or evt.get("active_app") or "this page", 300)

def _prompt_from(evt: Dict[str, Any]) -> str:
    """
    Build a compact prompt for Bedrock. We ask for a one-line summary only.
    We keep the output contract enforced in this module (JSON with fields).
    """
    title = _title_from(evt)
    sample = _safe_str(_first_tab(evt).get("text_sample") or "", 1200)

    prompt = textwrap.dedent(f"""
        You are a productivity assistant. The user was working just before an interruption.
        Summarize in ONE short sentence what they were doing, based strictly on the info below.
        Use plain ASCII quotes (") around the document title if you include it.
        Do NOT add bullets or extra commentary.

        CONTEXT
        - Title: {title}
        - Recent text sample (may be partial and noisy):
        {sample}

        Return ONLY a short sentence (no JSON).
    """).strip()
    return prompt


# ---------------------------- public API --------------------------------------

def summarize_stub(evt: Dict[str, Any]) -> Dict[str, Any]:
    """
    Offline / local summary generator. Never calls the network.
    """
    title = _title_from(evt)
    sample = _safe_str(_first_tab(evt).get("text_sample") or "", 140)
    bit = f" Working with: {sample}" if sample else ""
    summary = f'On "{title}".{bit}'
    return {
        "correlation_id": _safe_str(evt.get("correlation_id") or "c-local"),
        "summary": summary,
        "confidence": 0.70,
        "next_actions": _default_actions(evt),
    }


def summarize_bedrock(evt: Dict[str, Any]) -> Dict[str, Any]:
    """
    Best-effort Bedrock call. If anything fails (no creds, model blocked, region mismatch),
    we fall back to the stub so the UX keeps working.
    Configure via env:
      - PIA_BEDROCK_MODEL_ID  (default: anthropic.claude-3-sonnet-20240229-v1:0)
      - AWS_REGION            (must be where the model is available)
    """
    model_id = os.getenv("PIA_BEDROCK_MODEL_ID", "anthropic.claude-3-sonnet-20240229-v1:0")
    region = os.getenv("AWS_REGION") or os.getenv("AWS_DEFAULT_REGION") or "us-east-1"

    if boto3 is None:
        return summarize_stub(evt)

    try:
        client = boto3.client("bedrock-runtime", region_name=region)  # type: ignore
        prompt = _prompt_from(evt)

        # Prefer the modern Converse API (supported by Anthropic on Bedrock).
        try:
            resp = client.converse(
                modelId=model_id,
                messages=[{"role": "user", "content": [{"text": prompt}]}],
                inferenceConfig={"maxTokens": 256, "temperature": 0.2},
            )
            text_out = (
                resp.get("output", {})
                    .get("message", {})
                    .get("content", [{}])[0]
                    .get("text", "")
            )
        except Exception:
            # Fallback to InvokeModel with the Anthropic JSON schema.
            body = {
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 256,
                "temperature": 0.2,
                "messages": [{"role": "user", "content": [{"type": "text", "text": prompt}]}],
            }
            inv = client.invoke_model(
                modelId=model_id,
                body=json.dumps(body).encode("utf-8"),
                contentType="application/json",
                accept="application/json",
            )
            payload = json.loads(inv.get("body").read().decode("utf-8"))
            # Anthropic response shape: content: [{type:"text",text:"..."}]
            content = payload.get("content") or []
            text_out = content[0].get("text", "") if content else ""

        text_out = _safe_str(text_out, 1000).strip()
        if not text_out:
            raise RuntimeError("empty model output")

        # Build contract the rest of the app expects
        return {
            "correlation_id": _safe_str(evt.get("correlation_id") or "c-bedrock"),
            "summary": text_out,
            "confidence": 0.85,
            "next_actions": _default_actions(evt),
        }

    except (BotoCoreError, ClientError, Exception):
        # Anything goes wrong -> graceful fallback
        return summarize_stub(evt)


# ---------------------- back-compat exported names -----------------------------

def summarize_with_bedrock(evt: Dict[str, Any]) -> Dict[str, Any]:
    """Legacy name kept for older call sites."""
    return summarize_bedrock(evt)

def summarize(evt: Dict[str, Any]) -> Dict[str, Any]:
    """Legacy name sometimes imported by older code; keep pointing at the stub."""
    return summarize_stub(evt)