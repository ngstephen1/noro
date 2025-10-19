# backend/common/pia_common/schema.py
import json, os
from pathlib import Path

# jsonschema compatibility across versions
try:
    from jsonschema import Draft202012Validator as Validator
except Exception:
    try:
        from jsonschema import Draft2020Validator as Validator
    except Exception:
        from jsonschema import Draft7Validator as Validator

_validators = {}

def _schemas_dir() -> Path:
    env = os.getenv("SCHEMAS_DIR")
    if env:
        return Path(env)
    here = Path(__file__).resolve()
    for parent in [here] + list(here.parents):
        cand = parent / "shared" / "schemas"
        if cand.exists():
            return cand
    return Path.cwd() / "shared" / "schemas"

def _get_validator(kind: str):
    v = _validators.get(kind)
    if v:
        return v
    path = _schemas_dir() / f"{kind}.schema.json"
    with open(path, "r", encoding="utf-8") as f:
        schema = json.load(f)
    v = Validator(schema)
    _validators[kind] = v
    return v

def validate(kind: str, payload: dict) -> None:
    v = _get_validator(kind)
    errors = sorted(v.iter_errors(payload), key=lambda e: list(e.path))
    if errors:
        lines = []
        for e in errors[:5]:
            path = "$" if not list(e.path) else "$." + ".".join(map(str, e.path))
            lines.append(f"{path}: {e.message}")
        more = "" if len(errors) <= 5 else f" (+{len(errors)-5} more)"
        raise ValueError("Schema validation failed: " + "; ".join(lines) + more)