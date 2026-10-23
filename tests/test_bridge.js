// Exercises the bridge against fake rooms built from the markup captured in Sleeper's live draft room.
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { JSDOM } = require("jsdom");
const bridgeSrc = fs.readFileSync(path.join(__dirname, "../extension/bridge.js"), "utf8");
const ALL = ["Victor Wembanyama", "Nikola Jokić", "Donovan Clingan", "Onyeka Okongwu"];

function classicRoom({ myTurn, confirm }) {
  const dom = new JSDOM(`<div id="app"><input placeholder="Find player Ctrl + U"><div class="list"></div>
    <div class="queue-wrapper"><div class="draft-queue"><div class="autopick-toggle"><input type="checkbox"></div></div><div class="q"></div></div></div>`, { pretendToBeVisual: true, runScripts: "outside-only" });
  const { window } = dom, d = window.document;
  window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 10, height: 10 });
  const state = { queued: new Set(["Victor Wembanyama"]), drafted: null };
  const render = () => {
    const term = d.querySelector("input").value.toLowerCase();
    const show = term ? ALL.filter((n) => n.toLowerCase().includes(term)) : ALL.slice(0, 2); // virtualized: only 2 rows until searched
    d.querySelector(".list").innerHTML = show.map((n) => `<div class="player-rank-item2 C show-watchlist-action odd">
      <div class="draft-button-wrapper"><div class="draft-button ${myTurn ? "" : "disable"}"><svg></svg></div></div><div class="rank">1</div>
      <div class="name"><div class="name-wrapper">${n}<div class="position"><div class="position-dot"></div>C <span class="team">SAS</span></div></div>
      <div class="watchlist-action"><img></div><div class="queue-action ${state.queued.has(n) ? "selected" : ""}"><img></div></div></div>`).join("");
    d.querySelectorAll(".player-rank-item2").forEach((row) => {
      const n = row.querySelector(".name-wrapper").childNodes[0].nodeValue;
      row.querySelector(".queue-action").addEventListener("click", () => { state.queued.has(n) ? state.queued.delete(n) : state.queued.add(n); render(); });
      row.querySelector(".draft-button").addEventListener("click", (e) => {
        if (e.currentTarget.classList.contains("disable")) return;
        if (confirm) { d.body.insertAdjacentHTML("beforeend", `<div class="modal"><div>Draft ${n}?</div><button class="btn">Confirm</button></div>`);
          d.querySelector(".modal .btn").addEventListener("click", () => { state.drafted = n; d.querySelector(".modal").remove(); }); }
        else state.drafted = n;
      });
    });
    d.querySelector(".q").innerHTML = [...state.queued].map((n) => `<div class="draft-queue-player-item"><div class="meta-container"><div class="name">${n}</div></div><div class="delete-button">REMOVE</div></div>`).join("");
    d.querySelectorAll(".q .delete-button").forEach((b) => b.addEventListener("click", (e) => { state.queued.delete(e.target.parentElement.querySelector(".name").textContent); render(); }));
  };
  d.querySelector("input").addEventListener("input", render);
  render();
  window.eval(bridgeSrc);
  return { window, state, d };
}

