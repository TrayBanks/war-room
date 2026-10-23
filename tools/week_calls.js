#!/usr/bin/env node
// Lock-or-hold calls for a live week, for both sides of the matchup.
//   node tools/week_calls.js payload.json [even|chase|protect|auto]
// payload: { today, week, me: {name, starters, starters_points}, opp: {...}, P: {id: [name, team, pos, inj]},
//            rows: [[player_id, date, team, pts_std, sp]], games: [[date, home, away, status]] }
// Pull the payload from Sleeper's public API (see the sleeper-api skill). The league's own number for the counting
// game (starters_points) overrides pts_std, since the two can differ by stat corrections.
const fs = require("fs"), path = require("path"), vm = require("vm");
const base = path.join(__dirname, "..");
const ctx = {}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(base, "extension/data.js"), "utf8") + ";this.WR_DATA=WR_DATA;", ctx);
const D = ctx.WR_DATA;
global.WR_DEFAULT_Z = D.league.lock.z;
const L = require(path.join(base, "extension/lock.js"));
const byId = Object.fromEntries(D.players.map((p) => [String(p.id), p]));
const pay = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const riskArg = process.argv[3] || "auto";
const Z = D.league.lock.z, POOL = D.league.lock.pool_cv;
const schedule = pay.games.map(([date, home, away, status]) => ({ date, home, away, status }));
const dayName = (iso) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });

function side(team, risk) {
  const roster = team.starters.map((id) => {
    const p = byId[id], live = pay.P[id] || [];
    return { id, n: live[0] || (p && p.n) || id, team: live[1] || (p && p.t), pos: (live[2] || "").split("/"), inj: live[3] || "",
      mu: p ? p.f : 15, cv: p ? p.cv : POOL, rest: p ? p.rest : 0.1, starter: true, known: !!p };
  });
  const official = Object.fromEntries(team.starters.map((id, i) => [id, team.starters_points[i]]));
  const stats = pay.rows.filter((r) => team.starters.includes(String(r[0]))).map(([player_id, date, t, pts, sp]) => ({ player_id: String(player_id), date, team: t, pts_std: pts || 0, sp: sp || 0 }));
  // the league's counted number replaces pts_std on each starter's latest played game
  for (const id of team.starters) {
    const played = stats.filter((s) => s.player_id === id && s.sp > 0).sort((a, b) => a.date.localeCompare(b.date));
    if (played.length && official[id] != null) played[played.length - 1].pts_std = official[id];
  }
  const res = L.analyzeWeek({ roster, schedule, stats, today: pay.today, locks: new Set(team.locked || []), risk, z: Z });
  let now = 0, exp = 0;
  for (const r of res.rows) {
    const pl = roster.find((x) => x.id === r.id);
    const sol = L.solve(pl.mu, pl.cv, r.q, 6, { risk: "even", z: Z });
    const c = r.latest || 0;
    r.exp = r.verdict === "lock" || r.verdict === "final" || r.verdict === "locked" ? c : r.verdict === "none" ? 0 : sol.cont(c, r.k);
    r.mu = pl.mu; r.known = pl.known;
    now += c; exp += r.exp;
  }
  return { res, now, exp };
}

let me = side(pay.me, "even"), op = side(pay.opp, "even");
const diff = me.exp - op.exp;
const risk = riskArg !== "auto" ? riskArg : diff < -15 ? "chase" : diff > 15 ? "protect" : "even";
if (risk !== "even") me = side(pay.me, risk);
const out = {
  week: pay.week, today: pay.today, risk,
  score: { me: +me.now.toFixed(1), opp: +op.now.toFixed(1) },
  projected: { me: +me.exp.toFixed(1), opp: +op.exp.toFixed(1), diff: +diff.toFixed(1) },
  me: me.res.rows.map((r) => ({ n: r.n, verdict: r.verdict, latest: r.latest, k: r.k, next: r.next, line: r.threshold != null ? +r.threshold.toFixed(1) : null,
    hold: r.verdict === "hold" || r.verdict === "lock" ? +L.solve(r.mu, D.players.find((p) => p.n === r.n)?.cv || POOL, r.q, 6, { risk, z: Z }).cont(r.latest || 0, r.k).toFixed(1) : null,
    exp: +r.exp.toFixed(1), q: +r.q.toFixed(2), text: r.text, days: r.timeline.map((g) => `${g.day}${g.played ? " " + g.score : g.dnp ? " DNP" : ""}`).join(" · ") })),
  opp: op.res.rows.map((r) => ({ n: r.n, verdict: r.verdict, latest: r.latest, k: r.k, exp: +r.exp.toFixed(1) })),
};
console.log(JSON.stringify(out, null, 1));
