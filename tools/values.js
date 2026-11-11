#!/usr/bin/env node
// Rest-of-season values, tiers, team composition, leaderboards, waiver claims and the league moves feed.
//   node tools/values.js data/live/pool_<date>.json data/live/league_<date>.json   -> reports/values_<date>.json
//
// Per-game estimate (est):
//   prior = average of the preseason projection and last season's FP/game (if he played 20+ games), else whichever exists
//   form  = this season's FP/game, nudged toward his last 5 games (60/40) once he has 5
//   est   = (12 * prior + games * form) / (12 + games)        -> after ~12 games this season counts half
// Lock value (lv) = est x his Lock-In bonus (games vary; lock picks a good one), ranks and tiers use lv.
// Hold line: a 10-team league rosters 140 players (9 starters + 5 bench); the 140th best lv is the line.
const fs = require("fs"), path = require("path"), vm = require("vm");
const base = path.join(__dirname, "..");
const ctx = {}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(base, "extension/data.js"), "utf8") + ";this.WR_DATA=WR_DATA;", ctx);
const D = ctx.WR_DATA;
const E = require(path.join(base, "extension/engine.js"));
const PL = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const LG = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const ME = "107261208461459456";
const K = 12, ROSTERED = 140;
const model = Object.fromEntries(D.players.map((p) => [String(p.id), p]));
const lkAvg = D.players.reduce((a, p) => a + (p.lk || 1), 0) / D.players.length;
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
const owners = Object.fromEntries(LG.rosters.map(([rid, uid]) => [rid, LG.users[uid][0]]));
const myRow = LG.rosters.find((r) => r[1] === ME), MYRID = myRow[0], myIR = new Set(myRow[4] || []);

// ---------- per-player estimate ----------
const C = PL.cols, col = (row, k) => row[C.indexOf(k)];
const P = {};
for (const [id, row] of Object.entries(PL.players)) {
  const m = model[id];
  const pre = m ? m.f : col(row, "proj");
  const lastFp = col(row, "lastGp") >= 20 ? col(row, "lastFp") : null;
  const prior = pre != null && lastFp != null ? 0.5 * pre + 0.5 * lastFp : pre != null ? pre : lastFp != null ? lastFp * 0.95 : col(row, "fp") || 8;
  const gp = col(row, "gp") || 0, logs = col(row, "logs") || [];
  const l5 = logs.slice(0, 5), fp5 = avg(l5.map((g) => g[1])), min5 = avg(l5.map((g) => g[2]));
  const fpS = col(row, "fp"), minS = col(row, "min");
  const form = gp ? (l5.length >= 5 ? 0.6 * fpS + 0.4 * fp5 : fpS) : prior;
  const est = (K * prior + gp * form) / (K + gp);
  const pos = (col(row, "pos") || "UTIL").split("/");
  // role vs form: minutes moving is a real change; points moving on steady minutes is mostly noise
  let trend = "";
  if (gp >= 6 && l5.length >= 4 && minS) {
    const dm = min5 - minS, df = fpS ? fp5 / fpS : 1;
    if (dm <= -4 && min5 / minS <= 0.85) trend = "Minutes down";
    else if (dm >= 4 && min5 / minS >= 1.15) trend = "Minutes up";
    else if (df <= 0.8) trend = "Cold, minutes steady";
    else if (df >= 1.2) trend = "Hot";
  }
  P[id] = { id, n: col(row, "name"), t: col(row, "team"), p: pos, inj: col(row, "inj") || "", owner: col(row, "owner") || 0, pre: r1(pre), last: r1(lastFp), lastGp: col(row, "lastGp"),
    gp, fp: r1(fpS), min: r1(minS), fp5: r1(fp5), min5: r1(min5), est: r1(est), lv: +(est * (m ? m.lk || 1 : lkAvg)).toFixed(2), trend, logs: logs.slice(0, 10), known: !!m,
    cv: m ? m.cv : D.league.lock.pool_cv, rest: m ? m.rest : 0.1 };
}
const all = Object.values(P).sort((a, b) => b.lv - a.lv);
all.forEach((p, i) => { p.rank = i + 1; });
const grp = (p) => (["PG", "SG"].includes(p.p[0]) ? "G" : ["SF", "PF"].includes(p.p[0]) ? "F" : p.p[0] === "C" ? "C" : "G");
const inGroup = (p, g) => (g === "G" ? p.p.some((x) => x === "PG" || x === "SG") : g === "F" ? p.p.some((x) => x === "SF" || x === "PF") : p.p.includes("C"));
for (const g of ["G", "F", "C"]) all.filter((p) => grp(p) === g).forEach((p, i) => { p.posRank = i + 1; p.grp = g; });
const byFp = all.filter((p) => p.gp >= 3).sort((a, b) => b.fp - a.fp);
byFp.forEach((p, i) => { p.fpRank = i + 1; });
const holdLine = all[Math.min(ROSTERED, all.length) - 1].lv;
const freeAll = all.filter((p) => !p.owner && p.t && p.inj !== "Out" && p.inj !== "IR");
const replacement = avg(freeAll.slice(0, 3).map((p) => p.lv));
for (const p of all) p.tier = p.rank <= 30 ? "Core" : p.rank <= 90 ? "Starter" : p.lv >= holdLine ? "Hold" : p.lv >= 0.92 * holdLine ? "Fringe" : "Cut";

