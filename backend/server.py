from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
import time

app = FastAPI(title="Noro Local API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"],
)

class Snapshot(BaseModel):
    t: int
    url: str
    app: str
    signals: Dict[str, Any] = Field(default_factory=dict)

class SummarizeReq(BaseModel):
    userId: str = "dev"
    windowMinutes: int = 8
    snapshots: List[Snapshot] = Field(default_factory=list)

@app.post("/summarize")
def summarize(body: SummarizeReq):
    snaps = sorted(body.snapshots, key=lambda s: s.t)
    if not snaps:
        now = int(time.time() * 1000)
        return {
            "windowStart": now - body.windowMinutes * 60_000,
            "windowEnd": now,
            "summary": "No recent activity detected.",
            "highlights": [],
            "nextSteps": ["Resume where you left off"],
            "links": [],
            "userId": body.userId,
            "ts": now,
        }

    # naive local summary (no LLM) – good enough for dev
    latest = snaps[-1]
    title = latest.signals.get("title") or latest.url.split("/")[2]
    app = latest.app
    path = " › ".join(latest.signals.get("headingPath", [])[:3])
    cursor = (latest.signals.get("cursorText") or "")[:80]

    highlights = []
    if app == "gdocs":
        highlights.append(f"Edited **{path or 'document'}** in **{title}** (Docs).")
        if cursor: highlights.append(f"Cursor near: “{cursor}”")
    elif app == "gsheets":
        rng = latest.signals.get("activeRange") or "active range"
        highlights.append(f"Updated **{title}** (Sheets), {rng}.")
    elif app == "gslides":
        slide = latest.signals.get("slide") or "current slide"
        highlights.append(f"Worked on **{title}** (Slides), {slide}.")
    elif app == "gmail":
        subj = latest.signals.get("subject") or "email"
        mode = latest.signals.get("mode") or "read"
        highlights.append(f"{mode.capitalize()} **{subj}** in Gmail.")
    else:
        progress = latest.signals.get("progress")
        if progress is not None:
            highlights.append(f"Reading **{title}** (~{progress}%).")
        else:
            highlights.append(f"Browsing **{title}**.")

    next_steps = ["Pick up where you stopped", "Jot the next subtask"]
    links = [{"label": f"Open {title}", "url": latest.url}]

    return {
        "windowStart": snaps[0].t,
        "windowEnd": snaps[-1].t,
        "summary": " ".join(highlights)[:220],
        "highlights": highlights,
        "nextSteps": next_steps,
        "links": links,
        "userId": body.userId,
        "ts": int(time.time() * 1000),
    }