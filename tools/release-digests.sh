#!/bin/sh
# Prints the release identity nth-dev-kit pins: the version and the LF-canonical
# sha256 of each release file and of docs/installation.md, as JSON for
# packages/compatibility.json. Usage: sh tools/release-digests.sh

root=$(cd "$(dirname "$0")/.." && pwd) || exit 2
cd "$root" || exit 2

if command -v sha256sum >/dev/null 2>&1; then sum() { sha256sum | cut -d' ' -f1; }
else sum() { shasum -a 256 | cut -d' ' -f1; }; fi
# CRLF, then any lone CR, to LF.
digest() { perl -0777 -pe 's/\r\n/\n/g; s/\r/\n/g' <"$1" | sum; }

files=".claude-plugin/plugin.json hooks/hooks.json hooks/register.tsx hooks/status.ts types/index.d.ts scripts/nth-status-statusline.sh"
for f in $files docs/installation.md; do
  [ -f "$f" ] || { echo "missing: $f" >&2; exit 1; }
done
version=$(sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' .claude-plugin/plugin.json | head -n 1)

printf '"nth-status": {\n  "version": "%s",\n  "activation": "selected-profile",\n' "$version"
printf '  "procedure": { "path": "docs/installation.md", "sha256": "%s" },\n' "$(digest docs/installation.md)"
printf '  "files": {\n'
last=scripts/nth-status-statusline.sh
for f in $files; do
  sep=,; [ "$f" = "$last" ] && sep=
  printf '    "%s": "%s"%s\n' "$f" "$(digest "$f")" "$sep"
done
printf '  }\n}\n'
