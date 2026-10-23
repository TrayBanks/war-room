"""Load the unpacked extension in Chromium, serve a replica Sleeper draft room, stub Sleeper's API from the mock, screenshot."""
import json, os, sys, asyncio, tempfile
from playwright.async_api import async_playwright

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXT = os.path.join(BASE, "extension")
OUT = os.path.join(BASE, "reports", "screens"); os.makedirs(OUT, exist_ok=True)
N_PICKS = int(sys.argv[1]) if len(sys.argv) > 1 else 29
STATUS = sys.argv[2] if len(sys.argv) > 2 else "drafting"
TAG = sys.argv[3] if len(sys.argv) > 3 else "clock"

ids = dict(l.split("|")[::-1] for l in open(os.path.join(BASE, "data", "ids.psv")).read().strip().split("\n")[1:])
board = [l.split("|") for l in open(os.path.join(BASE, "data", "mock_board.psv")).read().strip().split("\n")[1:]]
by_slot = {int(r[0]): r[1:] for r in board}
ME = "107261208461459456"
def slot_for(p):
    r, i = (p - 1) // 10 + 1, (p - 1) % 10
    return i + 1 if r % 2 else 10 - i
picks = []
for p in range(1, 141):
    s, rd = slot_for(p), (p - 1) // 10 + 1
    picks.append(dict(pick_no=p, round=rd, draft_slot=s, player_id=ids[by_slot[s][rd - 1]], picked_by=ME if s == 10 else "", metadata={}))
import time
draft = dict(draft_id="1398532732564320256", league_id="1398532731020828672", status=STATUS, season="2026",
             start_time=int((time.time() + 24 * 3600) * 1000), last_picked=int((time.time() - 25) * 1000),
             settings=dict(teams=10, rounds=14, pick_timer=120, reversal_round=0),
             draft_order={ME: 10, "449991833737490432": 1, "1413552467941007360": 2, "473915927298043904": 3, "602943078759718912": 4,
                          "600053951794053120": 5, "1258153993742336000": 6, "603795407432122368": 7, "1413414048753516544": 8, "676985168833110016": 9},
             metadata=dict(name="NBA League Revamped "))
users = [dict(user_id=k, display_name=v) for k, v in {ME: "TrayBanks", "449991833737490432": "SergeantSleaze", "1413552467941007360": "vvaughns",
         "473915927298043904": "changodinho44", "602943078759718912": "Nickgarrison", "600053951794053120": "slimmothy",
         "1258153993742336000": "LawyerMan2", "603795407432122368": "Spence24s", "1413414048753516544": "LucidArtKnows", "676985168833110016": "ii3igt"}.items()]

# replica of the classic room (markup captured from the live page)
players = json.loads(open(os.path.join(EXT, "data.js")).read().split("var WR_DATA = ", 1)[1].rstrip().rstrip(";"))["players"]
taken = {x["player_id"] for x in picks[:N_PICKS]}
avail = sorted([p for p in players if p["id"] not in taken], key=lambda p: p["adp"])[:24]
rows = "".join(f'''<div class="player-rank-item2"><div class="draft-button-wrapper"><div class="draft-button {'' if STATUS=='drafting' and slot_for(N_PICKS+1)==10 else 'disable'}">+</div></div>
<div class="rank">{i+1}</div><div class="name"><div class="name-wrapper">{p["n"]}<div class="position">{"/".join(p["p"])} <span class="team">{p["t"]}</span></div></div>
<div class="queue-action">＋</div></div><div class="adp">{p["adp"]}</div><div class="fpts">{p["f"]:.1f}</div></div>''' for i, p in enumerate(avail))
cols = "".join(f'<div class="col"><div class="mgr">{u["display_name"]}</div>' + "".join(
    f'<div class="cell {"filled" if (rd-1)*10 + (s if rd%2 else 11-s) <= N_PICKS else ""}">{rd}.{s if rd%2 else 11-s}<br><b>{by_slot[s][rd-1].split(" ")[-1] if (rd-1)*10 + (s if rd%2 else 11-s) <= N_PICKS else ""}</b></div>' for rd in range(1, 7)) + "</div>"
    for s, u in zip(range(1, 11), [users[1], users[2], users[3], users[4], users[5], users[6], users[7], users[8], users[9], users[0]]))
