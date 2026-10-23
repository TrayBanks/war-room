// Replays the completed mock (slot 10) through the engine and checks the math.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");
const base = path.join(__dirname, "..");
const ctx = {}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(base, "extension/data.js"), "utf8") + ";this.WR_DATA=WR_DATA;", ctx);
const DATA = ctx.WR_DATA;
const { Engine, slotForPick, picksForSlot } = require(path.join(base, "extension/engine.js"));

// snake math
assert.deepStrictEqual(picksForSlot(10, 10, 14, 0).slice(0, 6), [10, 11, 30, 31, 50, 51]);
assert.strictEqual(slotForPick(11, 10, 0), 10);
assert.strictEqual(slotForPick(21, 10, 0), 1);
assert.strictEqual(slotForPick(21, 10, 3), 10, "3rd-round reversal");

// rebuild mock picks from the board
const ids = Object.fromEntries(fs.readFileSync(path.join(base, "data", "ids.psv"), "utf8").trim().split("\n").slice(1).map((l) => l.split("|")).map(([id, n]) => [n, id]));
const board = fs.readFileSync(path.join(base, "data", "mock_board.psv"), "utf8").trim().split("\n").slice(1).map((l) => l.split("|"));
const bySlot = Object.fromEntries(board.map((r) => [+r[0], r.slice(1)]));
const ME = "107261208461459456";
const picks = [];
for (let p = 1; p <= 140; p++) {
  const slot = slotForPick(p, 10, 0), rd = Math.ceil(p / 10), name = bySlot[slot][rd - 1];
  picks.push({ pick_no: p, round: rd, draft_slot: slot, player_id: ids[name], picked_by: slot === 10 ? ME : "", metadata: {} });
}
const draft = { status: "drafting", settings: { teams: 10, rounds: 14, pick_timer: 120, reversal_round: 0 }, draft_order: { [ME]: 10 }, last_picked: Date.now() };

const eng = new Engine(DATA);
const full = eng.compute({ ...draft, status: "complete" }, picks, { userId: ME, mode: "floor" });
const fullLock = eng.compute({ ...draft, status: "complete" }, picks, { userId: ME, mode: "lock" });
console.log("My picks (floor grades):");
for (const e of full.myLog) console.log(`  ${e.round}.${e.slot === 10 && e.round % 2 ? 10 : 1} ${e.name.padEnd(20)} ${(e.pct * 100).toFixed(0).padStart(4)}%  ${e.gradeLabel.padEnd(12)} could've had: ${e.alts.map((a) => a.n).join(", ")}`);
const exp = { "Jalen Johnson": "strong", "Donovan Clingan": "strong", "Onyeka Okongwu": "strong", "LeBron James": "reach", "Keyonte George": "reach" };
for (const e of full.myLog) if (exp[e.name]) assert.strictEqual(e.grade, exp[e.name], e.name);

// --- room learning: the mock was drafted by Sleeper CPUs, which follow ADP, so they should read as ADP-driven
console.log("\nRoom sharpness after the full mock (0 = pure ADP, 100 = pure value):");
for (const r of fullLock.room) console.log(`  ${(r.me ? "YOU" : "T" + r.slot).padEnd(4)} ${String(Math.round(r.s * 100)).padStart(3)} ±${String(Math.round(r.sd * 100)).padStart(2)}  ${r.label.padEnd(10)} captured ${Math.round(r.captured * 100)}%  reaches ${r.reaches}  steals ${r.steals}`);
const cpu = fullLock.room.filter((r) => !r.me);
assert.ok(cpu.every((r) => r.s < 0.4), "CPU drafters should be learned as ADP-driven");
assert.ok(fullLock.room.find((r) => r.me).s > Math.max(...cpu.map((r) => r.s)), "you drafted more value-aware than the CPUs");

// --- at pick 41 (9 picks until #50): Monte Carlo odds use each team's learned rating
const s41 = eng.compute(draft, picks.slice(0, 40), { userId: ME, mode: "lock" });
assert.strictEqual(s41.nextMine, 50);
console.log("\nAt pick 41: odds these last to #50 (room learned from 40 picks)");
s41.avail.slice(0, 8).forEach((p) => console.log(`  ${p.n.padEnd(22)} lock ${p.lv.toFixed(1).padStart(5)}  ADP ${String(p.adp).padStart(5)}  ${(p._pNext * 100).toFixed(0)}%`));
assert.ok(s41.avail.find((p) => p.n === "Donovan Clingan")._pNext > 0.8, "ADP-driven room lets Clingan fall");

