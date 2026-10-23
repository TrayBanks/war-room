"""
Build the War Room extension data + Top 120 rankings.
Value = Sleeper per-game projection scored with THIS league's settings × expected share of games played.
Outputs: extension/data.js, reports/top120.md (Obsidian), reports/top120.csv
"""
import json, os, datetime
import numpy as np, pandas as pd

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # repo root
EXT = os.path.join(BASE, "extension"); os.makedirs(EXT, exist_ok=True)
OUT = os.path.join(BASE, "reports"); os.makedirs(OUT, exist_ok=True)

SCORING = dict(pts=0.5, reb=1, ast=1, stl=2, blk=2, to=-1, tpm=0.5, dd=1, td=2)
P = pd.read_csv(os.path.join(BASE, "data", "players.psv"), sep="|", keep_default_na=False)
for c in ["adp", "pts", "reb", "ast", "stl", "blk", "to", "tpm", "dd", "td", "min", "fp", "gp25", "afp25"]:
    P[c] = pd.to_numeric(P[c].replace("", 0)).astype(float)
ids = pd.read_csv(os.path.join(BASE, "data", "ids.psv"), sep="|", dtype=str)
P = P.merge(ids, on="name", how="left")
assert P["id"].notna().all(), P[P["id"].isna()]["name"].tolist()
P["fppg"] = sum(P[k] * w for k, w in SCORING.items())

ROOKIES = {"Cameron Boozer", "Darryn Peterson", "AJ Dybantsa", "Caleb Wilson", "Mikel Brown", "Yaxel Lendeborg",
           "Kingston Flemings", "Morez Johnson", "Darius Acuff", "Keaton Wagler", "Aday Mara", "Brayden Burries",
           "Nate Ament", "Zuby Ejiofor", "Cameron Carr", "Hannes Steinbach", "Alex Karaban", "Tarris Reed",
           "Labaron Philon", "Allen Graves", "Dailyn Swain", "Bennett Stirtz", "Joshua Jefferson"}
OVERRIDE = {"Jayson Tatum": .80, "Tyrese Haliburton": .82, "Kyrie Irving": .72, "Damian Lillard": .68,
            "Fred VanVleet": .75, "Zach Edey": .62, "Jimmy Butler": .40, "Brandon Ingram": .50, "Shaedon Sharpe": .55,
            "Kristaps Porziņģis": .55, "Walker Kessler": .75, "Domantas Sabonis": .72, "Anthony Davis": .62,
            "Joel Embiid": .55, "Trae Young": .75, "LeBron James": .72, "Giannis Antetokounmpo": .72,
            "Ja Morant": .60, "Jalen Williams": .75, "Franz Wagner": .70, "Dejounte Murray": .70,
            "Mark Williams": .55, "Donte DiVincenzo": .25, "Tyler Herro": .70, "Stephen Curry": .75,
            "Jusuf Nurkić": .45, "Cam Thomas": .35, "Kel'el Ware": .85}

def avail(r):
    if r["name"] in OVERRIDE: return OVERRIDE[r["name"]]
    if r.gp25 == 0: return .85 if r["name"] in ROOKIES else .75
    return float(np.clip(.55 * min(r.gp25, 82) / 82 + .45 * .85, .40, .93))

P["avail"] = P.apply(avail, axis=1)
P["value"] = P["fppg"] * P["avail"]
P["floor_rank"] = P["value"].rank(ascending=False, method="first").astype(int)

# ---------------- Lock-In value (one locked game per starter per week)
from lock_value import shrunk_cv, lock_value, Z_GRID
G = pd.read_csv(os.path.join(BASE, "data", "gamelogs.psv"), sep="|", dtype={"id": str})
P = P.merge(G[["id", "n", "mean", "sd"]].rename(columns={"n": "gl_n", "mean": "gl_mean", "sd": "gl_sd"}), on="id", how="left")
pool = G[(G["n"] >= 25) & (G["mean"] >= 15)]
POOL_CV = float((pool["sd"] / pool["mean"]).median())
SCHED = {r.team: [int(c) for c in r.games_by_week_1_to_25] for r in pd.read_csv(os.path.join(BASE, "data", "schedule2026.psv"), sep="|", dtype=str).itertuples()}
REG, PO = list(range(1, 19)), [19, 20, 21]
cvs, lvs, lvps, pgs, aws, rests = [], [], [], [], [], []
for _, r in P.iterrows():
    cv = shrunk_cv(r.gl_n if pd.notna(r.gl_n) else 0, r.gl_mean, r.gl_sd, POOL_CV, rookie=r["name"] in ROOKIES)
    sched = SCHED.get(r["team"], [3] * 25)
    lv, w, aw, rest = lock_value(r.fppg, cv, r.avail, r["name"], sched, REG)
    lvp, *_ = lock_value(r.fppg, cv, r.avail, r["name"], sched, PO)
    cvs.append(cv); lvs.append(lv); lvps.append(lvp); pgs.append(sum(sched[w_ - 1] for w_ in PO)); aws.append(aw); rests.append(rest)