html = f'''<!doctype html><html><head><meta charset="utf-8"><title>Sleeper</title><style>
body{{margin:0;background:#030616;color:#e8edf5;font:13px Lato,system-ui;}} .top{{height:80px;box-sizing:border-box;padding:24px 100px;font:500 18px Poppins,system-ui}}
.boardg{{display:flex;gap:4px;padding:8px;overflow:hidden}} .col{{flex:1;min-width:0}} .mgr{{font-size:11px;color:#9fb0c8;text-align:center;padding:4px;white-space:nowrap;overflow:hidden}}
.cell{{background:#21283C;height:46px;margin-bottom:4px;border-radius:4px;font-size:10px;padding:3px;color:#6f819c}} .cell.filled{{background:#2b3f5c;color:#cfe0f5}}
.bottom{{display:flex;position:fixed;top:450px;left:0;right:0;bottom:0}} .list{{flex:1;padding:8px 16px}} .player-rank-item2{{display:flex;gap:12px;padding:7px;border-bottom:1px solid #1d2a40;align-items:center}}
.name{{flex:1;display:flex}} .name-wrapper{{flex:1}} .position{{color:#7d8fa9;font-size:11px}} .draft-button{{background:#21a179;border-radius:4px;padding:2px 8px}} .draft-button.disable{{background:#334}}
.right-panel-wrapper{{width:454px;background:#283244;border-radius:10px 0 0 0;padding:10px}} .list{{background:#2D3649;overflow:hidden}} input{{background:#1b263b;border:0;color:#fff;padding:6px;border-radius:4px;width:260px}}
</style></head><body><div class="top draft-header">NBA League Revamped · 2 Min Per Pick · 10 Teams · 14 Rounds</div><div class="boardg">{cols}</div>
<div class="bottom"><div class="list"><input placeholder="Find player Ctrl + U">{rows}</div>
<div class="right-panel-wrapper queue-wrapper"><div class="draft-queue"><div class="autopick-toggle"><input type="checkbox"></div><div>QUEUE</div>
<div class="draft-queue-player-item"><div class="meta-container"><div class="name">Darius Garland</div></div><div class="delete-button">REMOVE</div></div>
<div class="draft-queue-player-item"><div class="meta-container"><div class="name">Paul George</div></div><div class="delete-button">REMOVE</div></div>
<div class="draft-queue-player-item"><div class="meta-container"><div class="name">Ty Jerome</div></div><div class="delete-button">REMOVE</div></div></div></div></div>
<script>localStorage.setItem("user_id", JSON.stringify("{ME}"));</script></body></html>'''

async def main():
    os.environ["PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS"] = "1"
    async with async_playwright() as pw:
        ctx = await pw.chromium.launch_persistent_context(
            tempfile.mkdtemp(prefix="wr-draft-"), headless=True, executable_path="/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
            args=[f"--disable-extensions-except={EXT}", f"--load-extension={EXT}", "--headless=new"], viewport={"width": 1440, "height": 900})
        async def api(route):
            u = route.request.url
            if u.endswith("/picks"): body = picks[:N_PICKS]
            elif "/users" in u: body = users
            elif "projections" in u: body = []
            elif "/draft/" in u: body = draft
            else: body = {}
            await route.fulfill(status=200, content_type="application/json", body=json.dumps(body), headers={"access-control-allow-origin": "*"})
        await ctx.route("https://api.sleeper.app/**", api)
        await ctx.route("https://api.sleeper.com/**", api)
        await ctx.route("https://sleeper.com/**", lambda r: r.fulfill(status=200, content_type="text/html", body=html))
        sw = ctx.service_workers[0] if ctx.service_workers else await ctx.wait_for_event("serviceworker", timeout=10000)
        print("service worker:", sw.url)
        page = ctx.pages[0] if ctx.pages else await ctx.new_page()
        logs = []
        page.on("console", lambda m: logs.append(f"{m.type}: {m.text}"))
        page.on("pageerror", lambda e: logs.append(f"pageerror: {e}"))
        await page.goto("https://sleeper.com/draft/nba/1398532732564320256")
        await page.wait_for_timeout(6000)
        state = await page.evaluate("""() => { const h=document.getElementById('wr-overlay-host'); if(!h) return null;
            const r=h.shadowRoot; return {banner:r.querySelector('#bn').innerText, take:r.querySelector('#take').innerText.slice(0,200), rows:r.querySelectorAll('.row').length, dot:r.querySelector('#dot').className}; }""")
        print("overlay state:", json.dumps(state, ensure_ascii=False))
        geo = await page.evaluate("""() => { const w=document.getElementById('wr-overlay-host').shadowRoot.querySelector('.wr'), r=w.getBoundingClientRect(), s=document.querySelector('.right-panel-wrapper').getBoundingClientRect();
            return {panel:[r.left,r.top,r.width,r.height].map(Math.round), side:[s.left,s.top,s.width,s.height].map(Math.round), cls:w.className, theme:w.dataset.theme}; }""")
        print("geometry:", geo)
        await page.screenshot(path=os.path.join(OUT, f"ext_{TAG}_board.png"))
        host = page.locator("#wr-overlay-host")
        for tab in ["plan", "team"]:
            await page.evaluate(f"""() => document.getElementById('wr-overlay-host').shadowRoot.querySelector('[data-act=tab][data-v={tab}]').click()""")
            await page.wait_for_timeout(250)
            await page.screenshot(path=os.path.join(OUT, f"ext_{TAG}_{tab}.png"))
        # live action through the bridge: queue Clingan via the overlay's +Q on the take-now card
        await page.evaluate("""() => document.getElementById('wr-overlay-host').shadowRoot.querySelector('[data-act=tab][data-v=board]').click()""")
        await page.wait_for_timeout(200)
        clicked = await page.evaluate("""() => { const r=document.getElementById('wr-overlay-host').shadowRoot; const b=r.querySelector('#take [data-act=queue]'); if(!b) return false; b.click(); return b.dataset.id; }""")
        await page.wait_for_timeout(3600)
        print("queue click on take-now card ->", clicked, "| search box restored to:", repr(await page.input_value('input[placeholder^="Find player"]')))
        print("console:", [l for l in logs if "error" in l.lower()][:5])
        await ctx.close()

asyncio.run(main())
