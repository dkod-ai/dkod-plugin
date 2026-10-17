#!/usr/bin/env python3
# DKO-1020: pack an app folder into the ustar archive DKOD's worker reads, and upload it.
# For builders who do not use git. Python 3.8+, stdlib only. dkod-pack.mjs, .ps1 and .sh do the
# same thing byte for byte (same files, same headers, same sha256); keep the four in step.
#
#   python3 dkod-pack.py pack [<folder>]                    -> {"file","sha256","bytes","files"}
#   python3 dkod-pack.py put <file> <url> ["Name: value"...] -> {"ok":true,"status":200}
#
# The headers are written by hand rather than with tarfile: tarfile's device fields and name split
# differ across Python versions, and the sha256 must match the other three scripts.
# The upload URL is a signed credential: never printed.
import hashlib
import http.client
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import urllib.parse

MAX_FILES = 20000
MAX_FILE_BYTES = 4 * 1024 * 1024
MAX_TOTAL_BYTES = 64 * 1024 * 1024
SKIP_DIRS = {".git", "node_modules", "dist", "build", ".next", "out", ".turbo", ".cache", "coverage", "venv", ".venv", "__pycache__"}
WINDOWS = os.name == "nt"
CONTROL = re.compile(r"[\x00-\x1f\x7f]")
USAGE = 'usage: dkod-pack pack [<folder>] | put <file> <url> ["Name: value"...]'


class Refusal(Exception):
    pass


