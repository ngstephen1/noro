from typing import Dict, Any

def summarize_stub(context_event: Dict[str, Any]) -> Dict[str, Any]:
    tabs = context_event.get("tabs", [])
    first = tabs[0] if tabs else {}
    title = (first.get("title") or "").strip()
    sample = (first.get("text_sample") or "").strip()
    url_hash = first.get("url_hash") or ""

    parts = []
    if title:
        parts.append(f"On “{title}”.")
    if sample:
        parts.append(f"Working with: {sample[:140]}")
    if not parts:
        parts.append("Reviewing your active tab.")

    summary = " ".join(parts)
    confidence = 0.85 if sample else 0.7

    next_actions = [{"label": "Start 25-min focus timer", "action": "start_timer", "duration_min": 25}]
    if url_hash:
        next_actions.insert(0, {"label": "Reopen last tab", "action": "open_tab", "target_url_hash": url_hash})

    return {
        "correlation_id": context_event.get("correlation_id", ""),
        "summary": summary,
        "confidence": confidence,
        "next_actions": next_actions,
    }
