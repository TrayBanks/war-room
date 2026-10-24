#!/usr/bin/env node
// The "This week" card, computed: lock calls for both lineups, Tray's next moves (lock now, bench swaps, conditional
// swaps, injury checks), projected totals and the live-week projection the season sim uses.
//   node tools/week_page.js data/live/week_<date>.json   -> data/live/week_page_<date>.json, data/live/weekproj_<date>.json
// Locks: Sleeper's API doesn't expose them, so they come from (1) data/locks.json {"<week>": [player ids]} for locks
// Tray told us about, and (2) inference: once a starter has played again, Sleeper's counted points (starters_points)
// matching an earlier game instead of his latest one means that earlier game is locked. The page also lets him mark
// a lock on his phone.
const fs = require("fs"), path = require("path"), vm = require("vm");
const base = path.join(__dirname, "..");
const ctx = {}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(base, "extension/data.js"), "utf8") + ";this.WR_DATA=WR_DATA;", ctx);
const D = ctx.WR_DATA;
global.WR_DEFAULT_Z = D.league.lock.z;
const L = require(path.join(base, "extension/lock.js"));
const Z = D.league.lock.z, POOL = D.league.lock.pool_cv;
const byId = Object.fromEntries(D.players.map((p) => [String(p.id), p]));

const file = process.argv[2];
const W = JSON.parse(fs.readFileSync(file, "utf8"));
const locksFile = path.join(base, "data", "locks.json");
const told = (fs.existsSync(locksFile) ? JSON.parse(fs.readFileSync(locksFile, "utf8")) : {})[String(W.week)] || {};
const manual = new Map(Array.isArray(told) ? told.map((id) => [String(id), ""]) : Object.entries(told).map(([id, d]) => [String(id), d || ""]));
const today = W.today;
const DAY = (iso) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
const DAYL = (iso) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
const schedule = W.games.map(([date, home, away, status]) => ({ date, home, away, status }));
const gamesOf = (team) => schedule.filter((g) => g.home === team || g.away === team).sort((a, b) => a.date.localeCompare(b.date));
const vsText = (team, g) => `${DAY(g.date)} ${g.home === team ? "vs" : "at"} ${g.home === team ? g.away : g.home}`;
const f1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
const SLOT_OK = { PG: ["PG"], SG: ["SG"], G: ["PG", "SG"], SF: ["SF"], PF: ["PF"], F: ["SF", "PF"], C: ["C"], UTIL: null };
const fits = (slot, pos) => !SLOT_OK[slot] || pos.some((p) => SLOT_OK[slot].includes(p));

function player(id) {
  const p = byId[id], live = W.P[id] || [];
  const mu = p ? p.f : live[4] || 12;
  return { id, n: live[0] || (p && p.n) || id, team: live[1] || (p && p.t), pos: (live[2] || (p ? p.p.join("/") : "")).split("/").filter(Boolean),
    inj: live[3] || "", mu, cv: p ? p.cv : POOL, rest: p ? p.rest : 0.1, known: !!p };
}
const statsOf = (ids) => W.rows.filter((r) => ids.includes(r[0])).map(([player_id, date, team, pts, sp]) => ({ player_id, date, team, pts_std: pts || 0, sp: sp || 0 }));
const WKL = require(path.join(base, "tools", "lockweek.js"));
const side = (team, risk, manualLocks) => WKL.analyzeSide({ L, starters: team.starters, points: team.starters_points, slots: W.slots, player, schedule,
  stats: statsOf(team.starters), today, manual: manualLocks || new Map(), risk, z: Z });

let me = side(W.me, "even", manual), op = W.opp ? side(W.opp, "even") : null;
const diff = op ? me.exp - op.exp : 0;
const risk = WKL.riskOf(diff);
if (risk !== "even") me = side(W.me, risk, manual);

