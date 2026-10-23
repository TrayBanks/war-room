"""Speed check in real Chromium: load the unpacked extension on a replica classic draft room, then feed a new pick
every 1.5 s through the routed Sleeper API (a fast-moving draft). Records main-thread long tasks (>50 ms) with a
PerformanceObserver and how long the panel takes to show each new pick.

    python3 tests/perf_live.py [extension_dir] [picks=24] [start=20]
"""
import json, os, sys, time, asyncio, tempfile
from playwright.async_api import async_playwright

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXT = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(BASE, "extension")
NPICK = int(sys.argv[2]) if len(sys.argv) > 2 else 24
START = int(sys.argv[3]) if len(sys.argv) > 3 else 20
ME = "107261208461459456"
ids = dict(l.split("|")[::-1] for l in open(os.path.join(BASE, "data", "ids.psv")).read().strip().split("\n")[1:])
board = [l.split("|") for l in open(os.path.join(BASE, "data", "mock_board.psv")).read().strip().split("\n")[1:]]
by_slot = {int(r[0]): r[1:] for r in board}
def slot_for(p):
    r, i = (p - 1) // 10 + 1, (p - 1) % 10
    return i + 1 if r % 2 else 10 - i
picks = [dict(pick_no=p, round=(p - 1) // 10 + 1, draft_slot=slot_for(p), player_id=ids[by_slot[slot_for(p)][(p - 1) // 10]],
              picked_by=ME if slot_for(p) == 10 else "", metadata={}) for p in range(1, 141)]
order = {ME: 10, **{f"u{i}": i for i in range(1, 10)}}
state = {"n": START, "last": int(time.time() * 1000)}
# a busy page: 120 player rows like Sleeper's list, and a ticking timer that mutates the DOM every 250 ms
players = json.loads(open(os.path.join(EXT, "data.js")).read().split("var WR_DATA = ", 1)[1].rstrip().rstrip(";"))["players"]
rows = "".join(f'<div class="player-rank-item2"><div class="draft-button-wrapper"><div class="draft-button disable">+</div></div><div class="rank">{i+1}</div>'
               f'<div class="name"><div class="name-wrapper">{p["n"]}<div class="position">{"/".join(p["p"])}</div></div><div class="queue-action">+</div></div></div>'
               for i, p in enumerate(players[:120]))
html = f"""<!doctype html><html><head><style>body{{margin:0;background:#030616;color:#fff;font:13px Lato,sans-serif}}
.draft-header{{height:80px}} .list{{position:fixed;top:450px;left:0;right:474px;bottom:0;overflow:auto;background:#2D3649}}
.right-panel-wrapper{{position:fixed;top:450px;right:0;width:474px;bottom:0;background:#283244}}</style></head>
<body><div class="draft-header">NBA League Revamped <span id="tick">0</span></div><div class="list"><input placeholder="Find player">{rows}</div>
<div class="right-panel-wrapper queue-wrapper"><div class="draft-queue"></div></div>
<script>localStorage.setItem("user_id", JSON.stringify("{ME}")); let k=0; setInterval(()=>{{document.getElementById("tick").textContent=++k;}},250);
window.__long=[]; let __t=performance.now(); (function f(t){{ if (t-__t>50) __long.push(Math.round(t-__t)); __t=t; requestAnimationFrame(f); }})(performance.now());</script></body></html>"""

async def main():
    os.environ["PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS"] = "1"
    async with async_playwright() as pw:
        ctx = await pw.chromium.launch_persistent_context(tempfile.mkdtemp(prefix="wr-perf-"), headless=True,
            executable_path="/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
            args=[f"--disable-extensions-except={EXT}", f"--load-extension={EXT}", "--headless=new"], viewport={"width": 1440, "height": 900})
        async def api(route):
            u = route.request.url
            if u.endswith("/picks"): body = picks[:state["n"]]
            elif "/users" in u: body = [{"user_id": ME, "display_name": "TrayBanks"}]
            elif "projections" in u: body = []
            elif "/draft/" in u: body = dict(draft_id="1", league_id="1", status="drafting", season="2026", start_time=0, last_picked=state["last"],
                                             settings=dict(teams=10, rounds=14, pick_timer=120, reversal_round=0), draft_order=order)
            else: body = {}
            await route.fulfill(status=200, content_type="application/json", body=json.dumps(body), headers={"access-control-allow-origin": "*"})
        await ctx.route("https://api.sleeper.app/**", api)
        await ctx.route("https://api.sleeper.com/**", api)
        await ctx.route("https://sleeper.com/**", lambda r: r.fulfill(status=200, content_type="text/html", body=html))
        if not ctx.service_workers: await ctx.wait_for_event("serviceworker", timeout=10000)
        page = ctx.pages[0] if ctx.pages else await ctx.new_page()
        await page.goto("https://sleeper.com/draft/nba/1")
        await page.wait_for_timeout(6000)
        await page.evaluate("() => { window.__long = []; }")
        lat = []
        for _ in range(NPICK):
            state["n"] += 1; state["last"] = int(time.time() * 1000)
            want = f"pick {state['n'] + 1}"
            t0 = time.time()
            ok = False
            while time.time() - t0 < 5:
                txt = await page.evaluate("() => { const h=document.getElementById('wr-overlay-host'); return h ? h.shadowRoot.querySelector('#bn').innerText : ''; }")
                if want in txt.lower() or (f"#{state['n'] + 1}" in txt): ok = True; break
                await page.wait_for_timeout(25)
            lat.append(round((time.time() - t0) * 1000) if ok else None)
            await page.wait_for_timeout(1500)
        longs = await page.evaluate("() => window.__long")
        seen = [x for x in lat if x is not None]
        print(json.dumps({"ext": os.path.basename(os.path.dirname(EXT + "/")) or EXT, "picks": NPICK, "shown": len(seen),
                          "pick_to_panel_ms": {"median": sorted(seen)[len(seen) // 2] if seen else None, "max": max(seen) if seen else None},
                          "frames_over_50ms": len(longs), "frozen_ms_total": sum(longs), "worst_freeze_ms": max(longs) if longs else 0,
                          "panel_perf": await page.evaluate("() => (document.getElementById('wr-overlay-host')||{dataset:{}}).dataset.perf || ''")}))
        await ctx.close()

asyncio.run(main())
