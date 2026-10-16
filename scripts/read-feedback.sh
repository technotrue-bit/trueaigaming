#!/usr/bin/env bash
# List and print TrueAIGaming feedback submissions from the private Blob store.
# Requires a logged-in vercel CLI with access to scope true-team2 and the
# linked trueaigaming project (OIDC). Never prints BLOB_READ_WRITE_TOKEN.
#
# Usage:
#   scripts/read-feedback.sh              # list pathnames
#   scripts/read-feedback.sh --print      # list + print JSON bodies
#   scripts/read-feedback.sh --prefix feedback/2026-10-16/
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SCOPE="${VERCEL_SCOPE:-true-team2}"
PREFIX="feedback/"
PRINT=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --print|-p) PRINT=1; shift ;;
    --prefix) PREFIX="${2:-}"; shift 2 ;;
    -h|--help)
      sed -n '2,12p' "$0" | tr -d '#'
      exit 0
      ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

if ! command -v vercel >/dev/null 2>&1; then
  echo "error: vercel CLI not found on PATH" >&2
  exit 1
fi

if [[ ! -f .vercel/project.json ]]; then
  echo "error: project not linked. Run: vercel link --scope ${SCOPE} --project trueaigaming" >&2
  exit 1
fi

# List via CLI OIDC (logged-in user). Do not pass --rw-token (avoids leaking secrets in ps).
LIST_OUT="$(mktemp)"
trap 'rm -f "$LIST_OUT" "${ENV_TMP:-}"' EXIT

if ! vercel blob list --scope "$SCOPE" --prefix "$PREFIX" --limit 100 --non-interactive >"$LIST_OUT" 2>/tmp/vercel-blob-list.err; then
  # Fallback: env pull + Node SDK (still never echoes the token)
  ENV_TMP="$(mktemp)"
  if ! vercel env pull --scope "$SCOPE" --environment production --yes "$ENV_TMP" >/dev/null 2>/tmp/vercel-env-pull.err; then
    echo "error: vercel blob list failed (is the CLI logged in?). Also env pull failed." >&2
    sed 's/vercel_blob_rw_[A-Za-z0-9_]*/<TOKEN>/g' /tmp/vercel-blob-list.err >&2 || true
    exit 1
  fi
  # Export only BLOB_READ_WRITE_TOKEN from the pulled file without printing it
  # shellcheck disable=SC1090
  set -a
  # Parse KEY=VALUE lines; support optional quotes
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" =~ ^BLOB_READ_WRITE_TOKEN= ]] || continue
    val="${line#BLOB_READ_WRITE_TOKEN=}"
    val="${val%\"}"; val="${val#\"}"
    val="${val%\'}"; val="${val#\'}"
    export BLOB_READ_WRITE_TOKEN="$val"
  done <"$ENV_TMP"
  set +a
  rm -f "$ENV_TMP"
  ENV_TMP=""
  if [[ -z "${BLOB_READ_WRITE_TOKEN:-}" ]]; then
    echo "error: BLOB_READ_WRITE_TOKEN missing after env pull" >&2
    exit 1
  fi
  node --input-type=module -e '
import { list, get } from "@vercel/blob";
const prefix = process.argv[1];
const printBodies = process.argv[2] === "1";
const r = await list({ prefix, limit: 100 });
if (!r.blobs.length) {
  console.log("(no submissions under " + prefix + ")");
  process.exit(0);
}
for (const b of r.blobs) {
  const meta = `${b.pathname}\t${b.size}\t${b.uploadedAt?.toISOString?.() ?? b.uploadedAt}`;
  if (!printBodies) {
    console.log(meta);
    continue;
  }
  const res = await get(b.pathname, { access: "private" });
  let text;
  if (res?.stream) text = await new Response(res.stream).text();
  else if (res?.body) text = await new Response(res.body).text();
  else text = String(res);
  console.log("---");
  console.log(meta);
  console.log(text);
}
' "$PREFIX" "$PRINT"
  unset BLOB_READ_WRITE_TOKEN
  exit 0
fi

# CLI list succeeded — print pathnames; optionally fetch bodies via CLI get
if [[ ! -s "$LIST_OUT" ]]; then
  echo "(no submissions under ${PREFIX})"
  exit 0
fi

# Normalize common CLI table/text output: prefer lines that look like feedback/...json
mapfile -t PATHS < <(grep -Eo 'feedback/[^[:space:]]+\.json' "$LIST_OUT" | sort -u || true)
if [[ ${#PATHS[@]} -eq 0 ]]; then
  # Fallback: show raw list output (no secrets expected)
  cat "$LIST_OUT"
  exit 0
fi

for p in "${PATHS[@]}"; do
  if [[ "$PRINT" -eq 1 ]]; then
    echo "---"
    echo "$p"
    vercel blob get "$p" --scope "$SCOPE" --access private --non-interactive 2>/dev/null || \
      vercel blob get "$p" --scope "$SCOPE" --access private
    echo
  else
    echo "$p"
  fi
done
