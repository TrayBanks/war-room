#!/usr/bin/env node
// Season outlook from a live league snapshot: real draft graded, room sharpness from the real draft, team strength
// by lineup fit (Lock-In values), simulated regular season on the real schedule + 6-team playoff, waiver and trade
// angles for Tray. Writes reports/season_<date>.json for the War Room page.
//   node tools/season_report.js data/live/league_<date>.json data/live/extras_<date>.json [weekproj_<date>.json]
// Finished weeks use the real scores (league.results), the current week uses the live projection for Tray's matchup,
// later weeks are simulated. WR_SD sets the weekly swing (default 22); WR_TAG is appended to the output name.
const fs = require("fs"), path = require("path"), vm = require("vm");
const base = path.join(__dirname, "..");
const ctx = {}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(base, "extension/data.js"), "utf8") + ";this.WR_DATA=WR_DATA;", ctx);
const D = ctx.WR_DATA;
const E = require(path.join(base, "extension/engine.js"));
const LG = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const EX = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const WK1 = process.argv[4] ? JSON.parse(fs.readFileSync(process.argv[4], "utf8")) : null;
const ME = "107261208461459456";
const POOL = D.league.lock.pool_cv;
const CUR = LG.curWeek || 1, RESULTS = LG.results || [];

// players: model data + the few the model doesn't know + live injuries
for (const [id, [n, t, pos, inj, fppg]] of Object.entries(EX.extra)) {
  if (!D.players.find((p) => p.id === id)) D.players.push({ id, n, t, p: pos.split("/"), adp: 300, f: fppg, a: 0.85, v: fppg * 0.85, lv: fppg, lvp: fppg, lk: 1, cv: POOL, rest: 0.1, s: [0, 0, 0, 0, 0, 0, 0, 0, 0], inj });
}
const eng = new E.Engine(D);
for (const p of eng.players) { p.inj = EX.inj[p.id] || ""; }
const adj = (p, key) => { const v = p[key] != null ? p[key] : p.lv; return p.inj === "Out" ? v * 0.5 : /GTD|DTD|Questionable/.test(p.inj) ? v * 0.95 : v; };
const S = (p) => adj(p, "lv"), SP = (p) => adj(p, "lvp");
const P = (id) => eng.byId.get(String(id));
const userName = (uid) => (LG.users[uid] || [uid])[0];
const rosters = LG.rosters.map(([rid, owner, players, starters, reserve]) => ({ rid, owner, name: userName(owner), me: owner === ME, players: players.map(P).filter(Boolean), reserve: new Set(reserve) }));
const mine = rosters.find((r) => r.me);

// ---------- real draft: grades + learned sharpness ----------
const slotOwner = Object.fromEntries(Object.entries(LG.draft_order).map(([u, s]) => [s, u]));
const picks = LG.picks.map(([pid, slot], i) => ({ pick_no: i + 1, round: Math.ceil((i + 1) / 10), draft_slot: slot, player_id: pid, picked_by: slotOwner[slot], metadata: {} }));
const st = eng.compute({ status: "complete", settings: { teams: 10, rounds: 14, pick_timer: 120 }, draft_order: LG.draft_order }, picks, { userId: ME, mode: "lock" });
const myDraft = st.myLog.map((e) => { const p = P(e.pid); return { pick: e.pick_no, round: e.round, name: e.name, pos: e.pos.join("/"), team: e.team, lv: +p.lv.toFixed(1), inj: p.inj, adp: p.adp, grade: e.grade, gradeLabel: e.gradeLabel, pct: +Math.min(1, e.pct).toFixed(3), alts: e.alts.map((a) => ({ n: a.n, s: +a.s.toFixed(1) })), kept: mine.players.includes(p) }; });
const room = st.room.map((r) => ({ name: userName(slotOwner[r.slot]), slot: r.slot, s: +r.s.toFixed(2), sd: +r.sd.toFixed(2), label: r.label, captured: r.captured != null ? +r.captured.toFixed(3) : null, reaches: r.reaches, steals: r.steals, me: slotOwner[r.slot] === ME }));
const draftGrade = {};
for (const e of st.log) { const u = userName(slotOwner[e.slot]); (draftGrade[u] = draftGrade[u] || []).push(Math.min(1, e.pct)); }
for (const u in draftGrade) draftGrade[u] = +(draftGrade[u].reduce((a, b) => a + b, 0) / draftGrade[u].length).toFixed(3);

