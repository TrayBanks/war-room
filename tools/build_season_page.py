"""Assemble the Slot 10 War Room season page from one refresh's outputs.
    python3 tools/build_season_page.py [<date>] [--site DIR]
Reads reports/season_<date>.json (+ _wide), reports/trending_<date>.json, data/live/league_<date>.json,
data/live/week_page_<date>.json and data/live/trending_<date>.json (optional hand notes in "short").
Writes reports/slot10_war_room.html (the claude.ai artifact body). With --site DIR it also writes a complete,
installable page for GitHub Pages: DIR/index.html, DIR/manifest.webmanifest and the icons."""
import json, os, sys, glob, shutil, datetime as dt
from zoneinfo import ZoneInfo

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
args = [a for a in sys.argv[1:] if not a.startswith("--")]
site = sys.argv[sys.argv.index("--site") + 1] if "--site" in sys.argv else None
if site in args: args.remove(site)
d = args[0] if args else sorted(glob.glob(os.path.join(BASE, "data", "live", "league_*.json")))[-1][-15:-5]
J = lambda *p: json.load(open(os.path.join(BASE, *p)))
R, RW = J("reports", f"season_{d}.json"), J("reports", f"season_{d}_wide.json")
LG, WK = J("data", "live", f"league_{d}.json"), J("data", "live", f"week_page_{d}.json")
ME = "107261208461459456"
names = {r[0]: LG["users"][r[1]][0] for r in LG["rosters"]}
my_rid = next(r[0] for r in LG["rosters"] if r[1] == ME)
cur = LG.get("curWeek", 1)
results = LG.get("results", [])

weeks = []
for w, mids in enumerate(LG["weeks"][:18]):
    mid = mids[my_rid - 1]
    opp = next(rid for rid in names if rid != my_rid and mids[rid - 1] == mid)
    row = {"w": w + 1, "opp": names[opp], "odds": R["myWeekWin"][w]}
    if w < len(results) and w + 1 < cur:
        a, b = results[w].get(str(my_rid), 0), results[w].get(str(opp), 0)
        row.update(res="W" if a > b else "L", score=f"{a:g}–{b:g}")
    weeks.append(row)
WK["odds"] = R["myWeekWin"][cur - 1]

ts = dt.datetime.fromisoformat(LG.get("asofTs", LG["asof"] + "T12:00:00").replace("Z", "+00:00"))
if ts.tzinfo is None: ts = ts.replace(tzinfo=dt.timezone.utc)
ct = ts.astimezone(ZoneInfo("America/Chicago"))
stamp = ct.strftime("%a %b %-d, %-I:%M %p CT")
teams = R["teams"]
me = next(t for t in teams if t["me"]); mew = next(t for t in RW["teams"] if t["me"])
po_rank = sorted(teams, key=lambda t: -t["pmean"]).index(me) + 1
wins_rank = sorted(teams, key=lambda t: -t["wins"]).index(me) + 1
room = R["room"]
adp_driven = sum(1 for r in room if not r["me"] and r["label"] == "ADP-driven")
mixed = sum(1 for r in room if not r["me"] and r["label"] == "Mixed")
notes = {
 "room": (f"Sharpness learned from every pick of the real draft: 0 = drafted straight off Sleeper ADP, 100 = drafted by Lock-In value. "
          f"You were the only manager drafting by value. {adp_driven} of the other nine drafted mostly off ADP and {mixed} were mixed, "
          "so the trade market here prices players by name and ADP. That gap is your edge."),
 "waivers": ("Free agents who would raise your weekly total, each paired with the bench player he replaces. "
             "Gains are small (about +1 point a week) because a 5th-bench spot rarely plays. Numbers use preseason projections "
             "nudged by recent games. FAAB budget: $100 for the season."),
 "next": "Next up: live scores between refreshes.",
 "steps": [
   "<b>Done: this page refreshes itself</b> at 6 AM, 12 PM, 5 PM and 11:30 PM Central, straight from Sleeper. On Android, open it in Chrome and tap Add to Home screen.",
   "<b>Live scores between refreshes.</b> The page pulls your matchup from Sleeper each time you open it, so game nights don't wait for the next refresh.",
   "<b>Today screen.</b> A day-by-day plan for who starts in each slot, built from the lock calls above.",
   "<b>Two-sided trade check.</b> Paste an offer and see rest-of-season value, fit and playoff-week games for both sides.",
   "<b>Better projections.</b> Blend this season's minutes and usage into the preseason values as games pile up."],
 "assumptions": [
   ["The model grades its own homework", "The same Lock-In values drafted your team and now rank it. If those values are off, your edge is smaller than shown. Real weekly results will test it within a few weeks."],
   ["Weekly swings", f"Each team's total varies about 22 points week to week. With 30-point swings your title odds drop to {round(mew['title']*100)}% and your record to {mew['wins']:.1f} wins. Use the toggle in Season outlook."],
   ["Preseason projections", "Roles change in October. Minutes and usage from the first few weeks should replace preseason numbers, especially for your bench adds."],
   ["Bench counts 15%", "Under Lock-In a bench player helps only when a starter sits or has fewer games that week. If you churn the bench for extra games, that share goes up."],
   ["Locks you haven't told me about", "Sleeper's API doesn't show locks until a player plays again. Tap \"I locked this\" in This week so the calls skip him."]],
 "footer": (f"<span>Updated {stamp} from Sleeper's public API (league, rosters, matchups, real draft, projections, box scores, trending). "
            "Refreshes at 6 AM, 12 PM, 5 PM and 11:30 PM Central. Lock-In values come from 2025-26 game logs and the 2026 schedule; "
            "6,000 simulated seasons on the league's real schedule, 6-team playoffs in weeks 19–21, top two seeds get byes. "
            "Built from the war-room repo.</span>"),
}

