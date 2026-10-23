"""Build the dashboard HTML + a static summary PNG from out/results.json."""
import json, os
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # repo root
D = json.load(open(os.path.join(BASE, "reports", "results.json")))
ME = "10"
S = D["standings"]
mock_i, mock_p = S["Your mock"]["inj"][ME], S["Your mock"]["proj"][ME]
flo_i, flo_p = S["Floor path"]["inj"][ME], S["Floor path"]["proj"][ME]
cei_i, cei_p = S["Ceiling path"]["inj"][ME], S["Ceiling path"]["proj"][ME]
st = D["stress"]
prof, avg = D["profiles"][ME], D["league_avg_profile"]
d_reb, d_ast = prof["Rebounds"] - avg["Rebounds"], prof["Assists"] - avg["Assists"]
d_stk, d_pts = prof["Steals+Blocks"] - avg["Steals+Blocks"], prof["Points"] - avg["Points"]
pct = lambda x: f"{round(x * 100)}%"
w = lambda x: f"{x:.1f}"

clingan_rounds = [g["round"] for g in D["my_picks"] if any(a["player"] == "Donovan Clingan" for a in g["best_alts"])]

notes = dict(
    thesis=(f"Against this CPU mock field your team projects <b>{mock_i['wins']:.0f}–{18 - mock_i['wins']:.0f} and first place</b>. "
            "It worked because you stacked rebounds and assists, which this scoring pays double. "
            "The risk tomorrow is the room: real managers will take Clingan, Okongwu and the other points-league bigs earlier than the bots did."),
    mix=(f"A rebound or assist is worth 1 point and a steal or block 2, while a point scored is worth 0.5. "
         f"Your top 10 beat the league average by {d_reb:.1f} rebound points and {d_ast:.1f} assist points per team game, "
         f"and give back {abs(d_pts):.1f} in scoring. That is the right trade in this format."),
    stress=(f"Against CPU drafters, any value-aware plan wins ({w(st['CPU / ADP field']['Floor (value)']['wins'])} wins on the floor plan). "
            f"Against a half-sharp room the floor plan still makes the playoffs {pct(st['Half-sharp field']['Floor (value)']['playoff'])} of the time, "
            f"while drafting straight off ADP collapses. If everyone uses the same value model, slot 10 is about average "
            f"({w(st['Sharp points field']['Floor (value)']['wins'])} wins). Each cell is 4 drafts × 150 seasons, so read differences under 1.5 wins as noise."),
    plan=[
        "Pair Jalen Johnson with the best big left: Şengün or Towns. Flagg is close enough if you want him. If Giannis falls, he is the ceiling swing at 72% availability.",
        "LaMelo, Banchero, Murray or Bam. If the room is already taking bigs, take Clingan here: he is a top-12 value with a 93 ADP.",
        "Last safe window for Clingan. Otherwise Duren or Randle. Kessler only as an upside swing after last year's 5 games.",
        "Okongwu, Gobert, Knueppel or Pritchard. Two bigs here is fine because rebounds pay double.",
        "Buzelis is the best forward value. Treat Edey as upside, not a starter you can count on.",
        "Derik Queen projects 21 FPPG and plays 93% of games. Kyrie is the upside pick.",
        "Ryan Rollins and Podziemski. Lillard is often still here; take him if so.",
    ],
    assumptions=[
        ["This league is points, not 9-cat",
         "FG% and FT% do not count, turnovers cost 1, and punting a category is not a strategy here. Rankings built for category leagues will steer you wrong on players like Giddey, Clingan and Ja Morant."],
        ["Your leaguemates draft like the CPU",
         f"The mock bots follow Sleeper ADP. Clingan was available at every one of your picks from round {min(clingan_rounds)} to {max(clingan_rounds)}. "
         f"Humans will not be that kind. Against a half-sharp room the floor plan drops from {w(st['CPU / ADP field']['Floor (value)']['wins'])} to {w(st['Half-sharp field']['Floor (value)']['wins'])} wins."],
        ["My availability guesses",
         f"Kyrie 72%, Lillard 68%, LeBron 72%, Edey 62% are estimates, not facts. Flip the toggle at the top: if everyone stays healthy, the ceiling path beats the floor path ({w(cei_p['wins'])} vs {w(flo_p['wins'])} wins). The stress test uses the injury-adjusted model, which favors the floor plan by design."],
        ["Sleeper's projections are right",
         "Every number starts from Sleeper's per-game projections. The shakiest are rookies (Boozer, Peterson, Dybantsa), Ware sharing center with Myles Turner in Milwaukee, and Edey coming back on a minutes limit."],
        ["You set lineups most days",
         "The sim fills your 9 starting slots every day from whoever plays. That is how a deep 14-man roster turns into points. If you set lineups once a week, depth matters less and stars matter more."],
        ["No trades or pickups",
         f"Real seasons have waivers. Replacement level here is about {D['league']['replacement_value']} value per game, so the wire will hold usable bigs and guards all year."],
    ],
    steps=[
        "Pull the league's scoring from Sleeper and convert every projection to fantasy points per game with it (0.5 per point, 1 per rebound or assist, 2 per steal or block, −1 per turnover, bonuses for double-doubles).",
        "Multiply by expected availability to get value per team game. That is the number that wins weekly matchups.",
        f"Set a replacement level: the 100th-best value, about {D['league']['replacement_value']} here. Spend picks on players far above it.",
        "Compare value rank to ADP rank. Big positive gaps are targets, big negative gaps are fades.",
        "At each pick take the best value unless it leaves a lineup slot you cannot fill. Cap center-only players at three.",
        "Simulate before trusting it: daily lineups, head-to-head weeks, hundreds of seasons. Then re-run against smarter opponents.",
    ],
    footer=("<span><b>Data:</b> Sleeper API: league settings, mock draft board, 2026-27 projections and ADP, 2025-26 stats (pulled Oct 17, 2026). "
            "600 simulated seasons per scenario; per-game scoring noise of 30%; NBA teams play on about 48% of days.</span>"
            "<span><b>News checked:</b></span><ul>"
            '<li><a href="https://bleacherreport.com/articles/25502968-kyrie-irving-gives-injury-update-latest-mavericks-stars-status-2026-27-nba-season">Kyrie Irving status (Bleacher Report)</a></li>'
            '<li><a href="https://bleacherreport.com/articles/25503026-damian-lillard-hyped-blazers-return-achilles-injury-he-looks-phenomenal">Damian Lillard return (Bleacher Report)</a></li>'
            '<li><a href="https://roundtable.io/sports/nba/grizzlies/news/zach-edey-cleared-to-make-grizzlies-preseason-debut-against-magic">Zach Edey cleared, minutes managed (Roundtable)</a></li>'
            '<li><a href="https://roundtable.io/sports/nba/bucks/news/who-should-bucks-look-to-trade-myles-turner-or-kelel-ware">Ware and Turner in Milwaukee (Roundtable)</a></li>'
            '<li><a href="https://www.fox5vegas.com/2026/07/24/report-lebron-james-will-sign-with-76ers-two-year-deal/">LeBron to the 76ers (Fox 5)</a></li>'
            '<li><a href="https://www.nba.com/news/lamelo-ball-trade-timberwolves-2026">LaMelo Ball to Minnesota (NBA.com)</a></li>'
            '<li><a href="https://www.ksl.com/article/sports/nba/giannis-antetokounmpo-getting-traded-to-heat-in-blockbuster-deal-ap-source-says/51523583">Giannis to Miami (AP via KSL)</a></li></ul>'),
)
D["notes"] = notes
D["path_notes"] = {
    "Your mock": dict(what="What you drafted: two young forwards, then playmakers, then a late run of bigs.",
                      pros=["Best rebound-and-assist mix in the league",
                            "Late picks Clingan, Okongwu, Kyrie and Lillard were strong value"],
                      cons=["LeBron, Keyonte George and Edey carry the most missed-game risk",
                            "Depended on the bots letting Clingan reach pick 90"]),
    "Floor path": dict(what="Take the best value per team game at every pick: FPPG × expected availability.",
                       pros=[f"Best record in the injury-adjusted model: {w(flo_i['wins'])} wins, {pct(flo_i['title'])} titles",
                             "Every core player projects to play 85%+ of games"],
                       cons=[f"Fewer star nights; drops to {w(flo_p['wins'])} wins if everyone stays healthy",
                             "Spends pick 30 on Clingan, maybe earlier than needed"]),
    "Ceiling path": dict(what="Take the highest FPPG at every pick and ignore injury risk.",
                         pros=[f"Best record if everyone stays healthy: {w(cei_p['wins'])} wins",
                               "Most weekly upside: Davis, Kessler, Edey all in"],
                         cons=[f"Worst in the injury-adjusted model: {w(cei_i['wins'])} wins",
                               "Stacks the most fragile players on one roster"]),
}

