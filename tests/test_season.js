// Lock-In panel smoke test: boots season.js on a fake league page in jsdom. The real Nov 17-23, 2025 week
// (your mock roster's games) is shifted onto the current Mon-Sun week so "today" falls mid-week.
const fs = require("fs"), path = require("path"), assert = require("assert");
const { JSDOM } = require("jsdom");
const ext = path.join(__dirname, "../extension");
const src = ["data.js", "engine.js", "lock.js", "bridge.js", "styles.js", "content.js", "season.js"].map((f) => fs.readFileSync(path.join(ext, f), "utf8"));
const psv = (f) => { const [h, ...rows] = fs.readFileSync(path.join(__dirname, "fixtures", f), "utf8").trim().split("\n"); const k = h.split("|"); return rows.map((r) => Object.fromEntries(r.split("|").map((v, i) => [k[i], v]))); };

const ME = "107261208461459456", LEAGUE = "1398532731020828672";
const etDate = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(d || new Date());
const addDays = (iso, n) => new Date(Date.parse(iso + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const today = etDate();
const monday = addDays(today, -((new Date(today + "T12:00:00Z").getUTCDay() + 6) % 7));
const shift = (d) => addDays(monday, Math.round((Date.parse(d) - Date.parse("2025-11-17")) / 864e5));

const sched = psv("week5_sched.psv").map((g) => ({ ...g, date: shift(g.date) }));
let firstToday = true;
const schedule = sched.map((g) => {
  let status = g.date < today ? "complete" : "pre_game";
  if (g.date === today && firstToday) { status = "in_game"; firstToday = false; }
  return { date: g.date, week: 3, status, home: { team: g.home }, away: { team: g.away } };
});
// a far-away week so the week picker has something else to choose from
schedule.push({ date: addDays(monday, 14), week: 4, status: "pre_game", home: { team: "BOS" }, away: { team: "NYK" } });
const liveTeams = new Set(schedule.filter((g) => g.status === "in_game").flatMap((g) => [g.home.team, g.away.team]));
const statRows = psv("week5_stats.psv").map((r) => ({ ...r, date: shift(r.date) }))
  .filter((r) => r.date < today || (r.date === today && liveTeams.has(r.team)))      // include partial stats for the live game
  .map((r) => ({ player_id: r.player_id, date: r.date, team: r.team, stats: { pts_std: +r.pts_std, sp: +r.sp } }));
const ids = [...new Set(psv("week5_stats.psv").map((r) => r.player_id))];
const rosters = [{ owner_id: ME, roster_id: 10, players: ids, starters: ids.slice(0, 10) }, { owner_id: "u1", roster_id: 1, players: [], starters: [] }];

(async () => {
  const dom = new JSDOM(`<!doctype html><html><head></head><body><div id="app"></div></body></html>`,
    { url: `https://sleeper.com/leagues/${LEAGUE}/team`, pretendToBeVisual: true, runScripts: "outside-only" });
  const w = dom.window;
  w.localStorage.setItem("user_id", JSON.stringify(ME));
  const calls = [];
  w.fetch = async (url) => {
    calls.push(url);
    let body = {};
    if (/\/league\/\d+\/rosters$/.test(url)) body = rosters;
    else if (/\/league\/\d+$/.test(url)) body = { league_id: LEAGUE, sport: "nba", season: "2026", name: "NBA League Revamped" };
    else if (/schedule\/nba/.test(url)) body = schedule;
    else if (/stats\/nba\/2026\/3/.test(url)) body = statRows;
    else if (/projections/.test(url)) body = [];
    return { ok: true, json: async () => JSON.parse(JSON.stringify(body)) };
  };
  const errors = [];
  w.addEventListener("error", (e) => errors.push(e.message));
  for (const s of src) w.eval(s);
  await new Promise((r) => setTimeout(r, 600));
  assert.ok(!w.document.getElementById("wr-overlay-host"), "draft panel stays off league pages");
  const host = w.document.getElementById("wr-season-host");
  assert.ok(host, "Lock-In panel mounted");
  const root = host.shadowRoot, wr = root.querySelector(".wr");
  assert.ok(wr.classList.contains("collapsed"), "collapsed by default");
  console.log("Rail:", root.querySelector(".rail").textContent.replace(/\s+/g, " "));
  root.querySelector('.rail').dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 60));
  assert.ok(!wr.classList.contains("collapsed"), "opens");
  console.log("Header:", root.querySelector("#hsub").textContent, "| Banner:", root.querySelector("#bn").textContent.replace(/\s+/g, " "));
  const api = w.__WR_SEASON_API;
  const res = api.result;
  assert.ok(res && res.rows.length === ids.length, "one card per rostered player");
  console.log(`Today is ${today} (${new Date(today + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })}).`);
  for (const r of res.rows) console.log(`  ${r.starter ? "S" : "b"} ${r.n.padEnd(20)} ${r.verdict.padEnd(7)} ${r.text}`);
  // partial stats from a game in progress must never produce a Lock call
  for (const r of res.rows) {
    const live = r.timeline.find((g) => g.live);
    if (live) assert.ok(r.verdict === "live" || r.verdict === "locked", `${r.n}: in-game partial stats ignored`);
  }
  assert.strictEqual(root.querySelectorAll(".lk").length, res.rows.filter((r) => r.starter).length, "starter cards shown, bench folded");
  // risk switch moves the lines
  const lineOf = () => api.result.rows.find((r) => r.lines && r.k >= 2);
  const before = lineOf();
  if (before) {
    root.querySelector('[data-act="risk"][data-v="chase"]').dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 40));
    const after = api.result.rows.find((r) => r.id === before.id);
    console.log(`Chase moves ${before.n}'s ${before.k}-left line ${before.lines[before.k - 1].toFixed(1)} -> ${after.lines[after.k - 1].toFixed(1)}`);
    assert.ok(after.lines[after.k - 1] > before.lines[before.k - 1], "chasing raises the bar");
    root.querySelector('[data-act="risk"][data-v="even"]').dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 40));
  }
  // mark a lock
  const markBtn = root.querySelector('[data-act="mark"]');
  if (markBtn) {
    const id = markBtn.dataset.id;
    markBtn.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 40));
    assert.strictEqual(api.result.rows.find((r) => r.id === id).verdict, "locked", "mark locked sticks");
  }
  // calculator
  root.querySelector('[data-act="tab"][data-v="calc"]').dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 40));
  const sel = root.getElementById("c-id");
  sel.value = "1658"; sel.dispatchEvent(new w.Event("change", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 40));
  const sc = root.getElementById("c-score"); sc.value = "52"; sc.dispatchEvent(new w.Event("input", { bubbles: true }));
  console.log("Calculator (Jokić 52, 2 left):", root.getElementById("c-res").textContent);
  assert.ok(/Lock/.test(root.getElementById("c-res").textContent));
  sc.value = "30"; sc.dispatchEvent(new w.Event("input", { bubbles: true }));
  console.log("Calculator (Jokić 30, 2 left):", root.getElementById("c-res").textContent);
  assert.ok(/Hold/.test(root.getElementById("c-res").textContent));
  assert.ok(calls.some((u) => /stats\/nba\/2026\/3/.test(u)), "fetched this week's stats");
  assert.strictEqual(errors.length, 0, errors.join("\n"));
  console.log("All Lock-In panel checks passed.");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