// ---------- rows ----------
const STATUS = { locked: "Locked", lock: "Lock now", hold: "Hold", wait: "Wait", final: "Final", none: "No games", live: "Live", pending: "Pending" };
const rows = me.res.rows.map((r) => {
  const pl = r.pl, fut = gamesOf(pl.team).filter((g) => g.date >= today && g.status === "pre_game");
  let why = r.text;
  if (r.verdict === "hold") why = `Line ${f1(r.threshold)}. ${fut.map((g) => vsText(pl.team, g)).join(", ")}.`;
  if (r.verdict === "lock") why = `Beats his ${f1(r.threshold)} line. ${fut.length} game${fut.length > 1 ? "s" : ""} left, worth about ${f1(L.solve(pl.mu, pl.cv, r.q, 6, { risk, z: Z }).cont(r.latest, r.k))} if you wait.`;
  if (r.verdict === "locked") why = r.inferred ? `Locked at ${f1(r.latest || 0)} (Sleeper's count shows it).` : `Locked at ${f1(r.latest || 0)}.`;
  if (r.broken) why = `Your lock didn't go through: Sleeper counts his latest game (${f1(r.latest || 0)}). ${why}`;
  if (pl.inj && r.verdict !== "locked") why = `Listed ${pl.inj}. ${why}`;
  return { id: r.id, n: r.n, slot: r.slot, score: r.latest, status: STATUS[r.verdict] || r.verdict, why, exp: +r.exp.toFixed(1),
    canMark: ["hold", "lock"].includes(r.verdict) && r.latest != null, src: r.verdict === "locked" ? (r.inferred ? "auto" : "told") : "", broken: !!r.broken };
});

// ---------- moves ----------
const moves = [];
for (const r of []) {   // lock calls live in the Lock or wait card (checked live on the page)
  const g = gamesOf(r.pl.team).find((x) => x.date >= today && x.status === "pre_game");
  moves.push({ rank: 0, when: g ? `Before ${DAYL(g.date)}` : "Now", what: `Lock ${r.n} at ${f1(r.latest)}`, why: `It beats his ${f1(r.threshold)} lock line. Waiting is worth less.` });
}
const bench = W.me.bench.map((id) => player(id)).map((b) => {
  const q0 = Math.max(0, Math.min(1, 1 - (b.rest || 0.07))), q = b.inj === "Out" ? 0 : /^(Questionable|DTD|GTD|Doubtful)$/i.test(b.inj) ? q0 * 0.6 : q0;
  return { ...b, q, sol: L.solve(b.mu, b.cv, q, 6, { risk, z: Z }), fut: gamesOf(b.team).filter((g) => g.date >= today && g.status === "pre_game") };
}).filter((b) => b.fut.length && b.q > 0);
const cands = [];
for (const r of me.res.rows) {
  if (["locked", "live", "pending", "lock"].includes(r.verdict)) continue;
  const sFut = gamesOf(r.pl.team).filter((g) => g.date >= today && g.status === "pre_game");
  for (const b of bench) {
    if (!fits(r.slot, b.pos)) continue;
    if (["final", "none"].includes(r.verdict) || (r.verdict === "hold" && r.k >= 1 && b.fut.length > r.k) || r.verdict === "wait") {
      const vb = b.sol.cont(0, b.fut.length), gain = vb - r.exp;
      if (gain >= 2) cands.push({ rank: 1, s: r.id, b: b.id, gain, when: `Before ${DAYL(b.fut[0].date)}`, what: `Start ${b.n} at ${r.slot} for ${r.n}`,
        why: `${r.n} ${r.verdict === "final" ? `is done at ${f1(r.latest)}` : r.verdict === "none" ? "has no games left" : `projects about ${f1(r.exp)}`}. ${b.n} plays ${b.fut.map((g) => DAY(g.date)).join(", ")} and is worth about ${f1(vb)}.` });
    }
    if (sFut.length === 1 && ["hold", "wait"].includes(r.verdict)) {
      const after = b.fut.filter((g) => g.date > sFut[0].date);
      if (!after.length) continue;
      const vb = b.sol.cont(0, after.length);
      if (vb >= 0.6 * r.pl.mu) cands.push({ rank: 2, s: r.id, b: b.id, gain: vb - 0.6 * r.pl.mu, when: `${DAYL(sFut[0].date)} night`, what: `${r.n.split(" ").pop()} under ${Math.round(vb)}: start ${b.n} at ${r.slot}`,
        why: `${r.n} has no game after ${DAYL(sFut[0].date)}. ${b.n} plays ${after.map((g) => `${DAY(g.date)}`).join(", ")} and is worth about ${f1(vb)}.` });
    }
  }
}
cands.sort((a, b) => a.rank - b.rank || b.gain - a.gain);
const usedS = new Set(), usedB = new Set();
for (const c of cands) { if (usedS.has(c.s) || usedB.has(c.b)) continue; usedS.add(c.s); usedB.add(c.b); moves.push(c); }
for (const r of me.res.rows) {
  if (!/^(Questionable|GTD|DTD|Doubtful)$/i.test(r.pl.inj) || !["hold", "wait"].includes(r.verdict) || usedS.has(r.id)) continue;
  const alt = bench.find((b) => fits(r.slot, b.pos));
  moves.push({ rank: 3, when: "Before tip", what: `Check ${r.n}'s status`, why: `Listed ${r.pl.inj}.${alt ? ` If he sits, ${alt.n} can take ${r.slot}.` : ""}` });
}
const swaps = moves.slice(0, 4).map(({ when, what, why }) => ({ when, what, why }));
if (!swaps.length) swaps.push({ when: "This week", what: "No moves: hold everyone", why: "No starter is above his lock line, and no bench player beats a starter for his slot." });

