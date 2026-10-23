"""
NBA League Revamped — mock draft analysis (Sleeper, 10-team H2H points, daily lineups)

Pipeline
  1. Load Sleeper 2026-27 per-game projections + Sleeper ADP (pulled from api.sleeper.com)
  2. Score each player with THIS league's scoring (Sleeper standard points)
  3. Estimate availability (share of team games played) — two scenarios
  4. Monte Carlo: simulate every day of an 18-week season + 3 playoff weeks with
     daily optimal lineups (PG SG G SF PF F C UTIL UTIL), then H2H matchups
  5. Grade each pick, build alternative draft paths on the same board, list targets
Outputs: out/results.json (feeds the dashboard), out/summary.png
"""
import json, itertools, os
import numpy as np, pandas as pd
from scipy.optimize import linear_sum_assignment

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # repo root
OUT = os.path.join(BASE, "reports"); os.makedirs(OUT, exist_ok=True)
rng_seed = 7

# ---------------------------------------------------------------- league scoring
SCORING = dict(pts=0.5, reb=1, ast=1, stl=2, blk=2, to=-1, tpm=0.5, dd=1, td=2)
SLOTS = ["PG", "SG", "G", "SF", "PF", "F", "C", "UTIL", "UTIL"]
SLOT_OK = {"PG": {"PG"}, "SG": {"SG"}, "G": {"PG", "SG"}, "SF": {"SF"}, "PF": {"PF"},
           "F": {"SF", "PF"}, "C": {"C"}, "UTIL": {"PG", "SG", "SF", "PF", "C"}}
REG_WEEKS, PLAYOFF_WEEKS, PLAYOFF_TEAMS = 18, 3, 6
P_TEAM_PLAYS = 82 / 170          # chance an NBA team plays on a given day

# ---------------------------------------------------------------- players
P = pd.read_csv(os.path.join(BASE, "data", "players.psv"), sep="|", keep_default_na=False)
num = ["adp", "pts", "reb", "ast", "stl", "blk", "to", "tpm", "dd", "td", "min", "fp", "gp25", "afp25"]
for c in num:
    P[c] = pd.to_numeric(P[c].replace("", 0)).astype(float)
P["fppg"] = sum(P[k] * w for k, w in SCORING.items())
assert (P["fppg"] - P["fp"]).abs().max() < 0.05, "scoring mismatch vs browser calc"
P = P.set_index("name")

ROOKIES = {"Cameron Boozer", "Darryn Peterson", "AJ Dybantsa", "Caleb Wilson", "Mikel Brown",
           "Yaxel Lendeborg", "Kingston Flemings", "Morez Johnson", "Darius Acuff", "Keaton Wagler",
           "Aday Mara", "Brayden Burries", "Nate Ament", "Zuby Ejiofor", "Cameron Carr",
           "Hannes Steinbach", "Alex Karaban", "Tarris Reed", "Labaron Philon", "Allen Graves",
           "Dailyn Swain", "Bennett Stirtz", "Joshua Jefferson"}
# Injury-adjusted share of team games played (my estimates; documented in dashboard)
OVERRIDE = {"Jayson Tatum": .80, "Tyrese Haliburton": .82, "Kyrie Irving": .72,
            "Damian Lillard": .68, "Fred VanVleet": .75, "Zach Edey": .62, "Jimmy Butler": .40,
            "Brandon Ingram": .50, "Shaedon Sharpe": .55, "Kristaps Porziņģis": .55,
            "Walker Kessler": .75, "Domantas Sabonis": .72, "Anthony Davis": .62,
            "Joel Embiid": .55, "Trae Young": .75, "LeBron James": .72,
            "Giannis Antetokounmpo": .72, "Ja Morant": .60, "Jalen Williams": .75,
            "Franz Wagner": .70, "Dejounte Murray": .70, "Mark Williams": .55,
            "Donte DiVincenzo": .25, "Tyler Herro": .70, "Stephen Curry": .75,
            "Jusuf Nurkić": .45, "Cam Thomas": .35, "Kel'el Ware": .85}
