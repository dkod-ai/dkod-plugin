#!/bin/sh
# DKO-1020: pack an app folder into the ustar archive DKOD's worker reads, and upload it.
# For builders who do not use git. POSIX sh plus find, sort, od, awk, ls, curl and one of sha256sum,
# shasum or openssl. dkod-pack.mjs, .py and .ps1 do the same thing byte for byte (same files, same
# headers, same sha256); keep the four in step.
#
#   sh dkod-pack.sh pack [<folder>]                    -> {"file","sha256","bytes","files"}
#   sh dkod-pack.sh put <file> <url> ["Name: value"...] -> {"ok":true,"status":200}
#
# The headers are written here with printf rather than by the system tar: GNU tar and bsdtar
# cannot both be told to write the same bytes (mtime 0, sorted, empty owner names, no padding to
# 10 KiB), and the sha256 must match the other three scripts.
# The upload URL is a signed credential: never printed.
LC_ALL=C
export LC_ALL
set -f

MAX_FILES=20000
MAX_FILE_BYTES=4194304
MAX_TOTAL_BYTES=67108864
USAGE='usage: dkod-pack pack [<folder>] | put <file> <url> ["Name: value"...]'
TMPW=

die() {
  printf '%s\n' "$1" >&2
  [ -n "$TMPW" ] && rm -rf "$TMPW"
  exit 1
}

# printf escapes for n NUL bytes, built from powers of two: Z=$(zeros) is avoided to save a fork.
z1='\000'; z2=$z1$z1; z4=$z2$z2; z8=$z4$z4; z16=$z8$z8; z32=$z16$z16; z64=$z32$z32; z128=$z64$z64; z256=$z128$z128
zeros() {
  n=$1; Z=
  [ "$n" -ge 256 ] && { Z=$Z$z256; n=$((n - 256)); }
  [ "$n" -ge 128 ] && { Z=$Z$z128; n=$((n - 128)); }
  [ "$n" -ge 64 ] && { Z=$Z$z64; n=$((n - 64)); }
  [ "$n" -ge 32 ] && { Z=$Z$z32; n=$((n - 32)); }
  [ "$n" -ge 16 ] && { Z=$Z$z16; n=$((n - 16)); }
  [ "$n" -ge 8 ] && { Z=$Z$z8; n=$((n - 8)); }
  [ "$n" -ge 4 ] && { Z=$Z$z4; n=$((n - 4)); }
  [ "$n" -ge 2 ] && { Z=$Z$z2; n=$((n - 2)); }
  [ "$n" -ge 1 ] && Z=$Z$z1
  return 0
}

json_str() {
  printf '"%s"' "$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')"
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
  elif command -v openssl >/dev/null 2>&1; then openssl dgst -sha256 "$1" | awk '{print $NF}'
  else die "no sha256 tool found (need sha256sum, shasum or openssl)"
  fi
}

# find over the folder, skipping the build and dependency folders, then the given test.
walk() {
  find . \( -type d \( -name .git -o -name node_modules -o -name dist -o -name build -o -name .next \
    -o -name out -o -name .turbo -o -name .cache -o -name coverage -o -name venv -o -name .venv \
    -o -name __pycache__ \) -prune \) -o "$@"
}

# n in octal, zero-padded to $2 digits, into O; D is the sum of its digit values. No fork.
octal() {
  O=; D=0; s=$1
  while [ "$s" -gt 0 ]; do O=$((s % 8))$O; D=$((D + s % 8)); s=$((s / 8)); done
  while [ "${#O}" -lt "$2" ]; do O=0$O; done
}

