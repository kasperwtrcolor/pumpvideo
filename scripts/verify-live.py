#!/usr/bin/env python3
"""End-to-end check against the deployed app.

Walks the whole feed, then requests every clip's video + thumb, so a partially
broken feed can't pass. Exits non-zero if any asset fails.
"""
import json
import sys
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor

BASE = "https://pumpvideo.vercel.app"


def get(path, timeout=30):
    req = urllib.request.Request(BASE + path, headers={"User-Agent": "verify/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.read()


def head_status(path, timeout=30):
    req = urllib.request.Request(BASE + path, method="GET", headers={"User-Agent": "verify/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.headers.get("Content-Type", ""), int(r.headers.get("Content-Length") or 0)
    except urllib.error.HTTPError as e:
        return e.code, "", 0
    except Exception as e:  # noqa: BLE001
        return 0, str(e), 0


def main():
    items = []
    offset = 0
    while True:
        st, body = get(f"/api/feed?limit=24&offset={offset}&sort=new")
        assert st == 200, f"/api/feed returned {st}"
        d = json.loads(body)
        batch = d.get("items", [])
        items.extend(batch)
        if not d.get("hasMore") or not batch:
            break
        offset += len(batch)
        if offset > 2000:
            break

    print(f"feed items walked : {len(items)}")

    urls = []
    for it in items:
        for k in ("videoUrl", "thumbUrl"):
            if it.get(k):
                urls.append((it[k], it.get("coin", {}).get("symbol", "?")))

    print(f"assets to verify  : {len(urls)}")

    bad = []
    with ThreadPoolExecutor(max_workers=16) as ex:
        results = list(ex.map(lambda u: head_status(u[0]), urls))

    for (path, sym), (code, ctype, size) in zip(urls, results):
        if code != 200 or size == 0:
            bad.append(f"{sym} {path} -> {code} {ctype}")

    if bad:
        print(f"\nFAIL — {len(bad)} broken asset(s):")
        for b in bad[:25]:
            print("  " + b)
        if len(bad) > 25:
            print(f"  ... +{len(bad) - 25} more")
        return 1

    print("\nOK — every clip and thumb in the feed returns 200 with bytes.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
