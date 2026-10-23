#!/usr/bin/env node
// Replays a full 10-team draft where you take the panel's top recommendation every time and the other
// managers draft with a given sharpness. Prints your roster, its position mix, and engine timing.
//   node tools/replay_draft.js [sharpness 0..1 = 0.65] [seed = 7] [slot = 10]
const fs = require("fs"), path = require("path"), vm = require("vm");
const base = path.join(__dirname, "..");
const ctx = {}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(base, "extension/data.js"), "utf8") + ";this.WR_DATA=WR_DATA;", ctx);
const D = ctx.WR_DATA;
const E = require(path.join(base, "extension/engine.js"));
const S = +(process.argv[2] || 0.65), seed = +(process.argv[3] || 7), MY = +(process.argv[4] || 10);
const quiet = process.argv.includes("--quiet");
const rand = E.rng(seed);
const eng = new E.Engine(D);
const ME = "me";
const order = {}; for (let s = 1; s <= 10; s++) order[s === MY ? ME : "u" + s] = s;
const draft = { status: "drafting", settings: { teams: 10, rounds: 14, pick_timer: 120 }, draft_order: order, last_picked: Date.now() };
const picks = [], taken = new Set(), times = [];
const byAdp = eng.players.slice().sort((a, b) => a.adp - b.adp), byLv = eng.players.slice().sort((a, b) => b.lv - a.lv);
for (let pk = 1; pk <= 140; pk++) {
  const slot = E.slotForPick(pk, 10, 0);
  let p;
  const t0 = process.hrtime.bigint();
  const st = eng.compute(draft, picks, { userId: ME, mode: "lock" });
  times.push(Number(process.hrtime.bigint() - t0) / 1e6);
  if (slot === MY) p = st.recs[0].p;
  else {
    const av = (arr) => arr.filter((q) => !taken.has(q.id));
    const a = av(byAdp), v = av(byLv), ar = new Map(a.map((q, i) => [q, i])), vr = new Map(v.map((q, i) => [q, i]));
    const cand = a.slice(0, 40).concat(v.slice(0, 40)).filter((q, i, arr) => arr.indexOf(q) === i);
    const sc = cand.map((q) => (1 - S) * ar.get(q) + S * vr.get(q));
    const mn = Math.min(...sc), w = sc.map((x) => Math.exp(-(x - mn) / 2.5));
    let u = rand() * w.reduce((x, y) => x + y, 0); p = cand[cand.length - 1];
    for (let i = 0; i < cand.length; i++) { u -= w[i]; if (u <= 0) { p = cand[i]; break; } }
  }
  taken.add(p.id);
  picks.push({ pick_no: pk, round: Math.ceil(pk / 10), draft_slot: slot, player_id: p.id, picked_by: slot === MY ? ME : "u" + slot, metadata: {} });
}
const st = eng.compute(draft, picks, { userId: ME, mode: "lock" });
const mine = st.myRoster;
const cOnly = mine.filter((p) => p.p.length === 1 && p.p[0] === "C").length, anyC = mine.filter((p) => p.p.includes("C")).length;
if (!quiet) {
  console.log(`Room sharpness ${S}, seed ${seed}, slot ${MY}. Your picks:`);
  mine.forEach((p, i) => console.log(`  ${String(i + 1).padStart(2)}. ${p.n.padEnd(24)} ${p.p.join("/").padEnd(8)} lock ${p.lv.toFixed(1)}`));
  console.log(`Lineup: ${Object.entries(st.lineup).map(([k, p]) => `${k.replace(/\d/, "")} ${p ? p.n.split(" ").slice(-1)[0] : "–"}`).join(" · ")}`);
  console.log(`Bench: ${st.bench.map((p) => p.n.split(" ").slice(-1)[0] + " (" + p.p.join("/") + ")").join(", ")}`);
}
const sorted = times.slice().sort((a, b) => a - b);
console.log(JSON.stringify({ sharp: S, seed, slot: MY, cOnly, anyC, guards: mine.filter((p) => p.p.some((x) => x === "PG" || x === "SG")).length,
  starters9: Object.values(st.lineup).filter(Boolean).reduce((a, p) => a + p.lv, 0).toFixed(1),
  ms: { median: sorted[70].toFixed(1), p90: sorted[126].toFixed(1), max: sorted[139].toFixed(1) } }));