// --- same seat, but the other 9 managers draft purely by Lock value (a sharp cash room)
const sharpPicks = []; { const takenS = new Set(); const byLv = eng.players.slice().sort((a, b) => b.lv - a.lv);
  for (let p = 1; p <= 40; p++) { const sl = slotForPick(p, 10, 0);
    let pick = sl === 10 ? picks[p - 1].player_id : null;
    if (!pick || takenS.has(String(pick))) pick = byLv.find((x) => !takenS.has(String(x.id))).id;
    takenS.add(String(pick)); sharpPicks.push({ pick_no: p, round: Math.ceil(p / 10), draft_slot: sl, player_id: String(pick), picked_by: sl === 10 ? ME : "", metadata: {} }); } }
const sharp41 = eng.compute(draft, sharpPicks, { userId: ME, mode: "lock" });
const sharpRoom = sharp41.room.filter((r) => !r.me);
console.log("Sharp-room ratings:", sharpRoom.map((r) => Math.round(r.s * 100)).join(" "));
assert.ok(sharpRoom.every((r) => r.s >= 0.6) && sharpRoom.reduce((a, r) => a + r.s, 0) / sharpRoom.length >= 0.8, "value-drafting managers should be learned as sharp");
// best Lock value still on each board whose ADP says "later": does he last to #50?
const sleeperOf = (st) => st.avail.filter((p) => p.adp > st.current + 25).sort((a, b) => b.lv - a.lv)[0];
const xa = sleeperOf(s41), xs = sleeperOf(sharp41);
console.log(`ADP room: ${xa.n} (lock ${xa.lv.toFixed(1)}, ADP ${xa.adp}) lasts to #50: ${(xa._pNext * 100).toFixed(0)}%`);
console.log(`Sharp room: ${xs.n} (lock ${xs.lv.toFixed(1)}, ADP ${xs.adp}) lasts to #50: ${(xs._pNext * 100).toFixed(0)}%`);
assert.ok(xa._pNext > 0.8 && xs._pNext < 0.5, "sharp room snaps up ADP-cheap value; ADP room lets it fall");

// --- on the clock at #31: two-pick lookahead
const s31 = eng.compute(draft, picks.slice(0, 30), { userId: ME, mode: "lock" });
assert.ok(s31.isMyTurn && s31.afterMine === 50);
console.log("\nAt pick 31 (on the clock, next #50):");
s31.recs.forEach((r) => console.log(`  ${r.p.n.padEnd(20)} now ${r.now.toFixed(1)}  ev ${r.ev.toFixed(1)}  lasts ${(r.pAfter * 100).toFixed(0)}%  ${r.why}`));
const s31s = eng.compute(draft, sharpPicks.slice(0, 30), { userId: ME, mode: "lock" });
console.log("Same spot, sharp room:"); s31s.recs.forEach((r) => console.log(`  ${r.p.n.padEnd(20)} now ${r.now.toFixed(1)}  lasts ${(r.pAfter * 100).toFixed(0)}%  ${r.why}`));

// lineup + profile + power
console.log("\nFinal lineup:", Object.entries(full.lineup).map(([k, p]) => `${k}:${p ? p.n.split(" ").slice(-1)[0] : "-"}`).join("  "));
console.log("Bench:", full.bench.map((p) => p.n).join(", "));
console.log("Power:", full.power.map((x) => `${x.slot === 10 ? "YOU" : "T" + x.slot} ${x.total.toFixed(0)}`).join(" | "));
const prof = full.profiles[10];
console.log("Where points come from (you − league avg):", Object.keys(prof).map((k) => `${k} ${(prof[k] - full.lgAvg[k]).toFixed(1)}`).join(", "));
assert.ok(prof.Rebounds > full.lgAvg.Rebounds, "rebound-heavy build");

// ceiling mode changes ordering
const ceil = eng.compute(draft, [], { userId: ME, mode: "ceiling" });
const lockTop = eng.compute(draft, [], { userId: ME, mode: "lock" });
console.log("Lock-In top 8:", lockTop.avail.slice(0, 8).map((p) => p.n).join(", "));
console.log("\nCeiling top 5:", ceil.avail.slice(0, 5).map((p) => p.n).join(", "));

// projections merge
const n = eng.applyProjections([{ player_id: "2728", stats: { pts: 13, reb: 12.5, ast: 2.2, stl: 0.7, blk: 1.9, to: 1.5, tpm: 1, dd: 0.6, td: 0, adp_std: 80 }, player: { injury_status: "Out" } }]);
assert.strictEqual(n, 1);
const c = eng.byId.get("2728"); assert.strictEqual(c.adp, 80); assert.ok(c.out && c.a <= 0.5); assert.ok(c.lv < c.lv0, "Out cuts lock value");
assert.ok(eng.news[0].includes("Clingan"));
console.log("\nAll engine checks passed.");
