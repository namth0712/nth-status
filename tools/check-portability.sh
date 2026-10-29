#!/bin/sh
# Privacy and portability check. Fails when text files contain machine-specific
# absolute paths, email addresses, or the local user's identifiers.
#
# Usage, from anywhere:  sh tools/check-portability.sh [path ...]
# Paths are relative to the repository root (default: the whole repository).
#
# Local identifiers are read at run time and never stored here: Git user.name
# and user.email, the OS user name, and the host name. Add more private terms,
# one per line, in a file kept outside the repository:
#   PORTABILITY_TERMS_FILE=/path/outside/repo/terms.txt sh tools/check-portability.sh
#
# Public identifiers (`public_ids` below) are published on purpose and pass the
# local-identifier rule, each only as the exact whole token.
#
# Findings print as `<file>:<line>: <rule>`; matched text is never printed.

root=$(cd "$(dirname "$0")/.." && pwd) || exit 2
cd "$root" || exit 2
[ $# -gt 0 ] || set -- .

terms=$(mktemp) || exit 2
found=$(mktemp) || exit 2
trap 'rm -f "$terms" "$found"' EXIT

{
  git config --get user.name 2>/dev/null
  git config --get user.email 2>/dev/null
  printf '%s\n' "${USER:-}" "${USERNAME:-}" "${LOGNAME:-}"
  hostname 2>/dev/null
  [ -n "${PORTABILITY_TERMS_FILE:-}" ] && tr -d '\r' <"$PORTABILITY_TERMS_FILE"
} | awk 'length($0) >= 3' | sort -u >"$terms"

report() { # rule; reads `file:line:...` and keeps file:line
  cut -d: -f1,2 | sed "s#^\./##; s#\$#: $1#" >>"$found"
}

# Public identifiers published on purpose: the repository owner's GitHub handle,
# in repository URLs, the marketplace name and the install commands. Each passes
# only as the whole token, exactly as written; a line a local identifier still
# matches once they are taken out is reported.
public_ids='namth0712'
token_end='[^A-Za-z0-9_]'

drop_public() { # reads `file:line:text`; keeps the lines still matching without the public ids
  while IFS= read -r hit; do
    text=${hit#*:}
    text=${text#*:}
    for id in $public_ids; do
      # Twice: a match takes the character after it, which may lead the next one.
      text=$(printf '%s\n' "$text" |
        sed -E "s/(^|$token_end)$id($token_end|\$)/\1\2/g; s/(^|$token_end)$id($token_end|\$)/\1\2/g")
    done
    printf '%s\n' "$text" | grep -q -i -F -f "$terms" && printf '%s\n' "$hit"
  done
}

# Placeholder user names a home directory may use.
names='(me|user|you|someone|example|name)'
# A drive path, unless it is the `C:\path\to` placeholder or a placeholder user's
# folder; `\d:\d` in a regex is not one.
grep -r -n -H -I -o --exclude-dir=.git -E '(^|[^A-Za-z0-9_\\])[A-Za-z]:(\\{1,2}|/)[A-Za-z0-9._%-]+((\\{1,2}|/)[A-Za-z0-9._%-]+)?' "$@" 2>/dev/null |
  grep -v -E "[A-Za-z]:(\\\\{1,2}|/)(path(\\\\{1,2}|/)to|Users(\\\\{1,2}|/)$names)\$" | report drive-absolute-path
# A home directory, unless its name is a placeholder or a dot folder.
grep -r -n -H -I -o --exclude-dir=.git -E '(/Users/|/home/|\\{1,2}Users\\{1,2})[A-Za-z0-9._-]+' "$@" 2>/dev/null |
  grep -v -E "(Users|home)(/|\\\\{1,2})($names\$|\\.)" | report home-directory-path
grep -r -n -H -I -o --exclude-dir=.git -E '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}' "$@" 2>/dev/null |
  grep -v -i -E '@example\.(com|org|net)$' | report email-address
if [ -s "$terms" ]; then
  grep -r -n -H -I -i -F --exclude-dir=.git -f "$terms" "$@" 2>/dev/null | drop_public | report local-identifier
  find "$@" -name .git -prune -o -type f -print | sed 's#^\./##' |
    grep -i -F -f "$terms" | sed 's#$#:0: local-identifier-in-file-name#' >>"$found"
fi

files=$(find "$@" -name .git -prune -o -type f -print | wc -l | tr -d ' ')
if [ -s "$found" ]; then
  sort -u "$found"
  echo "portability check: $(sort -u "$found" | wc -l | tr -d ' ') finding(s) in $files file(s)" >&2
  exit 1
fi
echo "portability check: $files file(s), no findings"