function betaRoom({ myTurn }) {
  const dom = new JSDOM(`<input placeholder="Search Player or Team"><table><tbody></tbody></table><div aria-label="Roster, queue, chat" class="panel"></div><button aria-label="Auto-pick" aria-pressed="false"></button>`, { pretendToBeVisual: true, runScripts: "outside-only" });
  const { window } = dom, d = window.document;
  window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 10, height: 10 });
  const state = { queued: new Set(["Darius Garland"]), drafted: null };
  const render = () => {
    const term = d.querySelector("input").value.toLowerCase();
    const show = term ? ALL.filter((n) => n.toLowerCase().includes(term)) : ALL.slice(0, 2);
    d.querySelector("tbody").innerHTML = show.map((n) => `<tr><td><button data-slot="button" ${myTurn ? "" : "disabled"}><div><span>DRAFT</span></div></button></td>
      <td>1</td><td><button type="button" aria-label="Open ${n}"><span>${n}</span></button></td>
      <td><label><input aria-label="Add ${n} to watchlist" type="checkbox"></label></td>
      <td><button type="button" aria-pressed="${state.queued.has(n)}" aria-label="${state.queued.has(n) ? "Remove " + n + " from queue" : "Add " + n + " to queue"}"></button></td></tr>`).join("");
    d.querySelectorAll("tbody tr").forEach((tr) => {
      const n = tr.querySelector('button[aria-label^="Open "]').getAttribute("aria-label").slice(5);
      tr.querySelector('button[aria-label$="queue"]').addEventListener("click", () => { state.queued.has(n) ? state.queued.delete(n) : state.queued.add(n); render(); });
      tr.querySelector('button[data-slot="button"]').addEventListener("click", (e) => { if (!e.currentTarget.disabled) state.drafted = n; });
    });
    d.querySelector(".panel").innerHTML = [...state.queued].map((n) => `<div><button>Draft</button><span>${n[0]}. ${n.split(" ").slice(-1)[0]}</span><span>PG • LAC</span><button aria-label="Remove from queue"></button></div>`).join("");
  };
  d.querySelector("input").addEventListener("input", render);
  render();
  window.eval(bridgeSrc);
  return { window, state, d };
}

(async () => {
  // classic
  let r = classicRoom({ myTurn: false, confirm: true });
  let B = r.window.WR_BRIDGE;
  assert.strictEqual(B.layout(), "classic");
  assert.strictEqual(JSON.stringify(B.readQueue().names), JSON.stringify(["Victor Wembanyama"]));
  assert.strictEqual(B.autopickOn(), false);
  let res = await B.queue("Donovan Clingan");           // not rendered until searched
  assert.ok(res.ok && !res.already, JSON.stringify(res));
  assert.ok(r.state.queued.has("Donovan Clingan"));
  await new Promise((s) => setTimeout(s, 450));
  assert.strictEqual(r.d.querySelector("input").value, "", "search restored");
  res = await B.queue("Victor Wembanyama"); assert.ok(res.already);
  res = await B.draft("Nikola Jokic", {});               // accent-insensitive match, not my turn
  assert.strictEqual(res.reason, "not-your-turn");
  res = await B.unqueue("Donovan Clingan"); assert.ok(res.ok); assert.ok(!r.state.queued.has("Donovan Clingan"));
  r = classicRoom({ myTurn: true, confirm: true }); B = r.window.WR_BRIDGE;
  res = await B.draft("Onyeka Okongwu", { autoConfirm: true });
  assert.ok(res.ok && res.confirmed, JSON.stringify(res)); assert.strictEqual(r.state.drafted, "Onyeka Okongwu");
  r = classicRoom({ myTurn: true, confirm: true }); B = r.window.WR_BRIDGE;
  res = await B.draft("Onyeka Okongwu", { autoConfirm: false });
  assert.ok(res.ok && !res.confirmed); assert.strictEqual(r.state.drafted, null, "left Sleeper's confirm for the user");
  console.log("classic room: queue, unqueue, search+restore, turn check, draft+confirm all pass");

  // beta
  r = betaRoom({ myTurn: false }); B = r.window.WR_BRIDGE;
  assert.strictEqual(B.layout(), "beta");
  assert.strictEqual(JSON.stringify(B.readQueue().names), JSON.stringify(["D. Garland"]));
  assert.strictEqual(B.autopickOn(), false);
  res = await B.queue("Donovan Clingan"); assert.ok(res.ok); assert.ok(r.state.queued.has("Donovan Clingan"));
  res = await B.draft("Victor Wembanyama", {}); assert.strictEqual(res.reason, "not-your-turn");
  r = betaRoom({ myTurn: true }); B = r.window.WR_BRIDGE;
  res = await B.draft("Donovan Clingan", { autoConfirm: true }); assert.ok(res.ok); assert.strictEqual(r.state.drafted, "Donovan Clingan");
  res = await B.unqueue("Donovan Clingan"); assert.strictEqual(res.reason, "not-queued");
  res = await B.queue("Nobody Real"); assert.strictEqual(res.reason, "not-found");
  console.log("beta room: queue, search, turn check, draft, not-found all pass");
  console.log("All bridge checks passed.");
})().catch((e) => { console.error(e); process.exit(1); });