def in_git_tree(root):
    if shutil.which("git") is None:
        return False
    try:
        r = subprocess.run(["git", "-C", root, "rev-parse", "--is-inside-work-tree"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    except OSError:
        return False
    return r.returncode == 0 and r.stdout.strip() == b"true"


def candidates(root):
    """Candidate paths, relative to root with forward slashes, before the common filters."""
    if in_git_tree(root):
        r = subprocess.run(["git", "ls-files", "-co", "--exclude-standard", "-z"], cwd=root, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        if r.returncode != 0:
            raise Refusal("git ls-files failed")
        return [p for p in r.stdout.decode("utf-8", "surrogateescape").split("\0") if p and not p.endswith("/")]
    out = []

    def walk(d, rel):
        with os.scandir(d) as it:
            for e in it:
                path = e.name if rel == "" else rel + "/" + e.name
                if e.is_dir(follow_symlinks=False):
                    if e.name not in SKIP_DIRS:
                        walk(e.path, path)
                elif e.is_file(follow_symlinks=False):
                    out.append(path)

    walk(root, "")
    return out


def check_path(path):
    segments = path.split("/")
    if path.startswith("/") or "\\" in path or CONTROL.search(path) or any(s in ("", ".", "..") for s in segments):
        raise Refusal("path not allowed: " + path)


def split_path(path, raw):
    """ustar's name/prefix split at the leftmost / that leaves a name of at most 100 bytes."""
    if len(raw) > 255:
        raise Refusal("path too long (over 255 bytes): " + path)
    if len(raw) <= 100:
        return raw, b""
    for i, b in enumerate(raw):
        if b != 0x2F or len(raw) - i - 1 > 100:
            continue
        if i > 155:
            break
        return raw[i + 1:], raw[:i]
    raise Refusal("path cannot be stored in ustar (prefix 155 / name 100 bytes): " + path)


def header(name, prefix, mode, size):
    h = bytearray(512)
    h[0:len(name)] = name
    h[100:108] = mode.encode() + b"\0"
    h[108:116] = b"0000000\0"
    h[116:124] = b"0000000\0"
    h[124:136] = ("%011o" % size).encode() + b"\0"
    h[136:148] = b"00000000000\0"
    h[148:156] = b"        "
    h[156:157] = b"0"
    h[257:263] = b"ustar\0"
    h[263:265] = b"00"
    h[345:345 + len(prefix)] = prefix
    h[148:156] = ("%06o" % sum(h)).encode() + b"\0 "
    return bytes(h)


def pack(folder):
    root = os.path.abspath(folder)
    if not os.path.isdir(root):
        raise Refusal("not a folder: " + root)
    files = []
    for path in candidates(root):
        segments = path.split("/")
        if any(s.lower() == ".git" for s in segments) or segments[-1].startswith(".env"):
            continue
        try:
            st = os.lstat(os.path.join(root, *segments))
        except OSError:
            continue
        if not stat.S_ISREG(st.st_mode):
            continue
        check_path(path)
        try:
            raw = path.encode("utf-8")
        except UnicodeEncodeError:
            raise Refusal("path not allowed (not UTF-8): " + path.encode("utf-8", "replace").decode("utf-8"))
        files.append((raw, path, not WINDOWS and (st.st_mode & 0o111) != 0))
    files.sort(key=lambda f: f[0])
    if not files:
        raise Refusal("no files to pack in " + root)
    if len(files) > MAX_FILES:
        raise Refusal("too many files: %d (the cap is %d)" % (len(files), MAX_FILES))

    d = tempfile.mkdtemp(prefix="dkod-src-")
    out = os.path.join(d, "src.tar")
    digest = hashlib.sha256()
    count = [0]
    try:
        with open(out, "wb") as fh:
            def emit(buf):
                fh.write(buf)
                digest.update(buf)
                count[0] += len(buf)

            total = 0
            for raw, path, exe in files:
                name, prefix = split_path(path, raw)
                with open(os.path.join(root, *path.split("/")), "rb") as src:
                    data = src.read(MAX_FILE_BYTES + 1)
                if len(data) > MAX_FILE_BYTES:
                    raise Refusal("file too large: %s (the cap is 4 MiB per file)" % path)
                total += len(data)
                if total > MAX_TOTAL_BYTES:
                    raise Refusal("folder too large (the cap is 64 MiB of files in total)")
                emit(header(name, prefix, "0000755" if exe else "0000644", len(data)))
                emit(data)
                pad = (512 - len(data) % 512) % 512
                if pad:
                    emit(b"\0" * pad)
            emit(b"\0" * 1024)
    except BaseException:
        shutil.rmtree(d, ignore_errors=True)
        raise
    return '{"file":%s,"sha256":"%s","bytes":%d,"files":%d}' % (json.dumps(out), digest.hexdigest(), count[0], len(files))


def put(file, url, header_args):
    u = urllib.parse.urlsplit(url)
    host = u.hostname or ""
    if u.username is not None or u.password is not None:
        raise Refusal("refused: the upload URL carries a user name")
    scheme = u.scheme.lower()
    if scheme == "https" and host:
        conn_class = http.client.HTTPSConnection
    elif scheme == "http" and host in ("127.0.0.1", "localhost"):
        conn_class = http.client.HTTPConnection
    else:
        raise Refusal("refused: only https upload URLs are allowed")
    headers = []
    for arg in header_args:
        name, sep, value = arg.partition(":")
        name = name.strip()
        if not sep or not name:
            raise Refusal('bad header argument (expected "Name: value")')
        if name.lower() != "content-length":
            headers.append((name, value.strip()))
    try:
        size = os.path.getsize(file)
        src = open(file, "rb")
    except OSError:
        raise Refusal("cannot read " + file)
    target = (u.path or "/") + ("?" + u.query if u.query else "")
    try:
        with src:
            conn = conn_class(host, u.port, timeout=600)
            try:
                conn.putrequest("PUT", target, skip_accept_encoding=True)
                for name, value in headers:
                    conn.putheader(name, value)
                conn.putheader("Content-Length", str(size))
                conn.endheaders()
                while True:
                    chunk = src.read(1 << 20)
                    if not chunk:
                        break
                    conn.send(chunk)
                res = conn.getresponse()
                res.read()
                status = res.status
            finally:
                conn.close()
    except ValueError:
        raise Refusal("bad header argument")
    except (OSError, http.client.HTTPException):
        raise Refusal("upload failed: could not connect")
    if status < 200 or status > 299:
        raise Refusal("upload failed: HTTP %d" % status)
    os.remove(file)
    d = os.path.dirname(os.path.abspath(file))
    if os.path.basename(d).startswith("dkod-src-"):
        try:
            os.rmdir(d)
        except OSError:
            pass
    return '{"ok":true,"status":%d}' % status


def main(argv):
    if argv and argv[0] == "pack" and len(argv) <= 2:
        return pack(argv[1] if len(argv) == 2 else ".")
    if argv and argv[0] == "put" and len(argv) >= 3:
        return put(argv[1], argv[2], argv[3:])
    raise Refusal(USAGE)


if __name__ == "__main__":
    try:
        line = main(sys.argv[1:])
    except Refusal as e:
        sys.stderr.write(str(e) + "\n")
        sys.exit(1)
    except OSError as e:
        sys.stderr.write("error: %s\n" % (e.strerror or "unexpected failure"))
        sys.exit(1)
    sys.stdout.write(line + "\n")