// ---------- lineup value with these numbers (engine's fit model) ----------
const eng = new E.Engine(D);
const toEng = (p) => ({ id: p.id, n: p.n, t: p.t, p: p.p, lv: p.lv, adp: 300, f: p.est, cv: p.cv, rest: p.rest });
const S = (x) => (x.inj === "Out" ? x.lv * 0.5 : x.lv);
const teamValue = (players) => { const fm = eng.fitModel(players, S); const bench = players.filter((x) => !fm.starters.includes(x)).map(S).sort((a, b) => b - a).slice(0, 5); return { fm, v: fm.best + 0.15 * bench.reduce((a, b) => a + b, 0) }; };
const rosterOf = (rid) => { const r = LG.rosters.find((x) => x[0] === rid); return r[2].filter((id) => P[id]).map((id) => Object.assign(toEng(P[id]), { inj: P[id].inj, ir: (r[4] || []).includes(id) })); };

// ---------- team composition + group strength, all 10 teams ----------
const SLOTS = { G: 3, F: 3, C: 1 };   // PG SG G / SF PF F / C (UTILs go to whoever is left)
const teams = LG.rosters.map(([rid, uid]) => {
  const ps = rosterOf(rid).filter((x) => !x.ir), tv = teamValue(ps);
  const groups = {};
  for (const g of ["G", "F", "C"]) {
    const el = ps.filter((x) => inGroup(P[x.id], g)).sort((a, b) => b.lv - a.lv);
    groups[g] = { n: el.length, holdable: el.filter((x) => P[x.id].lv >= holdLine).length, top: +el.slice(0, SLOTS[g] + 1).reduce((a, x) => a + x.lv, 0).toFixed(1) };
  }
  return { rid, name: owners[rid], me: rid === MYRID, lineup: +tv.fm.best.toFixed(1), value: +tv.v.toFixed(1), groups, record: LG.record[rid] || [0, 0, 0] };
});
for (const g of ["G", "F", "C"]) teams.slice().sort((a, b) => b.groups[g].top - a.groups[g].top).forEach((t, i) => { t.groups[g].rank = i + 1; });
teams.sort((a, b) => b.value - a.value).forEach((t, i) => { t.rank = i + 1; });

// ---------- Tray's roster: keep / hold / shop / cut ----------
const mine = rosterOf(MYRID), active = mine.filter((x) => !x.ir);
const V0 = teamValue(active).v;
const faPool = freeAll.slice(0, 60);
function bestSwap(drop) {
  let best = null;
  for (const fa of faPool) {
    const v = teamValue(active.filter((x) => x !== drop).concat([toEng(fa)])).v - V0;
    if (!best || v > best.gain) best = { gain: +v.toFixed(2), add: fa.id };
  }
  return best;
}
const myPlayers = mine.map((x) => {
  const p = P[x.id], others = active.filter((y) => y.id !== x.id);
  const adds = x.ir ? 0 : +(V0 - teamValue(others).v).toFixed(2);
  const swap = x.ir ? null : bestSwap(x);
  let verdict, why;
  if (x.ir) { verdict = "Hold"; why = "On IR: costs no roster spot."; }
  else if (swap && swap.gain >= 1) { verdict = "Cut"; why = `${P[swap.add].n} would add about +${swap.gain.toFixed(1)} a week in his place.`; }
  else if (p.rank <= 90 && adds < 1.5 && teams.find((t) => t.me).groups[p.grp].holdable >= 4) { verdict = "Shop"; why = `Valued around the league (#${p.rank}) but adds only ${adds.toFixed(1)} a week to your lineup: you're deep at ${p.grp}.`; }
  else if (p.tier === "Core" || p.tier === "Starter") { verdict = "Keep"; why = `Adds about ${adds.toFixed(1)} a week to your lineup.`; }
  else if (p.lv >= holdLine) { verdict = "Hold"; why = "Above the hold line for a 10-team league."; }
  else { verdict = swap && swap.gain > 0 ? "Cut" : "Hold"; why = swap && swap.gain > 0 ? `Below the hold line; ${P[swap.add].n} is a small upgrade.` : "Below the hold line, but no free agent beats him for your lineup."; }
  if (p.trend === "Minutes down" && verdict !== "Cut") why += " Minutes are down lately: watch his role.";
  if (p.trend === "Cold, minutes steady") why += " Cold, but his minutes are steady: likely noise.";
  return { id: x.id, adds, swap, verdict, why, ir: !!x.ir };
});

