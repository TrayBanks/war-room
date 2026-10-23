// Lock-In analyzer checks, replayed on a real week (Nov 17-23, 2025) for players on your mock roster.
const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("assert");
const base = path.join(__dirname, "..");
const ctx = {}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(base, "extension/data.js"), "utf8") + ";this.WR_DATA=WR_DATA;", ctx);
const D = ctx.WR_DATA;
global.WR_DEFAULT_Z = D.league.lock.z;
const L = require(path.join(base, "extension/lock.js"));
const psv = (f) => { const [h, ...rows] = fs.readFileSync(path.join(__dirname, "fixtures", f), "utf8").trim().split("\n"); const k = h.split("|"); return rows.map((r) => Object.fromEntries(r.split("|").map((v, i) => [k[i], v]))); };
const stats = psv("week5_stats.psv").map((r) => ({ ...r, pts_std: +r.pts_std, sp: +r.sp }));
const sched0 = psv("week5_sched.psv");
const teamOf = {}; stats.forEach((r) => { teamOf[r.player_id] = r.team; });
const byId = Object.fromEntries(D.players.map((p) => [p.id, p]));
const roster = Object.keys(teamOf).map((id) => { const p = byId[id]; return { id, n: p.n, pos: p.p, team: teamOf[id], mu: p.f, cv: p.cv, rest: p.rest, inj: "", starter: true }; });

function weekAt(today, risk, locks) {
  const schedule = sched0.map((g) => ({ ...g, status: g.date < today ? "complete" : "pre_game" }));
  const st = stats.filter((r) => r.date < today);
  return L.analyzeWeek({ roster, schedule, stats: st, today, locks: new Set(locks || []), risk: risk || "even", z: D.league.lock.z });
}
const row = (w, name) => w.rows.find((r) => r.n === name);
const show = (w, title) => { console.log(`\n${title}`); for (const r of w.rows) console.log(`  ${r.n.padEnd(20)} ${r.verdict.toUpperCase().padEnd(6)} last ${r.latest == null ? "  –  " : r.latest.toFixed(1).padStart(5)}  left ${r.k}  line ${r.threshold == null ? "  – " : r.threshold.toFixed(1).padStart(5)}  ${r.text}`); };

// thresholds rise with games left, and with appetite for risk
const jok = byId["1658"];
const ev = L.solve(jok.f, jok.cv, 1 - jok.rest, 4, { z: D.league.lock.z });
const ch = L.solve(jok.f, jok.cv, 1 - jok.rest, 4, { z: D.league.lock.z, risk: "chase" });
const pr = L.solve(jok.f, jok.cv, 1 - jok.rest, 4, { z: D.league.lock.z, risk: "protect" });
console.log("Jokić lock lines by games left (1..4):", ev.T.slice(1).map((x) => x.toFixed(1)).join(" / "), "| chasing:", ch.T.slice(1).map((x) => x.toFixed(1)).join(" / "), "| protecting:", pr.T.slice(1).map((x) => x.toFixed(1)).join(" / "));
for (let k = 2; k <= 4; k++) assert.ok(ev.T[k] > ev.T[k - 1], "more games left -> higher bar");
assert.ok(ch.T[3] > ev.T[3] && ev.T[3] > pr.T[3], "chasing raises the bar, protecting lowers it");
assert.ok(Math.abs(L.solve(30, 0.3, 1, 1, { z: D.league.lock.z }).T[1] - 30) < 0.8, "1 game left: lock line ≈ his average");
assert.strictEqual(L.solve(30, 0.3, 0, 3, { z: D.league.lock.z }).T[3], 0, "player out for the week: lock anything");

// Tuesday morning: Monday's games are in
let w = weekAt("2025-11-18");
show(w, "Tue Nov 18, before tip-off");
assert.strictEqual(row(w, "Nikola Jokić").verdict, "lock", "56.5 with 3 games left is a lock");
assert.strictEqual(row(w, "Josh Giddey").verdict, "hold", "29.5 is about his average; hold");
assert.strictEqual(row(w, "Kyrie Irving").verdict, "wait", "DNP is not a game");

// Thursday: Clingan has 26.5 then 41
w = weekAt("2025-11-20");
show(w, "Thu Nov 20");
assert.strictEqual(row(w, "Donovan Clingan").verdict, "lock");
assert.strictEqual(row(w, "Donovan Clingan").latest, 41);

// marking a lock sticks
w = weekAt("2025-11-20", "even", ["2728"]);
assert.strictEqual(row(w, "Donovan Clingan").verdict, "locked");

// after the week: last games count automatically
w = weekAt("2025-11-24");
show(w, "Mon Nov 24 (week over)");
assert.ok(w.rows.filter((r) => r.playedCount > 0).every((r) => r.verdict === "final"));

// what would locking by these rules have scored vs letting the last game ride?
let lockedSum = 0, lastSum = 0;
for (const pl of roster) {
  const logs = stats.filter((r) => r.player_id === pl.id && r.sp > 0).sort((a, b) => a.date.localeCompare(b.date));
  if (!logs.length) continue;
  lastSum += logs[logs.length - 1].pts_std;
  let got = null;
  for (let i = 0; i < logs.length; i++) {
    const today = new Date(Date.parse(logs[i].date + "T12:00:00Z") + 864e5).toISOString().slice(0, 10);
    const r = row(weekAt(today), pl.n);
    if (r.verdict === "lock" || r.verdict === "final") { got = logs[i].pts_std; break; }
  }
  lockedSum += got == null ? logs[logs.length - 1].pts_std : got;
}
console.log(`\nThat week, following the lock calls scored ${lockedSum.toFixed(1)} vs ${lastSum.toFixed(1)} by letting every last game count (+${(lockedSum - lastSum).toFixed(1)}).`);
// a game in progress: partial stats must not trigger a lock, and the earlier score is gone
{
  const jk = roster.find((r) => r.n === "Nikola Jokić");
  const games = [{ date: "2025-11-17", status: "complete" }, { date: "2025-11-19", status: "in_game" }, { date: "2025-11-21", status: "pre_game" }];
  const logs = [{ date: "2025-11-17", score: 30, sp: 2000 }, { date: "2025-11-19", score: 61, sp: 1500 }];
  const r = L.analyzePlayer(jk, games, logs, "2025-11-19", { z: D.league.lock.z });
  assert.strictEqual(r.verdict, "live", "partial in-game stats are ignored");
  assert.ok(/can no longer be locked/.test(r.text));
  // final whistle, but Sleeper hasn't posted the stat line yet
  const games2 = [{ date: "2025-11-17", status: "complete" }, { date: "2025-11-19", status: "complete" }, { date: "2025-11-21", status: "pre_game" }];
  const r2 = L.analyzePlayer(jk, games2, logs.slice(0, 1), "2025-11-19", { z: D.league.lock.z });
  assert.strictEqual(r2.verdict, "pending", "missing final -> wait for stats, don't lock the stale 30");
  console.log("Live and late-stats guards:", r.text, "|", r2.text);
}
console.log("All lock checks passed.");
