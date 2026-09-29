#!/usr/bin/env python3
"""Practice trade round-trip against the deployed app, with a cookie jar so the
session (and therefore the trader row) persists across requests.

Also asserts LIVE mode returns 501 — the whole design depends on never faking a
fill, so a 200 there would be a critical regression.
"""
import http.cookiejar
import json
import sys
import urllib.error
import urllib.request

BASE = "https://pumpvideo.vercel.app"

jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def call(path, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        BASE + path,
        data=data,
        method="POST" if payload is not None else "GET",
        headers={"Content-Type": "application/json", "User-Agent": "verify/1.0"},
    )
    try:
        with opener.open(req, timeout=45) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:  # noqa
        raw = e.read()
        try:
            return e.code, json.loads(raw or b"{}")
        except Exception:
            return e.code, {"raw": raw[:200].decode(errors="replace")}


def sol_balance():
    st, d = call("/api/account")
    t = d.get("trader") or d
    return t.get("practiceBalance")


def main():
    st, feed = call("/api/feed?limit=1&sort=hot")
    assert st == 200, f"feed {st}"
    items = feed.get("items", [])
    assert items, "feed is empty"
    mint = items[0]["coin"]["mint"]
    sym = items[0]["coin"].get("symbol", "?")
    print(f"coin            : {sym} ({mint[:12]}…)")

    before = sol_balance()
    print(f"balance before  : {before}")

    st, buy = call("/api/trade", {"mint": mint, "side": "BUY", "solAmount": 0.05, "mode": "PRACTICE"})
    if st != 200:
        print(f"FAIL buy -> {st} {buy}")
        return 1
    tokens = (buy.get("trade") or buy).get("tokensOut") or buy.get("tokensOut")
    print(f"buy 0.05 SOL    : {st} tokensOut={tokens}")

    mid = sol_balance()
    print(f"balance after   : {mid}")

    st, sell = call("/api/trade", {"mint": mint, "side": "SELL", "fraction": 1.0, "mode": "PRACTICE"})
    if st != 200:
        print(f"FAIL sell -> {st} {sell}")
        return 1
    got = (sell.get("trade") or sell).get("solOut") or sell.get("solOut")
    print(f"sell 100%       : {st} solOut={got}")

    after = sol_balance()
    print(f"balance final   : {after}")

    # LIVE must refuse rather than invent a signature.
    st, live = call("/api/trade", {"mint": mint, "side": "BUY", "solAmount": 0.05, "mode": "LIVE"})
    print(f"LIVE (expect 501): {st}")
    if st != 501:
        print(f"FAIL — LIVE returned {st}, must be 501 (never fake a fill)")
        return 1

    problems = []
    b, m, a = float(before or 0), float(mid or 0), float(after or 0)
    if not (b and m and a):
        problems.append(f"missing balances: {before}/{mid}/{after}")
    # Buying must cost SOL, and a round trip must end BELOW where it started —
    # but strictly ABOVE the post-buy balance, because selling returns SOL.
    if not (m < b):
        problems.append(f"buy did not debit: {b} -> {m}")
    if not (a > m):
        problems.append(f"sell did not credit: {m} -> {a}")
    if not (a < b):
        problems.append(f"round trip was free or profitable: {b} -> {a}")
    if not tokens or float(tokens) <= 0:
        problems.append(f"no tokens out: {tokens}")
    if not got or float(got) <= 0:
        problems.append(f"no sol out: {got}")

    if problems:
        print("\nFAIL")
        for p in problems:
            print("  " + p)
        return 1

    rt = (1 - (a / b)) * 100
    print(f"\nOK — round trip cost {rt:.4f}% of the practice bankroll (curve fees + impact).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