trend = None
tp = os.path.join(BASE, "reports", f"trending_{d}.json")
if os.path.exists(tp):
    TR = json.load(open(tp))
    seen = {}
    for r in TR["add"] + TR["drop"]:
        seen.setdefault(r["id"], r)
    ups = sorted([r for r in seen.values() if r["net"] > 0], key=lambda r: -r["net"])[:14]
    downs = sorted([r for r in seen.values() if r["net"] < 0], key=lambda r: r["net"])[:10]
    mine_down = sorted([r for r in seen.values() if r["verdict"] == "Yours: drop candidate"], key=lambda r: r["net"])
    downs += [r for r in mine_down if r not in downs]          # your own players always show
    picks = sorted([r for r in seen.values() if r["verdict"] in ("Add", "Speculative add", "Buy-low add") and r["gain"]], key=lambda r: -r["gain"])
    lt = os.path.join(BASE, "data", "live", f"trending_{d}.json")
    short = json.load(open(lt)).get("short", {}) if os.path.exists(lt) else {}
    lastn = lambda n: n.replace(" Jr.", "").replace(" III", "").replace(" II", "").split()[-1]
    def why(r):
        if r["id"] in short: return short[r["id"]]
        g = r.get("last") or r.get("week1")
        if r.get("inj") in ("Out", "IR"): return f"Listed {r['inj']}"
        if not g: return "No game yet" if r["team"] != "FA" else "No team"
        if not g["min"]: return "Didn't play last game"
        s = f"{g['fp']:g} FP in {g['min']} min"
        if r["net"] > 0 and r.get("out"): s += f" · {lastn(r['out'][0])} out"
        return s
    def slim(r):
        g = r.get("last") or r.get("week1")
        return {"name": r["name"], "team": r["team"], "pos": r["pos"], "net": r["net"], "verdict": r["verdict"], "gain": r["gain"], "why": why(r),
                "fp": g["fp"] if g and g["min"] else None}
    move = None
    if mine_down and picks:
        move = {"drop": mine_down[0]["name"], "dropWhy": why(mine_down[0]), "add": picks[0]["name"], "addLast": lastn(picks[0]["name"]), "addWhy": why(picks[0]), "gain": picks[0]["gain"],
                "alts": [{"name": p["name"], "gain": p["gain"]} for p in picks[1:3]]}
    yours = [slim(r) for r in seen.values() if r["verdict"].startswith("Yours")]
    trend = {"meta": f"Last {TR['lookback']} hours · as of {stamp}",
             "sub": ("Net = adds minus drops across all of Sleeper. +/wk = what he'd add to your lineup in place of your weakest bench player "
                     "(projection nudged toward his latest game when he played 20+ minutes; one game is a small sample)."),
             "move": move,
             "free": [slim(r) for r in picks[:4]],
             "watch": [slim(r) for r in seen.values() if r["verdict"] == "Watch"][:3],
             "yours": sorted(yours, key=lambda r: r["net"]),
             "add": [slim(r) for r in ups], "drop": [slim(r) for r in downs]}

