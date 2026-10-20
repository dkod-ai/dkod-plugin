#!/usr/bin/env python3
# dkod-update.py: the same as dkod-update.mjs, for a computer with Python and no Node.
#
#   python3 dkod-update.py <plugin folder> <bundle url>
#
# Writes the new plugin next to the folder, then swaps the two, so Cursor never loads half a plugin.
# Replaces the folder only when it holds the dkod plugin already. Prints one JSON line.
import base64, json, os, re, shutil, sys, urllib.request


def done(out, code=0):
    sys.stdout.write(json.dumps(out) + "\n")
    sys.exit(code)


def fail(error):
    done({"ok": False, "error": error}, 1)


def plugin(dir_):
    try:
        with open(os.path.join(dir_, ".cursor-plugin", "plugin.json"), encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


if len(sys.argv) < 3:
    fail("usage: python3 dkod-update.py <plugin folder> <bundle url>")
url = sys.argv[2]
if not (re.fullmatch(r"https://[^/\s]+/api/v1/dkoder/bundle/cursor\.json", url) or re.fullmatch(r"http://(localhost|127\.0\.0\.1)(:\d+)?/api/v1/dkoder/bundle/cursor\.json", url)):
    fail("the bundle url must be https://<your DKOD>/api/v1/dkoder/bundle/cursor.json")
folder = os.path.abspath(os.path.expanduser(sys.argv[1]))
before = (plugin(folder) or {}).get("version")
if os.path.exists(folder) and (plugin(folder) or {}).get("name") != "dkod":
    fail(f"{folder} is not the dkod plugin; nothing was changed")

try:
    with urllib.request.urlopen(urllib.request.Request(url, headers={"accept": "application/json"}), timeout=60) as res:
        bundle = json.load(res)
except Exception as err:
    fail(f"could not download the plugin: {err}")
files = bundle.get("files") if isinstance(bundle, dict) else None
if not isinstance(bundle, dict) or bundle.get("name") != "dkod" or not isinstance(files, list) or not files:
    fail("the answer is not the dkod plugin")

stage = f"{folder}.new-{os.getpid()}"
old = f"{folder}.old-{os.getpid()}"
planned = []
for f in files:
    path = str(f.get("path", ""))
    parts = re.split(r"[\\/]", path)
    target = os.path.join(stage, *path.split("/"))
    if path == "" or os.path.isabs(path) or any(p in ("", "..") for p in parts) or not os.path.abspath(target).startswith(stage + os.sep):
        fail(f"unsafe path in the bundle: {path}")
    planned.append((target, base64.b64decode(str(f.get("base64", ""))), 0o755 if f.get("mode") == 0o755 else 0o644))
if not any(f.get("path") == ".cursor-plugin/plugin.json" for f in files):
    fail("the downloaded plugin has no .cursor-plugin/plugin.json")

shutil.rmtree(stage, ignore_errors=True)
try:
    for target, data, mode in planned:
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, "wb") as out:
            out.write(data)
        if os.name != "nt":
            os.chmod(target, mode)
    if (plugin(stage) or {}).get("name") != "dkod":
        raise RuntimeError("the downloaded plugin is not named dkod")
    os.makedirs(os.path.dirname(folder), exist_ok=True)
    if os.path.exists(folder):
        os.rename(folder, old)
    os.rename(stage, folder)
    shutil.rmtree(old, ignore_errors=True)
except Exception as err:
    if not os.path.exists(folder) and os.path.exists(old):
        os.rename(old, folder)
    shutil.rmtree(stage, ignore_errors=True)
    fail(f"could not write the plugin: {err}")
done({"ok": True, "folder": folder, "from": before, "to": bundle.get("version"), "files": len(files)})
