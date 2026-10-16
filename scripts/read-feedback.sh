#!/usr/bin/env bash
# List and print TrueAIGaming feedback submissions from the private Blob store.
# No vercel CLI login needed: reads the blob token from
# ~/.config/trueaigaming/blob-token (chmod 600; override with BLOB_TOKEN_FILE).
# The token is never printed. Hard 30s timeout.
#
# Usage:
#   scripts/read-feedback.sh                        # list files
#   scripts/read-feedback.sh --print                # list + print JSON bodies
#   scripts/read-feedback.sh --since 2026-10-16T20:55:00Z [--print]
#   scripts/read-feedback.sh --prefix feedback/2026-10-16/
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
case "${1:-}" in -h|--help) sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; exit 0;; esac
TOKEN_FILE="${BLOB_TOKEN_FILE:-$HOME/.config/trueaigaming/blob-token}"
[[ -r "$TOKEN_FILE" ]] || { echo "error: token file $TOKEN_FILE missing/unreadable" >&2; exit 1; }
[[ -d node_modules/@vercel/blob ]] || { echo "error: run npm install in $ROOT" >&2; exit 1; }
timeout --kill-after=5s 30s node scripts/read-feedback.mjs "$@" || {
  rc=$?; [[ $rc -eq 124 || $rc -eq 137 ]] && echo "error: timed out after 30s" >&2; exit $rc; }
