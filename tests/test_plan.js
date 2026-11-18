// "Start these 9" must never bench a starter the lock call says to lock now (Nov 18, 2026: plan put Sharpe in for Diabaté
// while the lock card said "Lock now: Diabaté").
const assert = require("assert"), L = require("../extension/lock.js"), W = require("../tools/lockweek.js");
const z = Float64Array.from({ length: 400 }, (_, i) => -1.6 + 3.6 * (i / 399));
const P = { d: { id: "d", team: "BKN", pos: ["C"], mu: 18, cv: 0.35, rest: 0.05 }, s: { id: "s", team: "SAS", pos: ["C"], mu: 20, cv: 0.35, rest: 0.05 } };
const schedule = [{ date: "2026-11-18", home: "SAS", away: "LAL", status: "pre_game" }, { date: "2026-11-20", home: "BKN", away: "MIA", status: "pre_game" }, { date: "2026-11-21", home: "SAS", away: "DEN", status: "pre_game" }];
const base = { L, z, risk: "even", slots: ["UTIL"], starters: ["d"], counted: { d: 20.5 }, locks: new Set(), roster: ["d", "s"], player: (id) => P[id], schedule, day: "2026-11-18", today: "2026-11-18" };
const loose = W.planLineup(base);
assert.strictEqual(loose.rows[0].id, "s", "without a lock call the optimizer would swap (the old bug)");
const fixed = W.planLineup({ ...base, toLock: new Set(["d"]) });
assert.strictEqual(fixed.rows[0].id, "d", "a Lock now starter stays in his slot");
assert.ok(fixed.rows[0].toLock && fixed.rows[0].fixed && !fixed.rows[0].change);
console.log("Plan checks passed.");
