#!/bin/sh
# DKOD keep-going (2026-11-02, 365Scores gBall). The public plugin's Claude Code Stop hook.
#
# While a DKOD migration is open (its record .dkod/migration.json is in the folder, or in the sibling
# dk- folder and names this folder), a stop whose last message asks the builder nothing is sent on:
# the agent goes on with the next step of the dkod-migrate skill. At most 3 stops in a row
# (Cursor's hook has the same limit, KEEP_LIMIT in cursor-guard.mjs). A message that ends with a
# question, or no last message at all, is never sent on: the agent waits for the builder.
# A skipped AskUserQuestion needs no hook here: Claude Code ends the turn when the builder skips it.
#
# Plain POSIX sh, sed and grep, no jq and no node. Input: the Stop event as JSON on stdin.
# Output: {"decision":"block","reason":...} to send the agent on, nothing to let it stop.
set -u

input=$(cat | tr '\n' ' ')

field() { printf '%s' "$input" | sed -n -E "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"(([^\"\\\\]|\\\\.)*)\".*/\\1/p" | head -n 1; }

cwd=$(field cwd)
session=$(field session_id | tr -cd 'A-Za-z0-9_-')
last=$(field last_assistant_message)
[ -n "$cwd" ] || exit 0
[ -n "$last" ] || exit 0

# Is a migration open here?
open=""
if [ -r "$cwd/.dkod/migration.json" ]; then
  open=1
else
  name=$(basename -- "$cwd")
  case "$name" in
    dk-*) ;;
    *)
      record="$(dirname -- "$cwd")/dk-$name/.dkod/migration.json"
      if [ -r "$record" ] && grep -Fq "\"$cwd\"" "$record"; then open=1; fi
      ;;
  esac
fi
[ -n "$open" ] || exit 0

# The last message asks the builder something: wait for the answer.
tail=$(printf '%s' "$last" | tail -c 400)
case "$tail" in
  *"?"*) exit 0 ;;
esac

# At most 3 stops in a row: stop_hook_active is true while the agent goes on because of a Stop hook.
count=0
state="${HOME:-/nonexistent}/.dkoder/keep-going"
if [ -n "$session" ]; then
  if printf '%s' "$input" | grep -Eq '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then
    count=$(cat "$state/$session" 2>/dev/null || echo 0)
    case "$count" in ''|*[!0-9]*) count=0 ;; esac
  fi
  [ "$count" -ge 3 ] && exit 0
  mkdir -p "$state" 2>/dev/null && printf '%s' $((count + 1)) > "$state/$session" 2>/dev/null
elif printf '%s' "$input" | grep -Eq '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then
  exit 0
fi

printf '%s' '{"decision":"block","reason":"DKOD: this app'"'"'s migration is not finished. If your last message asked the builder a question, stop and wait for the answer. Otherwise go on now with the next step of the dkod-migrate skill, and do not stop until the app is deployed or you need the builder'"'"'s answer."}'
