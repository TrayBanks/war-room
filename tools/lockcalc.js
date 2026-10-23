#!/usr/bin/env node
// Lock or hold from the command line, with the same math the extension uses.
//   node tools/lockcalc.js "Nikola Jokić" 43 2            -> verdict for a 43 with 2 games left
//   node tools/lockcalc.js "Nikola Jokić" - 4 chase       -> lock lines for 1..4 games left, chasing
//   node tools/lockcalc.js --avg 31 --cv 0.35 38 1        -> any player by average and spread
const fs = require("fs"), path = require("path"), vm = require("vm");
const base = path.join(__dirname, "..");
const ctx = {}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(base, "extension/data.js"), "utf8") + ";this.WR_DATA=WR_DATA;", ctx);
const D = ctx.WR_DATA;
global.WR_DEFAULT_Z = D.league.lock.z;
const L = require(path.join(base, "extension/lock.js"));
const norm = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");

const args = process.argv.slice(2);
let mu, cv = D.league.lock.pool_cv, rest = 0.08, name;
const flag = (k) => { const i = args.indexOf(k); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const avg = flag("--avg"), cvArg = flag("--cv");
if (avg) { mu = +avg; name = `${mu} FPPG player`; if (cvArg) cv = +cvArg; }
else {
  const q = norm(args.shift() || "");
  const p = D.players.find((x) => norm(x.n) === q) || D.players.find((x) => norm(x.n).includes(q));
  if (!p) { console.error("Player not found. Use --avg <fppg> [--cv <spread>] for anyone else."); process.exit(1); }
  ({ f: mu, cv, rest } = p); name = p.n;
}
const [scoreArg, leftArg, risk = "even"] = args;
const k = Math.max(1, +(leftArg || 1));
const sol = L.solve(mu, cv, 1 - rest, Math.max(k, 4), { risk, z: D.league.lock.z });
console.log(`${name}: ${mu.toFixed(1)} FPPG, spread ±${Math.round(cv * 100)}%, plays ${Math.round((1 - rest) * 100)}% of scheduled games, risk ${risk}`);
console.log("Lock lines: " + [1, 2, 3, 4].map((j) => `${j} left ${sol.T[j].toFixed(1)}`).join(" · "));
if (scoreArg && scoreArg !== "-") {
  const c = +scoreArg, hold = sol.cont(c, k);
  console.log(c >= sol.T[k] ? `LOCK ${c.toFixed(1)}: beats the ${sol.T[k].toFixed(1)} line; waiting is worth about ${hold.toFixed(1)}.`
    : `HOLD: ${c.toFixed(1)} is under the ${sol.T[k].toFixed(1)} line; waiting is worth about ${hold.toFixed(1)}.`);
}
