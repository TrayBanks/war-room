#!/usr/bin/env node
// Sleeper's most added / dropped NBA players, why they're moving, and whether each is worth it for Tray's lineup.
//   node tools/trending.js data/live/trending_<date>.json data/live/league_<date>.json data/live/extras_<date>.json
// Value used for a candidate: preseason projection nudged 30% toward his week-1 fantasy points when he played 20+ minutes
// (a new role shows up in minutes first). Gain = best weekly lineup gain from swapping him for one of your bench players.
const fs = require("fs"), path = require("path"), vm = require("vm");
const base = path.join(__dirname, "..");
const ctx = {}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(base, "extension/data.js"), "utf8") + ";this.WR_DATA=WR_DATA;", ctx);
const D = ctx.WR_DATA;
const E = require(path.join(base, "extension/engine.js"));
const T = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const LG = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const EX = JSON.parse(fs.readFileSync(process.argv[4], "utf8"));
const ME = "107261208461459456";
for (const [id, [n, t, pos, inj, fppg]] of Object.entries(EX.extra)) if (!D.players.find((p) => p.id === id)) D.players.push({ id, n, t, p: pos.split("/"), adp: 300, f: fppg, a: 0.85, lv: fppg, lk: 1, cv: 0.35, rest: 0.1, s: [] });
const eng = new E.Engine(D);
for (const p of eng.players) p.inj = EX.inj[p.id] || "";
const S = (p) => (p.inj === "Out" ? p.lv * 0.5 : p.lv);
const owners = Object.fromEntries(LG.rosters.map(([rid, uid]) => [rid, LG.users[uid][0]]));
const mineRow = LG.rosters.find((r) => r[1] === ME);
const mine = mineRow[2].map((id) => eng.byId.get(id)).filter(Boolean);
const ir = new Set(mineRow[4]);
const teamValue = (players) => { const fm = eng.fitModel(players, S); const bench = players.filter((p) => !fm.starters.includes(p)).map(S).sort((a, b) => b - a).slice(0, 5); return { fm, v: fm.best + 0.15 * bench.reduce((a, b) => a + b, 0) }; };
const base0 = teamValue(mine), V0 = base0.v;
const droppable = mine.filter((p) => !base0.fm.starters.includes(p) && !ir.has(p.id));

function analyze([id, count, name, team, pos, inj, proj, adp, ownerRid, games], kind) {
  const g = games[0];
  const played = g && g[3] > 0;
  const est = proj != null ? (played && g[3] >= 20 ? proj + 0.3 * (g[2] - proj) : proj) : g ? g[2] : 0;
  const known = eng.byId.get(id);
  const lk = known && known.lk ? known.lk : 1;
  const cand = { id, n: name, t: team, p: pos.split("/"), lv: est * lk, inj, adp: adp || 300 };
  // why it's moving (facts from the box score, injuries and roster news)
  const why = [];
  if (T.context[id]) why.push(T.context[id]);
  if (!team && !T.context[id]) why.push("No team listed");
  if (g) {
    if (!played) why.push(`Did not play ${g[0]}`);
    else why.push(`${g[2]} FP in ${g[3]} min vs ${g[1]} (${g[4]} pts, ${g[5]} reb, ${g[6]} ast${g[7] ? `, ${g[7]} stl+blk` : ""})`);
  }
  const hurt = (T.injured[team] || []).filter((s) => !s.startsWith(name)).map((s) => s.replace(/ (Out|DTD|GTD|Questionable|Doubtful)$/, ""));
  if (kind === "add" && hurt.length && !T.context[id]) why.push(`Teammates out: ${hurt.join(", ")}`);
  if (inj) why.push(`Listed ${inj}`);
  // what it means for Tray
  let verdict, detail = "", gain = null;
  const yours = mineRow[2].includes(id);
  const net = (T.add.find((r) => r[0] === id) || [0, 0])[1] - (T.drop.find((r) => r[0] === id) || [0, 0])[1];
  const bigGame = played && g[3] >= 24 && g[2] >= 20;
  if (yours) {
    const others = mine.filter((p) => p.id !== id), adds = eng.fitModel(others, S).marginal(eng.byId.get(id) || cand);
    verdict = net < 0 || (g && g[2] < 10) ? "Yours: drop candidate" : "Yours: keep";
    detail = `adds ${adds.toFixed(1)}/wk to your lineup`;
  } else if (ownerRid) {
    verdict = "Owned"; detail = `by ${owners[ownerRid]}`;
  } else if (!team) {
    verdict = "Pass"; detail = "no NBA team right now";
  } else {
    let best = null;
    for (const d of droppable) { const v = teamValue(mine.filter((p) => p !== d).concat([cand])).v - V0; if (!best || v > best.v) best = { v, drop: d.n }; }
    gain = best ? best.v : 0;
    const losingRole = !played || g[3] < 20;
    if (kind === "drop") {   // the crowd is selling: only a buy if he still has the minutes and clearly helps
      verdict = !losingRole && gain >= 1.5 ? "Buy-low add" : "Pass";
      detail = verdict === "Pass" ? (losingRole ? "lost minutes or didn't play" : `only +${Math.max(0, gain).toFixed(1)}/wk`) : `+${gain.toFixed(1)}/wk for ${best.drop}`;
    } else {
      verdict = gain >= 1.5 ? "Add" : gain >= 0.5 && !losingRole ? "Speculative add" : bigGame ? "Watch" : "Pass";
      detail = gain >= 0.5 && verdict !== "Pass" && verdict !== "Watch" ? `+${gain.toFixed(1)}/wk for ${best.drop}` : bigGame ? "one big game; check his minutes next game" : losingRole ? "small role so far" : "not better than your bench";
    }
  }
  return { id, name, team: team || "FA", pos, count, net, est: +est.toFixed(1), proj, last: g ? { fp: g[2], min: g[3], vs: g[1], day: g[0] } : null, out: hurt.slice(0, 3), inj: inj || "",
    why: why.join(". "), verdict, detail, gain: gain != null ? +gain.toFixed(2) : null };
}
const out = { asof: T.asof, lookback: T.lookback_hours, add: T.add.map((r) => analyze(r, "add")), drop: T.drop.map((r) => analyze(r, "drop")) };
fs.writeFileSync(path.join(base, "reports", `trending_${T.asof}.json`), JSON.stringify(out));
for (const k of ["add", "drop"]) {
  console.log(`\nMost ${k === "add" ? "added" : "dropped"} (last ${T.lookback_hours}h):`);
  for (const r of out[k]) console.log(`  ${r.name.padEnd(22)} ${String(Math.round(r.count / 1000)).padStart(4)}k  est ${String(r.est).padStart(5)}  ${r.verdict.padEnd(22)} ${r.detail}  | ${r.why}`);
}
