"""Refresh data/ from Sleeper's public API, then rebuild with `python3 model/build_ext.py`.

    python3 tools/fetch_sleeper.py                 # projections, ADP, injuries, teams for players already in data/players.psv
    python3 tools/fetch_sleeper.py --add 260       # also add anyone with Sleeper ADP under 260 who isn't listed yet
    python3 tools/fetch_sleeper.py --schedule      # also rebuild data/schedule2026.psv (games per team per week)
    python3 tools/fetch_sleeper.py --from-file proj.json   # offline: use a saved projections payload

Read-only, no login. Hand-tuned fields stay put: availability overrides live in model/build_ext.py, 2025 games
(gp25, afp25) and game-log spreads (data/gamelogs.psv) are only refreshed by their own steps.
Network: needs api.sleeper.com. If a sandbox blocks it, fetch the JSON in a browser tab on sleeper.com and pass --from-file.
"""
import argparse, json, os, sys, urllib.request, collections

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(BASE, "data")
STATS = ["pts", "reb", "ast", "stl", "blk", "to", "tpm", "dd", "td", "min"]
SCORING = dict(pts=0.5, reb=1, ast=1, stl=2, blk=2, to=-1, tpm=0.5, dd=1, td=2)

def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "war-room"}), timeout=30) as r:
        return json.load(r)

def read_psv(name):
    lines = open(os.path.join(DATA, name), encoding="utf-8").read().rstrip("\n").split("\n")
    head = lines[0].split("|")
    return head, [dict(zip(head, l.split("|"))) for l in lines[1:]]

def write_psv(name, head, rows):
    with open(os.path.join(DATA, name), "w", encoding="utf-8") as f:
        f.write("|".join(head) + "\n" + "".join("|".join(str(r.get(h, "")) for h in head) + "\n" for r in rows))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", default="2026")
    ap.add_argument("--add", type=float, default=0, help="add unlisted players with ADP below this")
    ap.add_argument("--schedule", action="store_true")
    ap.add_argument("--from-file")
    a = ap.parse_args()

    proj = json.load(open(a.from_file)) if a.from_file else get(f"https://api.sleeper.com/projections/nba/{a.season}?season_type=regular")
    by_id = {str(r["player_id"]): r for r in proj if r.get("stats")}
    head, players = read_psv("players.psv")
    _, idrows = read_psv("ids.psv")
    name_to_id = {r["name"]: r["id"] for r in idrows}
    changed = collections.Counter()
    for p in players:
        r = by_id.get(name_to_id.get(p["name"], ""))
        if not r: changed["no projection"] += 1; continue
        s, pl = r["stats"], r.get("player") or {}
        for k in STATS:
            if k in s: p[k] = round(float(s[k]), 2)
        p["fp"] = round(sum(float(s.get(k, 0)) * w for k, w in SCORING.items()), 2)
        if s.get("adp_std") and float(s["adp_std"]) < 999: p["adp"] = round(float(s["adp_std"]), 1)
        team = r.get("team") or pl.get("team")
        if team and team != p["team"]: changed["team changes"] += 1; p["team"] = team
        inj = pl.get("injury_status") or ""
        if inj != p.get("inj", ""): changed["injury changes"] += 1
        p["inj"] = inj
        changed["updated"] += 1
    if a.add:
        listed = set(name_to_id.get(p["name"]) for p in players)
        for pid, r in by_id.items():
            s, pl = r["stats"], r.get("player") or {}
            adp = float(s.get("adp_std") or 999)
            if pid in listed or adp >= a.add or not pl.get("first_name"): continue
            name = f'{pl["first_name"]} {pl["last_name"]}'
            row = {k: round(float(s.get(k, 0)), 2) for k in STATS}
            row.update(name=name, team=r.get("team") or pl.get("team") or "FA", pos="/".join(pl.get("fantasy_positions") or [pl.get("position") or "?"]),
                       adp=round(adp, 1), fp=round(sum(float(s.get(k, 0)) * w for k, w in SCORING.items()), 2), gp25=0, afp25=0, inj=pl.get("injury_status") or "")
            players.append(row); idrows.append({"id": pid, "name": name}); changed["added"] += 1
        write_psv("ids.psv", ["id", "name"], idrows)
    players.sort(key=lambda p: float(p["adp"] or 999))
    write_psv("players.psv", head, players)
    if a.schedule:
        games = get(f"https://api.sleeper.com/schedule/nba/regular/{a.season}")
        weeks = max(g["week"] for g in games)
        cnt = collections.defaultdict(lambda: [0] * weeks)
        for g in games:
            for side in ("home", "away"): cnt[g[side]["team"]][g["week"] - 1] += 1
        write_psv(f"schedule{a.season}.psv", ["team", f"games_by_week_1_to_{weeks}"],
                  [{"team": t, f"games_by_week_1_to_{weeks}": "".join(str(min(9, c)) for c in v)} for t, v in sorted(cnt.items())])
        changed["schedule teams"] = len(cnt)
    print(", ".join(f"{v} {k}" for k, v in changed.items()) or "nothing changed")

if __name__ == "__main__":
    sys.exit(main())
