#!/bin/sh
# nth-status capture status line (nth-dev-kit). Prints nothing: it only keeps the
# native status line JSON for the session, so the nth-status mod can read the
# prompt cache expiry (`prompt_cache.expires_at`), which no mod API carries.
# Installed as <config>/nth-dev-kit-hooks/nth-status-statusline.sh; see nth-status.md.

umask 077
dir="$(dirname "$0")/nth-status"
input=$(cat)
id=$(printf '%s' "$input" | tr -d '\r\n' |
  grep -o '"session_id"[[:space:]]*:[[:space:]]*"[A-Za-z0-9_-]*"' | head -n 1 |
  sed 's/.*"\([A-Za-z0-9_-]*\)"$/\1/')
[ -n "$id" ] || exit 0
mkdir -p "$dir" 2>/dev/null || exit 0

file="$dir/statusline-$id.json"
# A session's first capture prunes captures left by sessions idle for over two days.
[ -f "$file" ] || find "$dir" -name 'statusline-*.json' -mtime +2 -exec rm -f {} + 2>/dev/null

tmp="$dir/.statusline-$id.$$"
printf '%s' "$input" >"$tmp" 2>/dev/null && mv -f "$tmp" "$file" 2>/dev/null
rm -f "$tmp" 2>/dev/null
exit 0