CLEARLY_OUT = {"Jimmy Butler", "Brandon Ingram", "Donte DiVincenzo", "Shaedon Sharpe",
               "Mark Williams", "Kristaps Porziņģis", "Jusuf Nurkić", "Cam Thomas"}

def avail_injury(name, r):
    if name in OVERRIDE: return OVERRIDE[name]
    if r.gp25 == 0: return .85 if name in ROOKIES else .75
    a = .55 * min(r.gp25, 82) / 82 + .45 * .85
    return float(np.clip(a, .40, .93))

def avail_proj(name, r):
    return OVERRIDE.get(name, .88) if name in CLEARLY_OUT else .88

P["a_inj"] = [avail_injury(n, r) for n, r in P.iterrows()]
P["a_proj"] = [avail_proj(n, r) for n, r in P.iterrows()]
P["value"] = P["fppg"] * P["a_inj"]                    # expected FP per team game
P["season_fp"] = P["value"] * 82
P["pos_set"] = P["pos"].apply(lambda s: set(s.split("/")))
P["value_rank"] = P["value"].rank(ascending=False, method="first").astype(int)
P["adp_rank"] = P["adp"].rank(method="first").astype(int)
REPL = float(P.sort_values("value", ascending=False)["value"].iloc[100])  # ~waiver level
P["vorp"] = (P["value"] - REPL) * 82

# ---------------------------------------------------------------- board
B = pd.read_csv(os.path.join(BASE, "data", "mock_board.psv"), sep="|")
ROSTERS = {int(r.team): [r[f"r{i}"] for i in range(1, 15)] for _, r in B.iterrows()}
missing = [p for ros in ROSTERS.values() for p in ros if p not in P.index]
assert not missing, missing
ME = 10

def pick_order(teams=10, rounds=14):
    order = []
    for rd in range(1, rounds + 1):
        seq = range(1, teams + 1) if rd % 2 else range(teams, 0, -1)
        order += [(rd, t) for t in seq]
    return order
ORDER = pick_order()
OVERALL = {(rd, t): i + 1 for i, (rd, t) in enumerate(ORDER)}

# ---------------------------------------------------------------- simulation
NBA = sorted(set(P["team"]))
NBA_IDX = {t: i for i, t in enumerate(NBA)}

def lineup_cache_factory(names):
    fp = P.loc[names, "fppg"].values
    elig = np.array([[1 if (P.loc[n, "pos_set"] & SLOT_OK[s]) else 0 for s in SLOTS] for n in names])
    cache = {}
    def best(mask):
        if mask in cache: return cache[mask]
        idx = [i for i in range(len(names)) if mask >> i & 1]
        sel = np.zeros(len(names), bool)
        if idx:
            W = elig[idx] * (fp[idx][:, None] + 1000)          # big offset forces eligible fills
            r, c = linear_sum_assignment(-W)
            for ri, ci in zip(r, c):
                if W[ri, ci] > 0: sel[idx[ri]] = True
        cache[mask] = sel
        return sel
    return best

