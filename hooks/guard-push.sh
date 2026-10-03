#!/bin/sh
# Claude Code PreToolUse hook for Bash.
# When the command runs `git push`, find the remote it pushes to and run the
# DKOD pre-push check (hooks/pre-push). A refused push exits 2 so Claude Code
# blocks the command and shows the reason to the model.
set -u

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
input=$(cat)

json_get() {
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$input" | jq -r "$1 // empty"
  elif command -v python3 >/dev/null 2>&1; then
    printf '%s' "$input" | python3 -c 'import json,sys
d=json.load(sys.stdin)
for k in sys.argv[1].lstrip(".").split("."):
    d=d.get(k) if isinstance(d,dict) else None
print(d if isinstance(d,str) else "")' "$1"
  elif command -v node >/dev/null 2>&1; then
    printf '%s' "$input" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{let d=JSON.parse(s);for(const k of process.argv[1].replace(/^\./,"").split("."))d=d&&typeof d==="object"?d[k]:undefined;process.stdout.write(typeof d==="string"?d:"")})' "$1"
  fi
}

cmd=$(json_get '.tool_input.command')
case "$cmd" in
  *git*push*) ;;
  *) exit 0 ;;
esac

dir=$(json_get '.cwd')
[ -n "$dir" ] || dir=$(pwd)

# Split on && || ; | and newlines, then look at each part.
parts=$(printf '%s\n' "$cmd" | awk '{ gsub(/&&|\|\||;|\|/, "\n"); print }')

refused=0
old_ifs=$IFS
IFS='
'
for part in $parts; do
  IFS=$old_ifs
  set -f
  # shellcheck disable=SC2086
  set -- $part
  set +f
  # `cd <dir>` before the push changes where it runs.
  if [ "${1:-}" = "cd" ] && [ -n "${2:-}" ]; then
    case "$2" in
      /*) dir="$2" ;;
      *) dir="$dir/$2" ;;
    esac
    IFS='
'
    continue
  fi
  [ "${1:-}" = "git" ] || { IFS='
'; continue; }
  shift
  gdir="$dir"
  # git options before the subcommand.
  while [ $# -gt 0 ]; do
    case "$1" in
      -C)
        shift
        case "${1:-}" in /*) gdir="$1" ;; *) gdir="$gdir/${1:-}" ;; esac
        shift
        ;;
      -c) shift 2 ;;
      -*) shift ;;
      *) break ;;
    esac
  done
  [ "${1:-}" = "push" ] || { IFS='
'; continue; }
  shift
  remote=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --repo=*) remote="${1#--repo=}"; break ;;
      -o | --push-option | --receive-pack | --exec) shift 2 ;;
      -*) shift ;;
      *) remote="$1"; break ;;
    esac
  done
  [ -d "$gdir" ] || { IFS='
'; continue; }
  git_dir=$(git -C "$gdir" rev-parse --absolute-git-dir 2>/dev/null) || { IFS='
'; continue; }
  if [ -z "$remote" ]; then
    up=$(git -C "$gdir" rev-parse --abbrev-ref --symbolic-full-name '@{push}' 2>/dev/null || true)
    remote="${up%%/*}"
    [ -n "$remote" ] || remote="origin"
  fi
  case "$remote" in
    */* | *:*) url="$remote" ;;
    *) url=$(git -C "$gdir" remote get-url --push "$remote" 2>/dev/null || true) ;;
  esac
  [ -n "$url" ] || { IFS='
'; continue; }
  if ! out=$(GIT_DIR="$git_dir" sh "$here/pre-push" "$remote" "$url" 2>&1 </dev/null); then
    printf '%s\n' "$out" >&2
    refused=1
  fi
  IFS='
'
done
IFS=$old_ifs

[ "$refused" = 0 ] || exit 2
exit 0