// ---------- header ----------
const myTeams = new Set([...W.me.starters, ...W.me.bench].map((id) => player(id).team));
const left = [...new Set(schedule.filter((g) => g.status === "pre_game" && g.date >= today && (myTeams.has(g.home) || myTeams.has(g.away))).map((g) => g.date))].sort();
const RISK = { chase: "You're behind, so the lock lines chase upside: hold for bigger games.", protect: "You're ahead, so the lock lines protect the lead: lock good games sooner.", even: "It's close, so the lock lines are neutral." };
const out = {
  week: W.week, today, opp: W.opp ? W.opp.name : "", me: +W.me.points.toFixed(1), oppPts: W.opp ? +W.opp.points.toFixed(1) : 0,
  projMe: Math.round(me.exp), projOpp: op ? Math.round(op.exp) : 0, risk,
  daysLeft: left.length ? `${left.map(DAY).join(" · ")} left` : "Week is done",
  oddsNote: `to win this week. ${RISK[risk]}`,
  rows, swaps,
  opp_rows: op ? op.res.rows.map((r) => ({ n: r.n, status: STATUS[r.verdict] || r.verdict, score: r.latest, exp: +r.exp.toFixed(1) })) : [],
};
// everything the page needs to redo these calls live from Sleeper between refreshes
const zArr = Array.from(Z);
const ids = [...new Set([...W.me.starters, ...W.me.bench, ...(W.opp ? [...W.opp.starters, ...(W.opp.bench || [])] : []), ...Object.keys(W.P)])];
out.live = { league: W.league || "1398532731020828672", season: W.season || "2026", week: W.week, rid: W.me.rid, oppRid: W.opp ? W.opp.rid : null,
  oppName: W.opp ? W.opp.name : "", slots: W.slots, risk, z: zArr.map((x) => +x.toFixed(4)), pool: POOL, manual: Object.fromEntries(manual),
  players: Object.fromEntries(ids.map((id) => { const p = player(id); return [id, [p.n, p.team || "", p.pos.join("/"), p.inj, +p.mu.toFixed(2), +p.cv.toFixed(3), +(p.rest || 0.1).toFixed(3)]]; })) };
const sdOf = (s) => Math.max(3, +(22 * Math.sqrt(s.remFrac)).toFixed(1));
const proj = { [W.me.rid]: { mean: +me.exp.toFixed(1), sd: sdOf(me) } };
if (op) proj[W.opp.rid] = { mean: +op.exp.toFixed(1), sd: sdOf(op) };
const dir = path.dirname(file), tag = path.basename(file).replace(/^week_/, "");
fs.writeFileSync(path.join(dir, `week_page_${tag}`), JSON.stringify(out));
fs.writeFileSync(path.join(dir, `weekproj_${tag}`), JSON.stringify({ week: W.week, proj }));
console.error(`week ${W.week}: you ${out.me} (proj ${out.projMe}) vs ${out.opp} ${out.oppPts} (proj ${out.projOpp}), risk ${risk}`);
for (const r of rows) console.error(`  ${r.n.padEnd(20)} ${String(r.score ?? "-").padStart(5)} ${r.status.padEnd(9)} ${r.why}`);
for (const s of swaps) console.error(`  > ${s.when}: ${s.what} — ${s.why}`);
