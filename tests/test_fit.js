// Roster fit + speed (v1.2). Your first mock with v1.1 piled up center-only bigs and lagged when picks landed.
const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("assert"), { execFileSync } = require("child_process");
const base = path.join(__dirname, "..");
const ctx = {}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(base, "extension/data.js"), "utf8") + ";this.WR_DATA=WR_DATA;", ctx);
const E = require(path.join(base, "extension/engine.js"));
const eng = new E.Engine(ctx.WR_DATA);
const P = (n) => eng.players.find((p) => p.n === n);
const S = (p) => p.lv;
const cOnly = (p) => p.p.length === 1 && p.p[0] === "C";

// empty roster: everyone adds his full value
let fm = eng.fitModel([], S);
for (const p of eng.players.slice(0, 50)) assert.ok(Math.abs(fm.marginal(p) - p.lv) < 1e-9, "empty roster → marginal = lock value");

// three center-only bigs already: a fourth mostly sits, a PF/C still helps, a guard fills an open slot fully
const bigs = ["Donovan Clingan", "Zach Edey", "Walker Kessler"].map(P);
const roster = bigs.concat(["LaMelo Ball", "Scottie Barnes"].map(P));
fm = eng.fitModel(roster, S);
const duren = P("Jalen Duren"), queen = P("Derik Queen"), guard = P("Jalen Brunson") || P("Josh Giddey");
const md = fm.marginal(duren), mq = fm.marginal(queen), mg = fm.marginal(guard);
console.log(`With Clingan, Edey, Kessler, Ball, Barnes → Duren (C) adds ${md.toFixed(1)} of ${duren.lv.toFixed(1)}, Queen (C/PF) ${mq.toFixed(1)} of ${queen.lv.toFixed(1)}, ${guard.n} ${mg.toFixed(1)} of ${guard.lv.toFixed(1)}`);
assert.ok(md < 0.45 * duren.lv, "4th center-only mostly sits");
assert.ok(mq > 2 * md, "PF/C is worth far more than another C-only");
assert.ok(Math.abs(mg - guard.lv) < 0.01, "a guard fills an open slot fully");
assert.ok(fm.starters.length === 5 && fm.bench.length === 0, "all five start (3 bigs use C + 2 UTIL)");

// the engine recommends for the lineup: same board, roster with 3 C-only → no C-only in the top 3
const order = { me: 10 }; for (let s = 1; s < 10; s++) order["u" + s] = s;
const draft = { status: "drafting", settings: { teams: 10, rounds: 14, pick_timer: 120 }, draft_order: order, last_picked: 1 };
const mine = [P("Alperen Şengün"), P("Donovan Clingan"), P("Zach Edey"), P("Walker Kessler")];
const others = eng.players.filter((p) => !mine.includes(p)).sort((a, b) => a.adp - b.adp);
const picks = [];
for (let pk = 1, mi = 0, oi = 0; pk <= 40; pk++) {
  const slot = E.slotForPick(pk, 10, 0), p = slot === 10 ? mine[mi++] : others[oi++];
  picks.push({ pick_no: pk, round: Math.ceil(pk / 10), draft_slot: slot, player_id: p.id, picked_by: slot === 10 ? "me" : "u" + slot, metadata: {} });
}
const st = eng.compute(draft, picks, { userId: "me", mode: "lock" });
console.log("Recs with 3 center-only bigs:", st.recs.map((r) => `${r.p.n} (${r.p.p.join("/")}) ${r.now.toFixed(1)}`).join(" | "));
assert.ok(st.recs.every((r) => !cOnly(r.p)), "no center-only recommendation");
assert.ok(st.alerts.some((a) => a.kind === "cap"), "center-only alert shows");
assert.ok(st.fitAvail[0]._fit >= st.fitAvail[1]._fit, "fitAvail sorted by fit");

// memo: same picks → same object, no work
const t0 = process.hrtime.bigint(); const st2 = eng.compute(draft, picks, { userId: "me", mode: "lock" }); const warm = Number(process.hrtime.bigint() - t0) / 1e6;
assert.strictEqual(st2, st, "unchanged draft returns the cached result"); assert.ok(warm < 1, `warm compute ${warm.toFixed(2)} ms`);

// full drafts following the panel: center-only count and engine time per new pick
const runs = [];
for (const s of ["0.2", "0.65", "0.9"]) for (const seed of ["1", "2"]) {
  const out = execFileSync("node", [path.join(base, "tools/replay_draft.js"), s, seed, "10", "--quiet"], { encoding: "utf8" });
  runs.push(JSON.parse(out.trim().split("\n").pop()));
}
for (const r of runs) console.log(`  room ${r.sharp} seed ${r.seed}: center-only ${r.cOnly}, any C ${r.anyC}, guards ${r.guards}, best 9 ${r.starters9} | engine median ${r.ms.median} ms, p90 ${r.ms.p90} ms`);
assert.ok(runs.every((r) => r.cOnly <= 2), "never more than 2 center-only players");
assert.ok(runs.every((r) => +r.ms.p90 < 60), "engine p90 under 60 ms per new pick (Node)");
console.log("All fit and speed checks passed.");