// ---------- team strength by lineup fit ----------
const BENCH_W = 0.15, SD = +(process.env.WR_SD || 22);
const SL = D.league.slots, keyOf = (i) => (SL[i] === "UTIL" ? `UTIL${i}` : SL[i]);
function teamValue(players, score) {
  const fm = eng.fitModel(players, score);
  const bench = players.filter((p) => !fm.starters.includes(p)).map(score).sort((a, b) => b - a).slice(0, 5);
  return { fm, mean: fm.best + BENCH_W * bench.reduce((a, b) => a + b, 0) };
}
function lineupOf(fm) {
  const pc = (x) => { let c = 0; for (; x; x &= x - 1) c++; return c; };
  const st9 = fm.starters.slice().sort((a, b) => pc(eng.slotMask(a)) - pc(eng.slotMask(b)) || S(b) - S(a));
  const order = SL.map((_, i) => i).sort((x, y) => (SL[x] === "UTIL") - (SL[y] === "UTIL"));
  const L = {};
  const place = (k, used) => {
    if (k === st9.length) return true;
    const em = eng.slotMask(st9[k]);
    for (const i of order) if ((em & (1 << i)) && !(used & (1 << i))) { L[keyOf(i)] = st9[k]; if (place(k + 1, used | (1 << i))) return true; delete L[keyOf(i)]; }
    return false;
  };
  place(0, 0);
  return L;
}
for (const r of rosters) {
  const tv = teamValue(r.players, S), pv = teamValue(r.players, SP);
  r.mean = tv.mean; r.pmean = pv.mean; r.fm = tv.fm; r.lineup = lineupOf(tv.fm);
}

