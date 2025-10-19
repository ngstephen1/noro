#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="$ROOT/backend/lambdas/dist"
REQ="$ROOT/backend/lambdas/requirements.txt"

rm -rf "$OUT" && mkdir -p "$OUT"

build_fn() {
  local FN_DIR="$1"     # e.g., ingest_context  | get_insights | health
  local DIST_NAME="$2"  # e.g., dist_ingest.zip | dist_insights.zip | dist_health.zip

  local SRC="$ROOT/backend/lambdas/$FN_DIR"
  local TMP
  TMP="$(mktemp -d)"

  # bring function code
  cp -R "$SRC/"* "$TMP/"

  # vendor shared code into the root of the zip (so `import pia_common...` works)
  mkdir -p "$TMP/pia_common"
  cp -R "$ROOT/backend/common/pia_common/"*.py "$TMP/pia_common/"

  # install pure-Python deps for Lambda
  if [[ -f "$REQ" ]]; then
    python3 -m pip install -r "$REQ" -t "$TMP" --no-compile
  fi

  # create zip
  (cd "$TMP" && zip -qr "$OUT/$DIST_NAME" .)

  rm -rf "$TMP"
  echo "Built $OUT/$DIST_NAME"
}

build_fn ingest_context dist_ingest.zip
build_fn get_insights   dist_insights.zip
build_fn health         dist_health.zip