rec = LG.get("record", {}).get(str(my_rid), [0, 0, 0])
D = {"record": rec, "trending": trend, "eyebrow": f"Slot 10 War Room · NBA League Revamped · Lock-In · Week {cur} · updated {stamp}",
     "teams": teams, "teamsWide": RW["teams"], "cum": R["cum"], "myWeeks": weeks, "week1": WK, "room": room,
     "myDraft": R["myDraft"], "slots": R["slots"], "bench": R["bench"], "coverage": R["coverage"], "adds": R["adds"],
     "buy": R["buy"], "playoffGames": R["myPlayoffGames"], "notes": notes}
tpl = open(os.path.join(BASE, "model", "season_page", "template_v2.html")).read()
libs = "\n".join(open(os.path.join(BASE, f)).read() for f in ("extension/lock.js", "tools/lockweek.js")).replace("</", "<\\/")
tpl = tpl.replace("/*__LIBS__*/", libs)
fill = lambda data: tpl.replace("/*__DATA__*/null", json.dumps(data, ensure_ascii=False).replace("</", "<\\/"))
body = fill(D)
out = os.path.join(BASE, "reports", "slot10_war_room.html")
open(out, "w").write(fill({**D, "liveLink": True}))    # the claude.ai copy is a snapshot: point it at the live page
print("wrote", out, len(body), "bytes;", f"week {cur}; you: {me['wins']} wins, {me['playoff']:.0%} PO, {me['title']:.0%} title (wide {mew['title']:.0%}), rank {wins_rank}; playoff-week rank {po_rank}; this week {WK['odds']:.0%}")

if site:
    os.makedirs(site, exist_ok=True)
    head = ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
            '<meta name="theme-color" content="#0A1A3D"><meta name="color-scheme" content="light dark">'
            '<meta name="description" content="Tray\'s War Room for NBA League Revamped: lock calls, waivers, season odds. Refreshes 4 times a day.">'
            '<link rel="manifest" href="manifest.webmanifest"><link rel="icon" href="icon.svg" type="image/svg+xml">'
            '<link rel="apple-touch-icon" href="icon-192.png"><meta name="mobile-web-app-capable" content="yes">'
            '<style>html,body{margin:0}</style></head><body>')
    open(os.path.join(site, "index.html"), "w").write(head + body + "</body></html>")
    json.dump({"name": "Slot 10 War Room", "short_name": "War Room", "start_url": "./", "scope": "./", "display": "standalone",
               "background_color": "#050E24", "theme_color": "#0A1A3D", "description": "Lock calls, waivers and season odds for NBA League Revamped.",
               "icons": [{"src": "icon-192.png", "sizes": "192x192", "type": "image/png"}, {"src": "icon-512.png", "sizes": "512x512", "type": "image/png"},
                         {"src": "icon.svg", "sizes": "any", "type": "image/svg+xml"}]},
              open(os.path.join(site, "manifest.webmanifest"), "w"))
    brand = os.path.join(BASE, "site_assets")
    for f in ("icon.svg", "icon-192.png", "icon-512.png"):
        if os.path.exists(os.path.join(brand, f)): shutil.copy(os.path.join(brand, f), os.path.join(site, f))
    json.dump({"updated": LG.get("asofTs"), "week": cur, "odds": WK["odds"], "record": rec}, open(os.path.join(site, "status.json"), "w"))
    print("wrote site to", site)