# Candidate paths, one per line, relative with forward slashes, into $1.
candidates() {
  if command -v git >/dev/null 2>&1 && [ "$(git rev-parse --is-inside-work-tree 2>/dev/null)" = true ]; then
    nl=$(git ls-files -co --exclude-standard -z | tr -cd '\n' | wc -c)
    [ "$nl" -eq 0 ] || die "path not allowed: a git path holds a line break"
    git ls-files -co --exclude-standard -z | tr '\0' '\n' | grep -v '/$' > "$1" || :
  else
    nl=$(walk -name '*
*' -print | wc -l)
    [ "$nl" -eq 0 ] || die "path not allowed: a file name holds a line break"
    walk -type f -print | sed 's|^\./||' > "$1"
  fi
}

pack() {
  case "$1" in /*) dir=$1 ;; *) dir=./$1 ;; esac
  [ -d "$dir" ] || die "not a folder: $1"
  cd "$dir" 2>/dev/null || die "not a folder: $1"
  root=$(pwd -P)
  TMPW=$(mktemp -d "${TMPDIR:-/tmp}/dkod-work-XXXXXXXX") || die "cannot make a temp folder"
  candidates "$TMPW/cand"
  sort "$TMPW/cand" > "$TMPW/sorted"

  : > "$TMPW/meta"; : > "$TMPW/paths"
  count=0; total=0
  while IFS= read -r p; do
    case "/$p/" in
      */[.][gG][iI][tT]/*) continue ;;
    esac
    case "${p##*/}" in
      .env*) continue ;;
    esac
    [ -f "$p" ] && [ ! -L "$p" ] || continue
    case "$p" in
      /*|*\\*|*[[:cntrl:]]*) die "path not allowed: $p" ;;
    esac
    case "/$p/" in
      *//*|*/./*|*/../*) die "path not allowed: $p" ;;
    esac
    # One fork per file for both the size and the execute bits.
    set -- $(ls -nd "./$p")
    perm=$1; size=$5
    case "$perm" in
      ???[xst]*|??????[xst]*|?????????[xst]*) mode=0000755 ;;
      *) mode=0000644 ;;
    esac
    printf '%s %s %s\n' "$mode" "$size" "$p" >> "$TMPW/meta"
    printf '%s\n' "$p" >> "$TMPW/paths"
    count=$((count + 1))
  done < "$TMPW/sorted"
  [ "$count" -gt 0 ] || die "no files to pack in $root"
  [ "$count" -le "$MAX_FILES" ] || die "too many files: $count (the cap is $MAX_FILES)"

  # The byte sum of each path, for the header checksum; one od for all of them.
  od -An -v -tu1 "$TMPW/paths" | awk '{ for (i = 1; i <= NF; i++) { if ($i == 10) { print s; s = 0 } else s += $i } }' > "$TMPW/sums"
  paste -d ' ' "$TMPW/sums" "$TMPW/meta" > "$TMPW/plan"

  out_dir=$(mktemp -d "${TMPDIR:-/tmp}/dkod-src-XXXXXXXX") || die "cannot make a temp folder"
  out="$out_dir/src.tar"
  expect=1024
  {
    while IFS= read -r line; do
      psum=${line%% *}; line=${line#* }
      mode=${line%% *}; line=${line#* }
      size=${line%% *}; p=${line#* }
      blen=${#p}
      [ "$blen" -le 255 ] || { rm -rf "$out_dir"; die "path too long (over 255 bytes): $p"; }
      name=$p; prefix=
      while [ "${#name}" -gt 100 ]; do
        seg=${name%%/*}
        [ "$seg" != "$name" ] || break
        prefix=${prefix:+$prefix/}$seg
        name=${name#*/}
      done
      if [ "${#name}" -gt 100 ] || [ "${#prefix}" -gt 155 ]; then
        rm -rf "$out_dir"; die "path cannot be stored in ustar (prefix 155 / name 100 bytes): $p"
      fi
      [ "$size" -le "$MAX_FILE_BYTES" ] || { rm -rf "$out_dir"; die "file too large: $p (the cap is 4 MiB per file)"; }
      total=$((total + size))
      [ "$total" -le "$MAX_TOTAL_BYTES" ] || { rm -rf "$out_dir"; die "folder too large (the cap is 64 MiB of files in total)"; }
      # Checksum: every header byte with the checksum field read as 8 spaces. 2159 is the fixed
      # fields (uid, gid, mtime, the spaces, typeflag, magic, version); the mode digits add 350
      # or 353; the size digits add 11 * 48 plus their values; the path adds its bytes less the
      # "/" that the name/prefix split removes.
      octal "$size" 11; sz=$O
      if [ "$mode" = 0000755 ]; then ms=353; else ms=350; fi
      sum=$((2159 + ms + 528 + D + psum))
      [ -z "$prefix" ] || sum=$((sum - 47))
      octal "$sum" 6; ck=$O
      zeros $((100 - ${#name})); pn=$Z
      zeros $((155 - ${#prefix})); pp=$Z
      printf "%s$pn%s\\000%s\\000%s\\000%s\\000%s\\000%s\\000 0$z64$z32$z4%s\\00000$z32$z32$z16%s$pp$z8$z4" \
        "$name" "$mode" 0000000 0000000 "$sz" 00000000000 "$ck" ustar "$prefix"
      cat "./$p"
      zeros $(( (512 - size % 512) % 512 )); printf "$Z"
      expect=$((expect + 512 + size + (512 - size % 512) % 512))
    done < "$TMPW/plan"
    printf "$z256$z256$z256$z256"
  } > "$out" || { rm -rf "$out_dir"; die "cannot write the archive"; }
  rm -rf "$TMPW"; TMPW=
  bytes=$(wc -c < "$out" | tr -d ' ')
  [ "$bytes" -eq "$expect" ] || { rm -rf "$out_dir"; die "files changed while packing: run pack again"; }
  sha=$(sha256_of "$out")
  printf '{"file":%s,"sha256":"%s","bytes":%s,"files":%s}\n' "$(json_str "$out")" "$sha" "$bytes" "$count"
}

put() {
  file=$1; url=$2; shift 2
  case "$url" in
    https://*|HTTPS://*) rest=${url#*://} ;;
    http://*|HTTP://*)
      rest=${url#*://}
      auth=${rest%%[/?#]*}
      host=${auth%:*}
      case "$host" in
        127.0.0.1|localhost|LOCALHOST) ;;
        *) die "refused: only https upload URLs are allowed" ;;
      esac
      ;;
    *) die "refused: only https upload URLs are allowed" ;;
  esac
  auth=${rest%%[/?#]*}
  case "$auth" in
    *@*) die "refused: the upload URL carries a user name" ;;
    '') die "refused: the upload URL is not a valid URL" ;;
  esac
  [ -f "$file" ] && [ -r "$file" ] || die "cannot read $file"
  command -v curl >/dev/null 2>&1 || die "curl is not installed"
  # The URL and the headers go to curl on stdin, not argv, so they stay out of the process list.
  cfg() {
    printf 'url = "%s"\n' "$(printf '%s' "$url" | sed 's/\\/\\\\/g; s/"/\\"/g')"
    has_type=
    for h in "$@"; do
      name=${h%%:*}
      [ "$name" != "$h" ] && [ -n "$(printf '%s' "$name" | tr -d ' \t')" ] || die 'bad header argument (expected "Name: value")'
      lname=$(printf '%s' "$name" | tr -d ' \t' | tr 'A-Z' 'a-z')
      [ "$lname" = content-length ] && continue
      [ "$lname" = content-type ] && has_type=1
      printf 'header = "%s"\n' "$(printf '%s' "$h" | sed 's/\\/\\\\/g; s/"/\\"/g')"
    done
    # --data-binary would otherwise add a form Content-Type the signature does not cover.
    [ -n "$has_type" ] || printf 'header = "Content-Type:"\n'
    printf 'header = "Expect:"\n'
  }
  conf=$(cfg "$@") || exit 1
  code=$(printf '%s\n' "$conf" | curl -s -o /dev/null -w '%{http_code}' -X PUT --data-binary "@$file" --max-time 600 -K -) || code=000
  case "$code" in
    2??) ;;
    000) die "upload failed: could not connect" ;;
    *) die "upload failed: HTTP $code" ;;
  esac
  rm -f "$file"
  dir=$(dirname "$file")
  case "${dir##*/}" in
    dkod-src-*) rmdir "$dir" 2>/dev/null || : ;;
  esac
  printf '{"ok":true,"status":%s}\n' "$code"
}

case "$1" in
  pack)
    [ $# -le 2 ] || die "$USAGE"
    pack "${2:-.}"
    ;;
  put)
    [ $# -ge 3 ] || die "$USAGE"
    shift
    put "$@"
    ;;
  *) die "$USAGE" ;;
esac