def round_robin(n=10):
    teams = list(range(1, n + 1)); rounds = []
    for _ in range(n - 1):
        rounds.append([(teams[i], teams[n - 1 - i]) for i in range(n // 2)])
        teams = [teams[0]] + [teams[-1]] + teams[1:-1]
    return rounds

def simulate(rosters, scen="a_inj", n_sims=600, seed=rng_seed, track_weeks=False):
    rng = np.random.default_rng(seed)
    teams = sorted(rosters)
    sched = (round_robin(len(teams)) * 2)[:REG_WEEKS]
    days = (REG_WEEKS + PLAYOFF_WEEKS) * 7
    best = {t: lineup_cache_factory(rosters[t]) for t in teams}
    meta = {t: dict(fp=P.loc[rosters[t], "fppg"].values,
                    a=P.loc[rosters[t], scen].values,
                    nba=np.array([NBA_IDX[x] for x in P.loc[rosters[t], "team"]])) for t in teams}
    pw = 1 << np.arange(14)
    res = {t: dict(wins=[], pf=[], seed=[], playoff=0, title=0) for t in teams}
    cum_wins = np.zeros((REG_WEEKS, len(teams)))
    weekly_all = {t: [] for t in teams}
    for s in range(n_sims):
        nba_play = rng.random((days, len(NBA))) < P_TEAM_PLAYS
        week_pts = {}
        for t in teams:
            m = meta[t]
            plays = nba_play[:, m["nba"]] & (rng.random((days, 14)) < m["a"])
            game_fp = np.maximum(0, rng.normal(m["fp"], .30 * m["fp"], (days, 14)))
            masks = plays.astype(np.int64) @ pw
            daily = np.array([game_fp[d][best[t](int(masks[d]))].sum() for d in range(days)])
            week_pts[t] = daily.reshape(-1, 7).sum(1)
            weekly_all[t].append(week_pts[t][:REG_WEEKS].mean())
        wins = {t: 0 for t in teams}; pf = {t: week_pts[t][:REG_WEEKS].sum() for t in teams}
        for w, games in enumerate(sched):
            for a_, b_ in games:
                wa, wb = week_pts[a_][w], week_pts[b_][w]
                wins[a_ if wa > wb else b_] += 1
            if track_weeks:
                cum_wins[w] += np.array([wins[t] for t in teams])
        seeds = sorted(teams, key=lambda t: (-wins[t], -pf[t]))
        for i, t in enumerate(seeds):
            res[t]["wins"].append(wins[t]); res[t]["pf"].append(pf[t]); res[t]["seed"].append(i + 1)
        po = seeds[:PLAYOFF_TEAMS]
        for t in po: res[t]["playoff"] += 1
        wk = REG_WEEKS
        def play(x, y, w): return x if week_pts[x][w] > week_pts[y][w] else y
        r1 = [play(po[2], po[5], wk), play(po[3], po[4], wk)]
        r1.sort(key=lambda t: seeds.index(t))
        semis = [play(po[0], r1[1], wk + 1), play(po[1], r1[0], wk + 1)]
        res[play(semis[0], semis[1], wk + 2)]["title"] += 1
    out = {}
    for t in teams:
        r = res[t]
        out[t] = dict(wins=float(np.mean(r["wins"])), weekly=float(np.mean(weekly_all[t])),
                      playoff=r["playoff"] / n_sims, title=r["title"] / n_sims,
                      seed=float(np.mean(r["seed"])),
                      seed_dist=[float(np.mean(np.array(r["seed"]) == k)) for k in range(1, 11)])
    if track_weeks:
        out["_cum"] = (cum_wins / n_sims).tolist()
    return out

# ---------------------------------------------------------------- pick grades (actual mock)
def available_at(overall, taken_seq):
    taken = set(taken_seq[:overall - 1])
    return P[~P.index.isin(taken)]

taken_seq = [ROSTERS[t][rd - 1] for rd, t in ORDER]
grades = []
for rd in range(1, 15):
    ov = OVERALL[(rd, ME)]
    pool = available_at(ov, taken_seq)
    me = ROSTERS[ME][rd - 1]
    top = pool.sort_values("value", ascending=False).head(3)
    best_v = float(top["value"].iloc[0])
    grades.append(dict(round=rd, overall=ov, player=me, team=P.loc[me, "team"], pos=P.loc[me, "pos"],
                       adp=float(P.loc[me, "adp"]), fppg=round(float(P.loc[me, "fppg"]), 1),
                       avail=round(float(P.loc[me, "a_inj"]), 2), value=round(float(P.loc[me, "value"]), 1),
                       value_rank=int(P.loc[me, "value_rank"]), adp_delta=round(ov - float(P.loc[me, "adp"]), 1),
                       pct_of_best=round(float(P.loc[me, "value"]) / best_v, 3),
                       best_alts=[dict(player=n, value=round(float(r.value), 1), fppg=round(float(r.fppg), 1),
                                       adp=float(r.adp), pos=r.pos) for n, r in top.iterrows() if n != me][:2]))

# ---------------------------------------------------------------- alternative paths
def alt_path(score_col, max_c_only=3):
    taken, my = [], []
    rosters = {t: [] for t in ROSTERS}
    for rd, t in ORDER:
        avail = P[~P.index.isin(taken)]
        if t == ME:
            c_only = sum(1 for n in my if P.loc[n, "pos_set"] == {"C"})
            cand = avail.sort_values(score_col, ascending=False)
            if c_only >= max_c_only:
                cand = cand[cand["pos_set"] != {"C"}]
            pick = cand.index[0]; my.append(pick)
        else:
            pick = ROSTERS[t][rd - 1]
            if pick in taken:                       # CPU falls back to best ADP available
                pick = avail.sort_values("adp").index[0]
        taken.append(pick); rosters[t].append(pick)
    return rosters

P["ceiling"] = P["fppg"] * np.where(P.index.isin(CLEARLY_OUT), P["a_inj"], 1.0)
paths = {"Your mock": ROSTERS,
         "Ceiling path": alt_path("ceiling"),
         "Floor path": alt_path("value")}

# ---------------------------------------------------------------- run sims
N = int(os.environ.get("NSIMS", 600))
results = {}
for label, ros in paths.items():
    results[label] = {"inj": simulate(ros, "a_inj", N, track_weeks=(label == "Your mock")),
                      "proj": simulate(ros, "a_proj", N)}
    print(label, "| wins inj %.1f proj %.1f | playoff %.0f%% | title %.0f%%" % (
        results[label]["inj"][ME]["wins"], results[label]["proj"][ME]["wins"],
        100 * results[label]["inj"][ME]["playoff"], 100 * results[label]["inj"][ME]["title"]))

# ---------------------------------------------------------------- stat profile
def profile(names, scen="a_inj"):
    sub = P.loc[names].sort_values("value", ascending=False).head(10)
    w = sub[scen]
    return {"Points": float((sub.pts * .5 * w).sum()), "3PM": float((sub.tpm * .5 * w).sum()),
            "Rebounds": float((sub.reb * w).sum()), "Assists": float((sub.ast * w).sum()),
            "Steals+Blocks": float(((sub.stl + sub.blk) * 2 * w).sum()),
            "DD/TD": float(((sub.dd + 2 * sub.td) * w).sum()), "Turnovers": float((-sub.to * w).sum())}
profiles = {t: profile(ROSTERS[t]) for t in ROSTERS}
lg_avg = {k: float(np.mean([profiles[t][k] for t in ROSTERS])) for k in profiles[1]}

# ---------------------------------------------------------------- real-draft targets
my_overalls = [OVERALL[(rd, ME)] for rd in range(1, 15)]
windows = [(my_overalls[i], my_overalls[i + 1]) for i in range(0, 14, 2)]
P["steal"] = P["adp_rank"] - P["value_rank"]
targets = []
for a_, b_ in windows:
    win = P[(P.adp >= a_ - 3) & (P.adp <= b_ + 14)].sort_values("value", ascending=False).head(6)
    targets.append(dict(picks=[a_, b_], players=[dict(player=n, team=r.team, pos=r.pos, adp=float(r.adp),
                    fppg=round(float(r.fppg), 1), value=round(float(r.value), 1), avail=round(float(r.a_inj), 2),
                    steal=int(r.steal)) for n, r in win.iterrows()]))
waiver = P[(P.adp > 140)].sort_values("value", ascending=False).head(8)
fades = P[(P.adp < 60)].assign(gap=lambda d: d.value_rank - d.adp_rank).sort_values("gap", ascending=False).head(6)

# ---------------------------------------------------------------- stress test: sharper humans
# Re-draft the whole league. Other 9 managers rank players by a blend of ADP and
# points-league value (w = weight on ADP) plus noise. You draft with one strategy.
def full_draft(my_col, w_adp, seed, my_asc=False):
    rng = np.random.default_rng(seed)
    blend = w_adp * P["adp_rank"] + (1 - w_adp) * P["value_rank"]
    taken, rosters = set(), {t: [] for t in ROSTERS}
    for rd, t in ORDER:
        avail = P[~P.index.isin(taken)]
        c_only = sum(1 for n in rosters[t] if P.loc[n, "pos_set"] == {"C"})
        if c_only >= 3: avail = avail[avail["pos_set"] != {"C"}]
        if t == ME:
            pick = avail.sort_values(my_col, ascending=my_asc).index[0]
        else:
            noisy = blend[avail.index] + rng.normal(0, 4 + 0.08 * len(taken), len(avail))
            pick = noisy.idxmin()
        taken.add(pick); rosters[t].append(pick)
    return rosters

STRATS = {"ADP autopilot": ("adp", True), "Ceiling (FPPG)": ("ceiling", False), "Floor (value)": ("value", False)}
FIELDS = {"CPU / ADP field": 1.0, "Half-sharp field": 0.5, "Sharp points field": 0.0}
stress = {}
n_seeds, n_s = int(os.environ.get("NSEEDS", 4)), int(os.environ.get("NSTRESS", 150))
for fl, w in FIELDS.items():
    stress[fl] = {}
    for sl, (col, asc) in STRATS.items():
        wins, po, ti = [], [], []
        for sd in range(n_seeds):
            r = simulate(full_draft(col, w, 100 + sd, asc), "a_inj", n_s, seed=200 + sd)[ME]
            wins.append(r["wins"]); po.append(r["playoff"]); ti.append(r["title"])
        stress[fl][sl] = dict(wins=float(np.mean(wins)), playoff=float(np.mean(po)), title=float(np.mean(ti)))
        print("stress", fl, "|", sl, "| %.1f wins, %.0f%% playoffs, %.0f%% title" % (
            np.mean(wins), 100 * np.mean(po), 100 * np.mean(ti)))

# ---------------------------------------------------------------- export
def roster_rows(names):
    return [dict(player=n, team=P.loc[n, "team"], pos=P.loc[n, "pos"], fppg=round(float(P.loc[n, "fppg"]), 1),
                 avail=round(float(P.loc[n, "a_inj"]), 2), value=round(float(P.loc[n, "value"]), 1),
                 adp=float(P.loc[n, "adp"])) for n in names]

export = dict(
    league=dict(name="NBA League Revamped", teams=10, format="H2H points · daily lineups",
                scoring=SCORING, slots=SLOTS, bench=5, ir=1, playoff_teams=6, reg_weeks=REG_WEEKS,
                draft="Sun Oct 18 · 7:30 PM CT · slot 10", replacement_value=round(REPL, 1)),
    my_picks=grades,
    standings={lab: {sc: {str(k): v for k, v in r.items()} for sc, r in res.items()} for lab, res in results.items()},
    paths={lab: {str(t): roster_rows(ros[t]) for t in ros} for lab, ros in paths.items()},
    profiles={str(t): v for t, v in profiles.items()}, league_avg_profile=lg_avg,
    targets=targets,
    waiver=[dict(player=n, team=r.team, pos=r.pos, fppg=round(float(r.fppg), 1), adp=float(r.adp),
                 avail=round(float(r.a_inj), 2), value=round(float(r.value), 1)) for n, r in waiver.iterrows()],
    fades=[dict(player=n, team=r.team, adp=float(r.adp), adp_rank=int(r.adp_rank), value_rank=int(r.value_rank),
                fppg=round(float(r.fppg), 1), avail=round(float(r.a_inj), 2)) for n, r in fades.iterrows()],
    top_fppg=[dict(player=n, fppg=round(float(r.fppg), 1), adp=float(r.adp), value=round(float(r.value), 1))
              for n, r in P.sort_values("value", ascending=False).head(40).iterrows()],
    my_overalls=my_overalls,
    stress=stress,
    availability={n: round(float(P.loc[n, "a_inj"]), 2) for n in ROSTERS[ME]},
)
with open(os.path.join(OUT, "results.json"), "w") as f:
    json.dump(export, f, ensure_ascii=False, indent=1)
print("REPL", round(REPL, 2))
