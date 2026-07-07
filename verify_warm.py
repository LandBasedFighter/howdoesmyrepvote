import json
import time
import urllib.request
import urllib.error

BASE = "https://howdoesmyrepvote-api.onrender.com"


def call(path, timeout=120):
    t = time.monotonic()
    try:
        with urllib.request.urlopen(BASE + path, timeout=timeout) as r:
            return r.status, round(time.monotonic() - t, 1), r.read()
    except urllib.error.HTTPError as e:
        return e.code, round(time.monotonic() - t, 1), b""
    except Exception as e:
        return "ERR", round(time.monotonic() - t, 1), repr(e)[:80].encode()

print("waiting for new deploy (/warm -> 200)...")
deadline = time.monotonic() + 420
while time.monotonic() < deadline:
    code, dt, body = call("/warm", timeout=120)
    if code == 200:
        print("  new deploy live. /warm ->", json.loads(body))
        break
    print("  /warm ->", code)
    time.sleep(12)

code, dt, body = call("/warm", timeout=30)
print(f"/warm again: {dt}s ->", json.loads(body) if code == 200 else code)

# votes call should now be served from warm cache
for label, path in [
    ("house (Fine)", "/member/F000484/votes?limit=10"),
    ("senate (Schumer)", "/member/S000148/votes?limit=10"),
]:
    code, dt, body = call(path, timeout=60)
    print(f"votes {label}: {code} in {dt}s ({len(body)} bytes)")