html = open(os.path.join(BASE, "model", "template.html")).read().replace("/*__DATA__*/null", json.dumps(D, ensure_ascii=False))
open(os.path.join(BASE, "reports", "slot10_war_room.html"), "w").write(html)

# ---------------------------------------------------------------- static summary PNG
plt.rcParams.update({"font.family": "DejaVu Sans", "axes.spines.top": False, "axes.spines.right": False})
INK, MUTED, YOU, NEUT, GRID = "#221D17", "#7E7669", "#A9761F", "#B9B2A4", "#D3CDBF"
fig, (a1, a2) = plt.subplots(1, 2, figsize=(13, 6.2), gridspec_kw=dict(width_ratios=[1, 1.15]))
fig.patch.set_facecolor("#F7F6F1")
s = S["Your mock"]["inj"]
firsts = {t: D["paths"]["Your mock"][t][0]["player"].split()[-1] for t in D["paths"]["Your mock"]}
rows = sorted([t for t in s if not t.startswith("_")], key=lambda t: s[t]["wins"])
labels = [("You · " if t == ME else f"T{t} · ") + firsts[t] for t in rows]
vals = [s[t]["wins"] for t in rows]
a1.barh(labels, vals, color=[YOU if t == ME else NEUT for t in rows], height=.62)
for i, v in enumerate(vals):
    a1.text(v + .2, i, f"{v:.1f}", va="center", fontsize=10, color=INK)