// ---------- free agents worth a claim, with a FAAB bid ----------
const left = (PL.budget || 100) - (PL.faab[MYRID] || 0);
const bidFor = (gain, p) => { const pct = gain >= 3 ? 0.2 : gain >= 2 ? 0.12 : gain >= 1 ? 0.06 : gain >= 0.5 ? 0.02 : 0; return Math.max(0, Math.round(left * pct * (p.rank <= 100 ? 1.25 : 1))); };
const claims = {};
for (const fa of freeAll.slice(0, 80)) {
  let best = null;
  for (const d of active) { const v = teamValue(active.filter((x) => x !== d).concat([toEng(fa)])).v - V0; if (!best || v > best.gain) best = { gain: +v.toFixed(2), drop: d.id }; }
  claims[fa.id] = { gain: best ? best.gain : 0, drop: best ? best.drop : null, bid: bidFor(best ? best.gain : 0, fa) };
}
// recently dropped players who are free now get the same treatment
for (const t of PL.tx) for (const id of Object.keys(t.drops || {})) {
  const p = P[id];
  if (!p || p.owner || claims[id] || !p.t || p.inj === "Out" || p.inj === "IR") continue;
  let best = null;
  for (const d of active) { const v = teamValue(active.filter((x) => x !== d).concat([toEng(p)])).v - V0; if (!best || v > best.gain) best = { gain: +v.toFixed(2), drop: d.id }; }
  claims[id] = { gain: best.gain, drop: best.drop, bid: bidFor(best.gain, p) };
}

// ---------- league moves feed (last 7 days) ----------
const since = Date.now() - 7 * 864e5;
const moves = PL.tx.filter((t) => t.t >= since).map((t) => ({ t: t.t, type: t.type, team: owners[t.rids[0]] || "", me: t.rids.includes(MYRID), bid: t.bid,
  adds: Object.keys(t.adds || {}), drops: Object.keys(t.drops || {}) }));

const slim = (p) => [p.n, p.t, p.p.join("/"), p.inj, p.owner, p.est, p.lv, p.rank, p.posRank, p.grp, p.tier, p.gp, p.fp, p.fpRank || null, p.fp5, p.min, p.min5, p.trend, p.pre, p.last];
const out = {
  asof: PL.asof, holdLine: +holdLine.toFixed(1), replacement: r1(replacement), faabLeft: left, budget: PL.budget || 100,
  cols: ["n", "t", "pos", "inj", "owner", "est", "lv", "rank", "posRank", "grp", "tier", "gp", "fp", "fpRank", "fp5", "min", "min5", "trend", "pre", "last"],
  players: Object.fromEntries(all.map((p) => [p.id, slim(p)])),
  logs: Object.fromEntries(mine.map((x) => [x.id, P[x.id].logs])),
  teams, mine: myPlayers, claims, moves, owners,
};
const file = path.join(base, "reports", `values_${PL.asof}.json`);
fs.writeFileSync(file, JSON.stringify(out));
console.log(`hold line lv ${out.holdLine}, replacement ${out.replacement}, FAAB left $${left}; ${all.length} players`);
const me = teams.find((t) => t.me);
console.log(`you: rank ${me.rank}/10 by roster value; G #${me.groups.G.rank} (${me.groups.G.n}), F #${me.groups.F.rank} (${me.groups.F.n}), C #${me.groups.C.rank} (${me.groups.C.n})`);
for (const m of myPlayers) { const p = P[m.id]; console.log(`  ${p.n.padEnd(22)} ${p.grp} #${String(p.rank).padStart(3)} ${p.tier.padEnd(7)} est ${String(p.est).padStart(5)} fp ${String(p.fp).padStart(5)} l5 ${String(p.fp5).padStart(5)} ${p.trend.padEnd(20)} ${m.verdict.padEnd(5)} adds ${m.adds}  ${m.why}`); }
const topC = Object.entries(claims).sort((a, b) => b[1].gain - a[1].gain).slice(0, 6);
for (const [id, c] of topC) console.log(`  claim ${P[id].n.padEnd(22)} +${c.gain}/wk  bid $${c.bid}  drop ${P[c.drop] ? P[c.drop].n : "-"}  (${P[id].tier}, #${P[id].rank})`);