P["cv"], P["lv"], P["lvp"], P["pgames"], P["aweek"], P["rest"] = cvs, lvs, lvps, pgs, aws, rests
P = P.sort_values("lv", ascending=False).reset_index(drop=True)
P["rank"] = np.arange(1, len(P) + 1)
P["adp_rank"] = P["adp"].rank(method="first").astype(int)
P["gap"] = P["adp_rank"] - P["rank"]          # + = cheaper than he should be

# tiers: break when the drop to the next player is large relative to local spacing
tiers, t, start_i = [], 1, 0
for i, v in enumerate(P["lv"]):
    if i > 0:
        drop = P["lv"].iloc[i - 1] - v
        spread = P["lv"].iloc[start_i] - v
        if (drop >= 0.55 and i - start_i >= 3) or spread > 2.0:
            t += 1; start_i = i
    tiers.append(t)
P["tier"] = tiers

NOTES = {
    "Kyrie Irving": "Missed 2025-26 (ACL). No limits; back-to-backs managed",
    "Damian Lillard": "Missed 2025-26 (Achilles). Full go at camp",
    "Zach Edey": "Ankle history. Cleared; minutes managed early",
    "Kel'el Ware": "Shares center with Myles Turner in MIL",
    "Myles Turner": "Shares center with Ware; trade candidate",
    "LeBron James": "Age 41, signed with PHI",
    "LaMelo Ball": "Traded to MIN",
    "Giannis Antetokounmpo": "Traded to MIA. 36 games last year",
    "Jimmy Butler": "Out: knee surgery", "Brandon Ingram": "Out: heel surgery",
    "Shaedon Sharpe": "Out: knee surgery", "Kristaps Porziņģis": "Out (undisclosed)",
    "Mark Williams": "Out: shoulder", "Donte DiVincenzo": "Out: Achilles surgery", "Jusuf Nurkić": "Out: foot",
    "Tyrese Haliburton": "Missed 2025-26 (Achilles)", "Jayson Tatum": "16 games last year after Achilles",
    "Walker Kessler": "5 games last year; now LAL", "Domantas Sabonis": "19 games last year",
    "Anthony Davis": "20 games last year", "Joel Embiid": "38 games last year", "Trae Young": "15 games last year",
    "Ja Morant": "20 games last year; now POR", "Donovan Clingan": "Top-12 value; ADP lags badly",
    "Josh Giddey": "Rebounds + assists machine", "Derik Queen": "21 FPPG, durable",
    "Ryan Rollins": "21 FPPG at a late ADP", "Day'Ron Sharpe": "21 FPPG at waiver ADP",
    "Cam Thomas": "Unsigned free agent", "Fred VanVleet": "Missed 2025-26", "Dejounte Murray": "14 games last year",
    "Jalen Johnson": "Top-5 points-league value", "Onyeka Okongwu": "Stocks + boards, durable",
    "Rudy Gobert": "Boards + blocks, 76 games last year",
}
def note(r):
    n = NOTES.get(r["name"], "")
    if not n and r["name"] in ROOKIES: n = "Rookie: projection only"
    return n

P["note"] = P.apply(note, axis=1)
P["pos_list"] = P["pos"].str.split("/")

players = []
for _, r in P.iterrows():
    players.append(dict(id=r["id"], n=r["name"], t=r["team"], p=r["pos_list"], adp=round(float(r.adp), 1),
                        f=round(float(r.fppg), 2), a=round(float(r.avail), 2), v=round(float(r.value), 2),
                        lv=round(float(r.lv), 2), lk=round(float(r.lv / r.fppg), 4) if r.fppg else 0, cv=round(float(r.cv), 3),
                        aw=round(float(r.aweek), 3), rest=round(float(r.rest), 3), pg=int(r.pgames), lvp=round(float(r.lvp), 2),
                        rk=int(r["rank"]), frk=int(r.floor_rank), tier=int(r.tier), note=r["note"], inj=r["inj"],
                        s=[round(float(r[k]), 2) for k in ["pts", "reb", "ast", "stl", "blk", "to", "tpm", "dd", "td"]]))