a1.set_xlim(0, 18); a1.set_xlabel("Expected wins (18-week regular season)", color=MUTED)
a1.set_title("Your mock projects 1st vs the CPU field", loc="left", fontsize=14, fontweight="bold", color=INK)
a1.tick_params(colors=INK); a1.set_facecolor("#F7F6F1"); a1.grid(axis="x", color=GRID, lw=.6); a1.set_axisbelow(True)

g = D["my_picks"]
names = [f"{p['round']}.{10 if p['round'] % 2 else 1}  {p['player']}" for p in g][::-1]
pcts = [p["pct_of_best"] * 100 for p in g][::-1]
cols = ["#2F7A3A" if x >= 95 else "#554D43" if x >= 85 else "#9A6A00" if x >= 75 else "#B23A2A" for x in pcts]
a2.barh(names, pcts, color=cols, height=.62)
for i, v in enumerate(pcts):
    a2.text(v + 1, i, f"{v:.0f}%", va="center", fontsize=9.5, color=INK)
a2.axvline(100, color=MUTED, lw=.8, ls=":")
a2.set_xlim(0, 112); a2.set_xlabel("Value captured vs best player available at that pick", color=MUTED)
a2.set_title("Pick grades: rounds 5–8 and 12–13 left value on the board", loc="left", fontsize=14, fontweight="bold", color=INK)
a2.tick_params(colors=INK, labelsize=9.5); a2.set_facecolor("#F7F6F1"); a2.grid(axis="x", color=GRID, lw=.6); a2.set_axisbelow(True)
plt.tight_layout()
plt.savefig(os.path.join(BASE, "reports", "summary.png"), dpi=150, bbox_inches="tight", facecolor=fig.get_facecolor())
print("built", len(html) // 1024, "KB")
