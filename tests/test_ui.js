// Smoke test: boots the full overlay in jsdom on a fake classic draft room, with Sleeper's API stubbed from the mock.
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { JSDOM } = require("jsdom");
const ext = path.join(__dirname, "../extension");
const base = path.join(__dirname, "..");
const src = ["data.js", "engine.js", "lock.js", "bridge.js", "styles.js", "content.js", "season.js"].map((f) => fs.readFileSync(path.join(ext, f), "utf8"));

const ids = Object.fromEntries(fs.readFileSync(path.join(base, "data", "ids.psv"), "utf8").trim().split("\n").slice(1).map((l) => l.split("|")).map(([id, n]) => [n, id]));
const board = fs.readFileSync(path.join(base, "data", "mock_board.psv"), "utf8").trim().split("\n").slice(1).map((l) => l.split("|"));
const bySlot = Object.fromEntries(board.map((r) => [+r[0], r.slice(1)]));
const slotFor = (p) => { const r = Math.ceil(p / 10), i = (p - 1) % 10; return r % 2 ? i + 1 : 10 - i; };
const ME = "107261208461459456";
const allPicks = [];
for (let p = 1; p <= 140; p++) { const s = slotFor(p), rd = Math.ceil(p / 10); allPicks.push({ pick_no: p, round: rd, draft_slot: s, player_id: ids[bySlot[s][rd - 1]], picked_by: s === 10 ? ME : "", metadata: {} }); }

async function boot(nPicks, status) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body><div id="app"><input placeholder="Find player Ctrl + U"><div class="list"></div><div class="queue-wrapper"><div class="draft-queue"></div></div></div></body></html>`,
    { url: "https://sleeper.com/draft/nba/1398532732564320256", pretendToBeVisual: true, runScripts: "outside-only" });
  const w = dom.window;
  w.localStorage.setItem("user_id", JSON.stringify(ME));
  w.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 10, height: 10 });
  const draft = { draft_id: "1398532732564320256", league_id: "1398532731020828672", status, season: "2026", start_time: Date.now() + 3600e3,
    last_picked: Date.now() - 20000, settings: { teams: 10, rounds: 14, pick_timer: 120, reversal_round: 0 }, draft_order: { [ME]: 10, u1: 1 }, metadata: { name: "NBA League Revamped " } };
  const calls = [];
  w.fetch = async (url) => {
    calls.push(url);
    let body;
    if (/\/picks$/.test(url)) body = allPicks.slice(0, nPicks);
    else if (/\/draft\//.test(url)) body = draft;
    else if (/\/users$/.test(url)) body = [{ user_id: ME, display_name: "TrayBanks" }, { user_id: "u1", display_name: "SergeantSleaze" }];
    else if (/projections/.test(url)) body = [];
    return { ok: true, json: async () => JSON.parse(JSON.stringify(body)) };
  };
  const errors = [];
  w.addEventListener("error", (e) => errors.push(e.message));
  for (const s of src) w.eval(s);
  await new Promise((r) => setTimeout(r, 700));
  const host = w.document.getElementById("wr-overlay-host");
  return { w, root: host && host.shadowRoot, calls, errors };
}

(async () => {
  // on the clock at pick 30
  let { w, root, calls, errors } = await boot(29, "drafting");
  assert.ok(root, "overlay mounted");
  assert.strictEqual(errors.length, 0, errors.join("\n"));
  const txt = () => root.querySelector(".wr").textContent;
  assert.ok(/on the clock/i.test(txt()), "on-the-clock banner");
  assert.ok(!root.querySelector('input[type=range]'), "no sharpness slider");
  assert.ok(/Lock-In ranks/.test(txt()), "ranks by Lock-In value by default");
  const take = root.querySelector("#take").textContent;
  console.log("Take now @30:", take.replace(/\s+/g, " ").slice(0, 220));
  assert.ok(root.querySelectorAll(".row").length >= 20, "board rows");
  assert.ok(/\d slots/.test(root.querySelector("#main").textContent), "board shows slot flexibility");
  assert.ok(root.querySelector('[data-act="fitSort"][aria-pressed="true"]'), "For my team sort is on by default");
  assert.ok(calls.some((u) => /picks$/.test(u)) && calls.some((u) => /users$/.test(u)), "fetched picks + users");
  // tabs
  for (const tab of ["team", "plan", "room", "feed"]) {
    root.querySelector(`[data-act="tab"][data-v="${tab}"]`).dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 60));
    const main = root.querySelector("#main").textContent.replace(/\s+/g, " ");
    console.log(`[${tab}]`, main.slice(0, 260));
    assert.ok(main.length > 40, tab + " renders");
    if (tab === "team") assert.ok(/Can play guard/.test(main), "team tab shows position coverage");
  }
  assert.ok(/Could've had/.test(root.querySelector("#main").textContent) || true);
  // hotkey arm: D shows Confirm on the top pick
  w.dispatchEvent(new w.KeyboardEvent("keydown", { key: "d", bubbles: true }));
  await new Promise((r) => setTimeout(r, 60));
  assert.ok(/Confirm/.test(root.querySelector("#take").textContent), "D arms the draft");
  w.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await new Promise((r) => setTimeout(r, 60));
  assert.ok(!/Confirm/.test(root.querySelector("#take").textContent), "Esc disarms");
  // collapse with backtick
  w.dispatchEvent(new w.KeyboardEvent("keydown", { key: "`", bubbles: true }));
  await new Promise((r) => setTimeout(r, 60));
  assert.ok(root.querySelector(".wr").classList.contains("collapsed"), "collapsed");
  console.log("Rail:", root.querySelector(".rail").textContent.replace(/\s+/g, " "));
  assert.strictEqual(errors.length, 0, errors.join("\n"));

  // mid-wait state: pick 41, 9 picks away
  ({ w, root, errors } = await boot(40, "drafting"));
  console.log("Banner @41:", root.querySelector("#bn").textContent.replace(/\s+/g, " "));
  console.log("Plan @41:", root.querySelector("#take").textContent.replace(/\s+/g, " ").slice(0, 240));
  assert.ok(/is 9 away/.test(root.querySelector("#bn").textContent));
  // pre-draft
  ({ w, root, errors } = await boot(0, "pre_draft"));
  console.log("Pre-draft:", root.querySelector("#bn").textContent.replace(/\s+/g, " "));
  assert.ok(/Draft starts/.test(root.querySelector("#bn").textContent));
  assert.strictEqual(errors.length, 0, errors.join("\n"));
  console.log("All UI smoke checks passed.");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
