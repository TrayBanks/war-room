"""Load the unpacked extension in Chromium on a replica Sleeper league page and screenshot the Lock-In panel.
The real Nov 17-23, 2025 week (your mock roster's games) is shifted onto the current Mon-Sun week."""
import json, os, datetime as dt, asyncio, tempfile, shutil
from zoneinfo import ZoneInfo
from playwright.async_api import async_playwright

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXT, OUT, FX = os.path.join(BASE, "extension"), os.path.join(BASE, "reports", "screens"), os.path.join(BASE, "tests", "fixtures")
ME, LEAGUE = "107261208461459456", "1398532731020828672"

def psv(name):
    h, *rows = open(os.path.join(FX, name)).read().strip().split("\n")
    k = h.split("|")
    return [dict(zip(k, r.split("|"))) for r in rows]

today = dt.datetime.now(ZoneInfo("America/New_York")).date()
monday = today - dt.timedelta(days=today.weekday())
shift = lambda d: (monday + (dt.date.fromisoformat(d) - dt.date(2025, 11, 17))).isoformat()
T = today.isoformat()
sched, first = [], True
for g in psv("week5_sched.psv"):
    d = shift(g["date"]); status = "complete" if d < T else "pre_game"
    if d == T and first: status, first = "in_game", False
    sched.append(dict(date=d, week=3, status=status, home=dict(team=g["home"]), away=dict(team=g["away"])))
stats = [dict(player_id=r["player_id"], date=shift(r["date"]), team=r["team"], stats=dict(pts_std=float(r["pts_std"]), sp=float(r["sp"])))
         for r in psv("week5_stats.psv") if shift(r["date"]) < T]
ids = list(dict.fromkeys(r["player_id"] for r in psv("week5_stats.psv")))
rosters = [dict(owner_id=ME, roster_id=10, players=ids, starters=ids[:10])]

html = f"""<!doctype html><html><head><meta charset="utf-8"><title>Sleeper</title><style>
body{{margin:0;background:#181C28;color:#fff;font:14px Lato,system-ui}} .nav{{position:fixed;left:0;top:0;bottom:0;width:72px;background:#11141d}}
.center-panel{{position:fixed;left:96px;top:100px;width:800px;bottom:24px;background:rgba(58,70,91,.5);border-radius:16px;padding:24px;box-sizing:border-box}}
.right-panel{{position:fixed;left:920px;top:100px;width:496px;bottom:24px;background:rgba(58,70,91,.5);border-radius:16px;padding:16px;box-sizing:border-box;color:#A3BBD3}}
.hdr{{position:fixed;left:96px;top:30px;font:600 22px Poppins,system-ui}} .card{{background:#1C212D;border-radius:24px;height:64px;margin:16px 0}}
</style></head><body><div class="nav"></div><div class="hdr">NBA League Revamped</div>
<div class="center-panel"><div style="font:600 16px Poppins">Matchup · Week 3</div><div class="card"></div><div class="card"></div><div class="card"></div></div>
<div class="right-panel">League chat</div>
<script>localStorage.setItem("user_id", JSON.stringify("{ME}"));</script></body></html>"""

async def main():
    os.environ["PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS"] = "1"
    async with async_playwright() as pw:
        ctx = await pw.chromium.launch_persistent_context(
            tempfile.mkdtemp(prefix="wr-season-"), headless=True, executable_path="/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
            args=[f"--disable-extensions-except={EXT}", f"--load-extension={EXT}", "--headless=new"], viewport={"width": 1440, "height": 900})
        async def api(route):
            u = route.request.url
            if u.endswith("/rosters"): body = rosters
            elif "/schedule/nba" in u: body = sched
            elif "/stats/nba/" in u: body = stats
            elif "projections" in u: body = []
            elif f"/league/{LEAGUE}" in u: body = dict(league_id=LEAGUE, sport="nba", season="2026", name="NBA League Revamped")
            else: body = {}
            await route.fulfill(status=200, content_type="application/json", body=json.dumps(body), headers={"access-control-allow-origin": "*"})
        await ctx.route("https://api.sleeper.app/**", api)
        await ctx.route("https://api.sleeper.com/**", api)
        await ctx.route("https://sleeper.com/**", lambda r: r.fulfill(status=200, content_type="text/html", body=html))
        if not ctx.service_workers: await ctx.wait_for_event("serviceworker", timeout=10000)
        page = ctx.pages[0] if ctx.pages else await ctx.new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        await page.goto(f"https://sleeper.com/leagues/{LEAGUE}/matchup")
        await page.wait_for_timeout(5000)
        await page.screenshot(path=os.path.join(OUT, "season_collapsed.png"))
        await page.evaluate("() => document.getElementById('wr-season-host').shadowRoot.querySelector('.rail').click()")
        await page.wait_for_timeout(400)
        await page.screenshot(path=os.path.join(OUT, "season_week.png"))
        geo = await page.evaluate("""() => { const w=document.getElementById('wr-season-host').shadowRoot.querySelector('.wr'), r=w.getBoundingClientRect(), s=document.querySelector('.right-panel').getBoundingClientRect();
            return {panel:[r.left,r.top,r.width,r.height].map(Math.round), chat:[s.left,s.top,s.width,s.height].map(Math.round), cls:w.className,
                    banner: w.querySelector('#bn').innerText.replace(/\\n/g,' | '), cards: w.querySelectorAll('.lk').length}; }""")
        print("Lock-In panel:", geo)
        await page.evaluate("() => document.getElementById('wr-season-host').shadowRoot.querySelector('[data-act=tab][data-v=calc]').click()")
        await page.wait_for_timeout(200)
        await page.evaluate("""() => { const r=document.getElementById('wr-season-host').shadowRoot; const s=r.getElementById('c-id'); s.value='1658'; s.dispatchEvent(new Event('change',{bubbles:true})); }""")
        await page.wait_for_timeout(200)
        await page.evaluate("""() => { const r=document.getElementById('wr-season-host').shadowRoot; const i=r.getElementById('c-score'); i.value='47'; i.dispatchEvent(new Event('input',{bubbles:true})); }""")
        await page.wait_for_timeout(200)
        await page.screenshot(path=os.path.join(OUT, "season_calc.png"))
        print("errors:", errs[:3])
        await ctx.close()

asyncio.run(main())