league = dict(
    name="NBA League Revamped", league_id="1398532731020828672", draft_id="1398532732564320256",
    user_id="107261208461459456", teams=10, rounds=14, pick_timer=120,
    slots=["PG", "SG", "G", "SF", "PF", "F", "C", "UTIL", "UTIL"], bench=5, scoring=SCORING,
    slot_ok={"PG": ["PG"], "SG": ["SG"], "G": ["PG", "SG"], "SF": ["SF"], "PF": ["PF"], "F": ["SF", "PF"],
             "C": ["C"], "UTIL": ["PG", "SG", "SF", "PF", "C"]},
    availability=dict(OVERRIDE), rookies=sorted(ROOKIES),
    lock=dict(pool_cv=round(POOL_CV, 3), z=[round(float(z), 3) for z in Z_GRID[::10]], schedule=SCHED,
              reg_weeks=REG, playoff_weeks=PO, season_start="2026-10-20"),
)
# Report game plan, keyed by the overall pick window (slot 10)
plan = [
    dict(picks=[10, 11], text="Jalen Johnson + the best big left (Şengün or Towns). Flagg is close. If Giannis falls, he is the ceiling swing at 72% availability."),
    dict(picks=[30, 31], text="LaMelo, Banchero, Murray or Bam. If bigs are flying, take Clingan here: top-12 value with a 93 ADP."),
    dict(picks=[50, 51], text="Last safe window for Clingan. Otherwise Duren or Randle. Kessler only as an upside swing."),
    dict(picks=[70, 71], text="Okongwu, Gobert, Knueppel or Pritchard. Two bigs here is fine; rebounds pay double."),
    dict(picks=[90, 91], text="Buzelis is the best forward value. Edey is upside, not a starter you can count on."),
    dict(picks=[110, 111], text="Derik Queen plays ~93% of games at 21 FPPG. Kyrie is the upside pick."),
    dict(picks=[130, 131], text="Ryan Rollins and Podziemski. Lillard is often still here; take him if so."),
]
fades = ["Ja Morant", "Joel Embiid", "Jaren Jackson", "Franz Wagner", "Darius Garland", "AJ Dybantsa", "Paul George", "Ty Jerome"]
built = datetime.datetime(2026, 10, 17).strftime("%b %d, %Y")
data = dict(built=built, league=league, players=players, plan=plan, fades=fades)
with open(os.path.join(EXT, "data.js"), "w") as f:
    f.write("/* War Room data — generated by build_ext.py on " + built + " */\nvar WR_DATA = ")
    json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    f.write(";\n")

# ---------------- Top 120 exports
top = P.head(120).copy()
top["move"] = top["floor_rank"] - top["rank"]
top["spread"] = (top["cv"] * 100).round(0).astype(int)
top[["rank", "tier", "name", "pos", "team", "fppg", "spread", "avail", "lv", "floor_rank", "move", "adp", "adp_rank", "gap", "pgames", "note"]].rename(
    columns={"lv": "lock_value", "spread": "spread_pct", "pgames": "playoff_games_wk19_21", "floor_rank": "old_rank"}).to_csv(
    os.path.join(OUT, "top120.csv"), index=False, float_format="%.2f")

def sgn(g):
    return f"+{g}" if g > 0 else ("–" if g == 0 else str(g))
lines = ["---", "title: Top 120 (Lock-In) — NBA League Revamped", "tags: [fantasy, nba, draft]", "built: 2026-10-17", "---", "",
         "# Top 120 — NBA League Revamped (H2H points, Lock-In)", "",
         "Each starter counts **one locked game per week**, so this ranks players by **lock value**: the score you can expect to lock "
         "each week if you lock optimally, given his projected average, his game-to-game spread (from 2025-26 game logs), his team's "
         "2026 schedule, and missed-week risk.", "",
         "- **Spread** = game-to-game swing as a % of his average. Higher spread = bigger best game = more lock value.",
         "- **Old** = his rank in yesterday's report, which assumed every game counts. **Move** = how far Lock-In moves him.",
         "- **PO games** = his team's games in fantasy playoff weeks 19–21.", "",
         "Scoring: 0.5/pt · 1/reb · 1/ast · 2/stl · 2/blk · −1/TO · 0.5/3PM · +1 DD · +2 TD.", ""]
for tier_id, grp in top.groupby("tier", sort=False):
    lo, hi = grp["rank"].min(), grp["rank"].max()
    lines += [f"## Tier {tier_id} · ranks {lo}–{hi}", "",
              "| # | Player | Pos | Team | FPPG | Spread | Lock value | Old | Move | ADP | PO games | Note |",
              "|---:|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|"]
    for _, r in grp.iterrows():
        lines.append(f"| {r['rank']} | {r['name']} | {r['pos']} | {r['team']} | {r.fppg:.1f} | {r.spread}% | {r.lv:.1f} | "
                     f"{r.floor_rank} | {sgn(int(r.move))} | {r.adp:.0f} | {int(r.pgames)} | {r['note']} |")
    lines.append("")
open(os.path.join(OUT, "top120.md"), "w").write("\n".join(lines))
print(len(players), "players ·", P.head(120)["tier"].nunique(), "tiers in top 120 · pool cv", round(POOL_CV, 3))
show = P.head(60).copy(); show["move"] = show["floor_rank"] - show["rank"]
print(show[["rank", "tier", "name", "fppg", "cv", "lv", "floor_rank", "move", "adp"]].to_string(index=False))
mv = P.head(150).copy(); mv["move"] = mv["floor_rank"] - mv["rank"]
print("\nBIGGEST RISERS:", mv.sort_values("move", ascending=False).head(12)[["name", "rank", "floor_rank", "cv"]].values.tolist())
print("BIGGEST FALLERS:", mv.sort_values("move").head(12)[["name", "rank", "floor_rank", "cv"]].values.tolist())