// ---------- season simulation on the real schedule ----------
const N = 6000, rng = E.rng(20261022);
const gauss = () => { let u = 0, v = 0; while (u === 0) u = rng(); while (v === 0) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const R = rosters.length, idx = Object.fromEntries(rosters.map((r, i) => [r.rid, i]));
const res = rosters.map(() => ({ wins: 0, playoff: 0, title: 0, final: 0, seed: 0, seedDist: new Array(R).fill(0), pf: 0 }));
const cum = Array.from({ length: 18 }, () => new Array(R).fill(0));
const wkOdds = [];
const myWeekWin = new Array(18).fill(0);
for (let s = 0; s < N; s++) {
  const wins = new Array(R).fill(0), pf = new Array(R).fill(0);
  for (let w = 0; w < 18; w++) {
    const mids = LG.weeks[w], score = rosters.map((r) => r.mean + SD * gauss());
    if (w < CUR - 1 && RESULTS[w]) {   // finished week: the real scores
      rosters.forEach((r, i) => { score[i] = RESULTS[w][r.rid] != null ? RESULTS[w][r.rid] : score[i]; });
    } else if (w === CUR - 1 && WK1) {   // live week: the in-progress projections for the teams we have them for
      for (const [rid, m] of Object.entries(WK1.proj)) score[idx[rid]] = m.mean + m.sd * gauss();
    }
    const byM = {};
    rosters.forEach((r, i) => { (byM[mids[r.rid - 1]] = byM[mids[r.rid - 1]] || []).push(i); });
    for (const pair of Object.values(byM)) {
      if (pair.length !== 2) continue;
      const [a, b] = pair, wa = score[a] > score[b] ? a : b;
      wins[wa]++;
      if (rosters[a].me || rosters[b].me) myWeekWin[w] += rosters[wa].me ? 1 : 0;
    }
    rosters.forEach((_, i) => { pf[i] += score[i]; cum[w][i] += wins[i]; });
  }
  const order = rosters.map((_, i) => i).sort((a, b) => wins[b] - wins[a] || pf[b] - pf[a]);
  order.forEach((i, k) => { res[i].seed += k + 1; res[i].seedDist[k]++; res[i].wins += wins[i]; res[i].pf += pf[i]; });
  const seeds = order.slice(0, 6); seeds.forEach((i) => res[i].playoff++);
  const play = (a, b) => (rosters[a].pmean + SD * gauss() > rosters[b].pmean + SD * gauss() ? a : b);
  const w1 = play(seeds[2], seeds[5]), w2 = play(seeds[3], seeds[4]);
  const rem = [w1, w2].sort((a, b) => seeds.indexOf(b) - seeds.indexOf(a));      // lowest seed first
  const f1 = play(seeds[0], rem[0]), f2 = play(seeds[1], rem[1]);
  res[f1].final++; res[f2].final++;
  res[play(f1, f2)].title++;
}
const teams = rosters.map((r, i) => ({ rid: r.rid, name: r.name, me: r.me, mean: +r.mean.toFixed(1), pmean: +r.pmean.toFixed(1),
  wins: +(res[i].wins / N).toFixed(2), playoff: +(res[i].playoff / N).toFixed(3), final: +(res[i].final / N).toFixed(3), title: +(res[i].title / N).toFixed(3),
  seed: +(res[i].seed / N).toFixed(2), seedDist: res[i].seedDist.map((x) => +(x / N).toFixed(3)), draft: draftGrade[r.name] || null,
  stars: r.fm.starters.slice().sort((a, b) => S(b) - S(a)).slice(0, 3).map((p) => p.n) }));
const cumOut = cum.map((row) => row.map((x) => +(x / N).toFixed(2)));

// ---------- Tray: lineup, bench fit, slots vs league, schedule ----------
const sched = Object.fromEntries(fs.readFileSync(path.join(base, "data/schedule2026.psv"), "utf8").trim().split("\n").slice(1).map((l) => l.split("|")).map(([t, s]) => [t, s.split("").map(Number)]));
const myFm = mine.fm;
const benchInfo = mine.players.filter((p) => !myFm.starters.includes(p)).map((p) => {
  const others = mine.players.filter((q) => q !== p), fm = eng.fitModel(others, S);
  return { name: p.n, pos: p.p.join("/"), lv: +S(p).toFixed(1), adds: +fm.marginal(p).toFixed(1), ir: mine.reserve.has(p.id), inj: p.inj };
}).sort((a, b) => b.adds - a.adds);
const slotAvg = {};
for (const r of rosters) for (const [k, p] of Object.entries(r.lineup)) (slotAvg[k] = slotAvg[k] || []).push(S(p));
const slots = Object.keys(mine.lineup).sort((a, b) => SL.indexOf(a.replace(/\d+$/, "")) - SL.indexOf(b.replace(/\d+$/, "")) || a.localeCompare(b)).map((k) => {
  const p = mine.lineup[k], lg = slotAvg[k].reduce((a, b) => a + b, 0) / slotAvg[k].length;
  return { slot: k.replace(/\d+$/, ""), name: p.n, pos: p.p.join("/"), lv: +S(p).toFixed(1), league: +lg.toFixed(1), diff: +(S(p) - lg).toFixed(1),
    po: (sched[p.t] || [0]).slice(18, 21), reg: +((sched[p.t] || []).slice(0, 18).reduce((a, b) => a + b, 0) / 18).toFixed(2) };
});
const myPlayoffGames = mine.players.map((p) => ({ name: p.n, team: p.t, games: (sched[p.t] || [0, 0, 0]).slice(18, 21) }));

// ---------- waiver radar: best FA swaps for your weakest bench spots ----------
const rosteredIds = new Set(rosters.flatMap((r) => r.players.map((p) => p.id)));
const faPool = new Map();
for (const p of eng.players) if (!rosteredIds.has(p.id)) faPool.set(p.id, p);
for (const [id, n, t, pos, inj, fppg] of EX.fa) if (!faPool.has(id) && !rosteredIds.has(id)) faPool.set(id, { id, n, t, p: pos.split("/"), adp: 999, f: fppg, lv: fppg, lvp: fppg, cv: POOL, inj, s: [] });
for (const [id, , , , inj] of EX.fa) { const p = faPool.get(id); if (p) p.inj = inj; }
const V0 = teamValue(mine.players, S).mean;
const droppable = mine.players.filter((p) => !myFm.starters.includes(p) && !mine.reserve.has(p.id));
const adds = [...faPool.values()].filter((p) => S(p) > 12).map((fa) => {
  let best = null;
  for (const d of droppable) { const g = teamValue(mine.players.filter((q) => q !== d).concat([fa]), S).mean - V0; if (!best || g > best.gain) best = { drop: d.n, gain: g }; }
  return { name: fa.n, team: fa.t, pos: fa.p.join("/"), inj: fa.inj || "", lv: +S(fa).toFixed(1), drop: best.drop, gain: +best.gain.toFixed(2), po: (sched[fa.t] || [0, 0, 0]).slice(18, 21) };
}).filter((a) => a.gain > 0.05).sort((a, b) => b.gain - a.gain).slice(0, 8);

// ---------- trade map: market (ADP) vs Lock-In value ----------
const all = eng.players.slice();
const lockRank = new Map(all.slice().sort((a, b) => S(b) - S(a)).map((p, i) => [p, i + 1]));
const adpRank = new Map(all.slice().sort((a, b) => a.adp - b.adp).map((p, i) => [p, i + 1]));
const sharpOf = Object.fromEntries(room.map((r) => [r.name, r]));
const buy = [];
for (const r of rosters) if (!r.me) for (const p of r.players) {
  const gap = (adpRank.get(p) || 300) - lockRank.get(p);
  if (gap >= 25 && lockRank.get(p) <= 90) buy.push({ name: p.n, pos: p.p.join("/"), owner: r.name, lockRank: lockRank.get(p), adpRank: adpRank.get(p), gap, ownerSharp: sharpOf[r.name] ? sharpOf[r.name].label : "", fitAdd: +myFm.marginal(p).toFixed(1) });
}
buy.sort((a, b) => b.fitAdd - a.fitAdd);
const sell = mine.players.map((p) => ({ name: p.n, pos: p.p.join("/"), lockRank: lockRank.get(p), adpRank: adpRank.get(p), gap: (adpRank.get(p) || 300) - lockRank.get(p) })).filter((x) => x.gap <= -15).sort((a, b) => a.gap - b.gap);

const out = { asof: LG.asof, asofTs: LG.asofTs, week: CUR, record: LG.record, results: RESULTS, teams, cum: cumOut, myWeekWin: myWeekWin.map((x) => +(x / N).toFixed(3)), room, myDraft, slots, bench: benchInfo,
  coverage: (() => { const c = { G: 0, F: 0, C: 0, Conly: 0 }; for (const p of mine.players) { const em = eng.slotMask(p); if (em & eng.gBits) c.G++; if (em & eng.fBits) c.F++; if (em & eng.cBits) c.C++; if (p.p.length === 1 && p.p[0] === "C") c.Conly++; } return c; })(),
  myPlayoffGames, adds, buy: buy.slice(0, 8), sell, settings: LG.settings, wk1: LG.wk1, week1: WK1 };
const file = path.join(base, "reports", `season_${LG.asof}${process.env.WR_TAG || ""}.json`);
fs.writeFileSync(file, JSON.stringify(out));
const me = teams.find((t) => t.me);
console.log(`Wrote ${file}`);
console.log(`You: ${me.wins} wins, playoffs ${(me.playoff * 100).toFixed(0)}%, title ${(me.title * 100).toFixed(1)}%, avg seed ${me.seed}, weekly ${me.mean}, playoff-week ${me.pmean}`);
console.log(teams.slice().sort((a, b) => b.wins - a.wins).map((t) => `${t.name.padEnd(15)} ${t.mean.toFixed(0)} wk  ${t.pmean.toFixed(0)} po  ${t.wins.toFixed(1)} W  ${(t.playoff * 100).toFixed(0)}% PO  ${(t.title * 100).toFixed(0)}% title  draft ${t.draft}`).join("\n"));
console.log("Room:", room.map((r) => `${r.name} ${Math.round(r.s * 100)} ${r.label}`).join(" | "));
console.log("Slots:", slots.map((s) => `${s.slot} ${s.name} ${s.lv} (${s.diff >= 0 ? "+" : ""}${s.diff})`).join(" | "));
console.log("Bench:", benchInfo.map((b) => `${b.name} adds ${b.adds}${b.ir ? " IR" : ""}`).join(" | "));
console.log("Adds:", adds.map((a) => `${a.name} (${a.pos}) +${a.gain} for ${a.drop}`).join(" | "));
console.log("Buy:", buy.slice(0, 8).map((b) => `${b.name} from ${b.owner} (lock #${b.lockRank} vs ADP #${b.adpRank}, adds ${b.fitAdd})`).join(" | "));
console.log("Sell-high:", sell.map((s) => `${s.name} lock #${s.lockRank} ADP #${s.adpRank}`).join(" | "));
console.log("Your draft:", myDraft.map((d) => `${d.pick} ${d.name} ${d.gradeLabel} ${Math.round(d.pct * 100)}%${d.kept ? "" : " (dropped)"}`).join(" | "));
