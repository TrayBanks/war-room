/* War Room — live draft panel for Sleeper NBA drafts (v1.1).
   Lock-In rankings, learned per-manager sharpness, simulated "will he last" odds, one-click draft/queue through Sleeper. */
(function () {
  "use strict";
  if (window.__WR_LOADED) return;
  window.__WR_LOADED = true;

  const D = window.WR_DATA, E = window.WR_ENGINE, B = window.WR_BRIDGE;
  const eng = new E.Engine(D);
  const hasExt = typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const f1 = (x) => (x == null || isNaN(x) ? "–" : (+x).toFixed(1));
  const pc = (x) => Math.round(x * 100) + "%";
  const last = (n) => String(n).split(" ").slice(-1)[0];
  const VERSION = "1.2";

  /* ---------------- settings ---------------- */
  const DEFAULTS = { v: VERSION, collapsed: false, dock: "side", tall: false, fitSort: true, size: "normal", mode: "lock", autoConfirm: true, sound: true,
    autoExpand: true, push: false, starred: [], hidden: [], slot: 0, tab: "board", pos: "ALL", fits: false, showHidden: false };
  let S = { ...DEFAULTS };
  const store = {
    async load() {
      try {
        if (hasExt && chrome.storage) {
          const r = await chrome.storage.local.get("wr");
          const saved = r.wr || {};
          S = { ...DEFAULTS, ...saved };
          if (saved.v !== VERSION) { S.mode = "lock"; S.dock = saved.dock || "side"; S.fitSort = true; S.v = VERSION; if (S.tab === "plan") S.tab = "board"; }
        }
      } catch (e) { /* keep defaults */ }
    },
    save() { try { if (hasExt && chrome.storage) chrome.storage.local.set({ wr: S }); } catch (e) { /* ignore */ } },
  };
  const WIDTH = { compact: 330, normal: 380, wide: 460 };
  const MODE_LABEL = { lock: "Lock-In", floor: "Floor", ceiling: "Ceiling" };

  async function getJSON(url) {
    if (hasExt) {
      const r = await chrome.runtime.sendMessage({ type: "wr-fetch", url });
      if (!r || !r.ok) throw new Error((r && r.error) || "fetch failed");
      return r.data;
    }
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }
  const userId = (() => { try { const v = localStorage.getItem("user_id"); return v ? JSON.parse(v) : null; } catch (e) { return localStorage.getItem("user_id"); } })() || D.league.user_id;

  /* ---------------- state ---------------- */
  let draftId = null, draft = null, picks = [], st = null, users = {}, lastOk = 0, err = null, lastPicksAt = 0;
  let sq = { names: [], abbrev: false, visible: false }, sqIds = new Set(), autopick = null;
  let rankMap = new Map(), adpRankMap = new Map();
  let armed = null, expectPick = null, expanded = new Set(), showN = 40, feedFilter = "all", tempExpand = false;
  let prevTurn = false, prevUntil = null, beeped20 = false, lastProj = 0, metaTimer = null, inflight = false;

  /* ---------------- DOM ---------------- */
  const host = document.createElement("div");
  host.id = B.HOST_ID;
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>${window.WR_CSS}</style>
  <div class="wr" hidden>
    <div class="rail" data-act="collapse" title="Open War Room ( \` )"></div>
    <div class="hd">
      <span class="mark"><i id="dot"></i></span>
      <div class="grow"><div class="ttl">War Room</div><div class="sub" id="hsub">Connecting to the draft…</div></div>
      <div class="seg" role="group" aria-label="Rank by">
        <button data-act="mode" data-v="lock" title="One locked game per week: optimal-stopping value">Lock</button>
        <button data-act="mode" data-v="floor" title="FPPG × expected games">Floor</button>
        <button data-act="mode" data-v="ceiling" title="Raw FPPG, ignores injury risk">Ceiling</button>
      </div>
      <button class="ib" data-act="tall" title="Full height / back to Sleeper's side column">⤢</button>
      <button class="ib" data-act="settings" title="Settings">⚙</button>
      <button class="ib" data-act="collapse" title="Hide ( \` )">›</button>
    </div>
    <div class="bn" id="bn"></div>
    <div class="take" id="take"></div>
    <div class="tabs" role="tablist">
      <button role="tab" data-act="tab" data-v="board">Board</button>
      <button role="tab" data-act="tab" data-v="plan">Plan</button>
      <button role="tab" data-act="tab" data-v="room">Room</button>
      <button role="tab" data-act="tab" data-v="team">Team</button>
      <button role="tab" data-act="tab" data-v="feed">Feed</button>
    </div>
    <div class="tb" id="tb">
      <input type="search" id="q" placeholder="Find player   /" autocomplete="off">
      <div class="chips" id="chips"></div>
    </div>
    <div class="main" id="main"></div>
    <div class="ft"><span><kbd>\`</kbd> hide</span><span><kbd>/</kbd> search</span><span><kbd>Q</kbd> queue top</span><span><kbd>D</kbd> <kbd>D</kbd> draft top</span><span><kbd>Esc</kbd> cancel</span></div>
    <div class="toasts" id="toasts"></div>
    <div class="set" id="set" hidden></div>
  </div>`;
  const $ = (sel) => root.querySelector(sel);
  const wr = $(".wr");
  function mount() { if (!host.isConnected) document.documentElement.appendChild(host); }

  /* ---------------- helpers ---------------- */
  function slotName(slot) {
    if (draft && draft.draft_order) {
      const uid = Object.keys(draft.draft_order).find((u) => draft.draft_order[u] === slot);
      if (uid === userId) return "You";
      if (uid && users[uid]) return users[uid];
    }
    return slot === (st && st.mySlot) ? "You" : `Team ${slot}`;
  }
  const score = (p) => eng.score(p, S.mode);
  const posDot = (p) => `<span class="dot ${esc((p.p || ["?"])[0])}"></span>`;
  function oddsPill(p) {
    if (!st || !st.nextMine) return "";
    const pr = st.isMyTurn ? p._pH : p._pNext;
    const target = st.isMyTurn ? st.horizon : st.nextMine;
    if (pr == null || !target) return "";
    const cls = pr >= 0.7 ? "hi" : pr >= 0.35 ? "mid" : "lo";
    return `<span class="odds ${cls}" title="Chance he is still there at your pick #${target}, simulated with each manager's learned sharpness">${pc(pr)} at #${target}</span>`;
  }
  function tags(p) {
    let t = "";
    if (p.inj === "Out" || p.out) t += `<span class="tag inj">Out</span>`;
    else if (p.inj) t += `<span class="tag dtd">${esc(p.inj)}</span>`;
    const gap = (adpRankMap.get(p) || 0) - (rankMap.get(p) || 0);
    if (gap >= 20) t += `<span class="tag gap" title="Sleeper ADP rank minus my rank">+${gap}</span>`;
    if (eng.isFade(p)) t += `<span class="tag fade">Fade</span>`;
    if (st && st.myRoster.length && p._fit != null && p._fit < 0.6 * score(p)) t += `<span class="tag sits" title="The lineup slots he can play are already filled with better players, so he'd mostly sit">Sits</span>`;
    else if (st && isCOnlyP(p) && st.myRoster.filter(isCOnlyP).length >= 1) t += `<span class="tag conly" title="Center-only: can play C or UTIL. You already have ${st.myRoster.filter(isCOnlyP).length}.">C only</span>`;
    if (sqIds.has(String(p.id))) t += `<span class="tag q">Queued</span>`;
    return t;
  }
  const TIER_COLORS = ["#00FFF9", "#00E1E0", "#03C3C5", "#04ABB0", "#07747F", "#8996AA", "#6C768A", "#4E586F", "#4E586F", "#4E586F"];
  function draftBtn(p) {
    const isArmed = armed && armed.pid === String(p.id) && Date.now() < armed.until;
    const myTurn = st && (st.isMyTurn || B.myTurnDom());
    const cls = isArmed ? "b arm" : myTurn ? "b pri" : "b pri off";
    return `<button class="${cls}" data-act="draft" data-id="${p.id}" title="${myTurn ? "Click twice to draft" : "Not your pick yet"}">${isArmed ? "Confirm" : "Draft"}</button>`;
  }
  function queueBtn(p) {
    const q = sqIds.has(String(p.id));
    return `<button class="b ${q ? "on" : "ghost"}" data-act="${q ? "unqueue" : "queue"}" data-id="${p.id}" title="${q ? "Remove from Sleeper queue" : "Add to Sleeper queue"}">${q ? "Queued" : "+ Queue"}</button>`;
  }
  function matchQueue() {
    sqIds = new Set();
    for (const nm of sq.names) {
      let p = eng.findByName(nm);
      if (!p) {
        const m = nm.match(/^([A-Za-z])\.\s*(.+)$/);
        if (m) { const ini = m[1].toLowerCase(), ln = E.norm(m[2]); p = eng.players.find((x) => E.norm(x.n.split(" ").slice(1).join(" ")) === ln && x.n[0].toLowerCase() === ini); }
      }
      if (p) sqIds.add(String(p.id));
    }
  }
  const playerById = (id) => eng.byId.get(String(id));
  const isCOnlyP = (p) => !!(p && p.p && p.p.length === 1 && p.p[0] === "C");
  const slotCount = (p) => { let c = 0; for (let x = eng.slotMask(p); x; x &= x - 1) c++; return c; };

  /* ---------------- toasts & sound ---------------- */
  function toast(msg, kind, ms) {
    const el = document.createElement("div");
    el.className = "toast " + (kind || "");
    el.textContent = msg;
    $("#toasts").appendChild(el);
    setTimeout(() => el.remove(), ms || 3200);
  }
  let actx = null;
  function beep(freq, dur, n) {
    if (!S.sound || !actx) return;
    for (let i = 0; i < (n || 1); i++) {
      const o = actx.createOscillator(), g = actx.createGain(), t0 = actx.currentTime + i * 0.22;
      o.frequency.value = freq; o.type = "sine";
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(actx.destination); o.start(t0); o.stop(t0 + dur + 0.02);
    }
  }
  root.addEventListener("pointerdown", () => { if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* no audio */ } } }, { once: true });

  /* ---------------- compute ---------------- */
  const perf = { compute: 0, paint: 0, maxCompute: 0, maxPaint: 0 };
  function recompute() {
    const t0 = performance.now();
    st = eng.compute(draft, picks, { userId, mode: S.mode, slot: +S.slot || null });
    perf.compute = performance.now() - t0; perf.maxCompute = Math.max(perf.maxCompute, perf.compute);
    const all = eng.players.slice().sort((a, b) => score(b) - score(a));
    rankMap = new Map(all.map((p, i) => [p, i + 1]));
    adpRankMap = new Map(eng.players.slice().sort((a, b) => a.adp - b.adp).map((p, i) => [p, i + 1]));
    sq = B.readQueue(); matchQueue(); autopick = B.autopickOn();
    if (st.isMyTurn && !prevTurn) { beep(880, 0.18, 2); beeped20 = false; if (S.collapsed && S.autoExpand) tempExpand = true; }
    if (!st.isMyTurn && prevTurn && tempExpand) tempExpand = false;
    if (st.picksUntilMine === 1 && prevUntil !== 1) beep(660, 0.12, 1);
    prevTurn = st.isMyTurn; prevUntil = st.picksUntilMine;
    if (expectPick) {
      if (picks.find((p) => String(p.player_id) === expectPick.pid)) { toast(`Drafted ${expectPick.name}`, "good"); expectPick = null; }
      else if (Date.now() - expectPick.t > 7000) { toast(`Sleeper hasn't shown ${expectPick.name} yet. Check the room.`, "warn", 5000); expectPick = null; }
    }
    render();
  }

  /* ---------------- render ---------------- */
  // Only touch the DOM when the markup actually changed: no flicker, no lost clicks, no wasted layout (v1.2).
  function setHTML(el, html) { if (el.__h === html) return false; el.innerHTML = html; el.__h = html; return true; }
  let raf = 0;
  function render() {
    if (!raf) raf = requestAnimationFrame(() => {
      raf = 0; const t0 = performance.now(); paint();
      perf.paint = performance.now() - t0; perf.maxPaint = Math.max(perf.maxPaint, perf.paint);
      host.dataset.perf = `compute ${perf.compute.toFixed(1)} (max ${perf.maxCompute.toFixed(0)}) ms · paint ${perf.paint.toFixed(1)} (max ${perf.maxPaint.toFixed(0)}) ms`;
    });
  }
  function paint() {
    if (!draftId) { wr.hidden = true; return; }
    wr.hidden = false;
    const collapsed = S.collapsed && !tempExpand;
    wr.classList.toggle("collapsed", collapsed);
    wr.classList.toggle("me", !!(st && st.isMyTurn));
    wr.dataset.dock = S.dock;
    wr.style.setProperty("--w", WIDTH[S.size] + "px");
    root.querySelectorAll('[data-act="mode"]').forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === S.mode)));
    root.querySelectorAll('[data-act="tab"]').forEach((b) => b.setAttribute("aria-selected", String(b.dataset.v === S.tab)));
    applyPush(collapsed);
    applyGeometry(collapsed);
    paintHeader(); paintBanner(); paintRail();
    if (collapsed) return;
    paintTake();
    const planTab = root.querySelector('[data-act="tab"][data-v="plan"]');
    setHTML(planTab, st && st.picksUntilMine != null ? `Plan<span class="n">${st.isMyTurn ? "now" : st.picksUntilMine}</span>` : "Plan");
    $("#tb").hidden = S.tab !== "board";
    if (S.tab === "board") paintChips();
    const main = $("#main"), y = main.scrollTop;
    if (setHTML(main, ({ board: boardHTML, team: teamHTML, plan: planHTML, room: roomHTML, feed: feedHTML }[S.tab] || boardHTML)())) main.scrollTop = y;
  }
  function paintHeader() {
    const age = Date.now() - lastOk;
    $("#dot").className = err ? "err" : age < 4000 ? "live" : age < 15000 ? "stale" : "";
    let sub = "Connecting to the draft…";
    if (st && draft) sub = `Slot ${st.mySlot || "?"} · ${MODE_LABEL[S.mode]} ranks`;
    if (err) sub = "Can't reach Sleeper. Retrying.";
    $("#hsub").textContent = sub;
  }
  function clockText() {
    if (!st || !st.deadline) return "";
    const s = Math.max(0, Math.round((st.deadline - Date.now()) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }
  function paintBanner() {
    const bn = $("#bn");
    if (!st) { bn.className = "bn"; setHTML(bn, `<div class="big">Loading the draft…</div>`); return; }
    if (err && !draft) { bn.className = "bn err"; setHTML(bn, `<div class="big">Can't reach Sleeper</div><div class="sub">${esc(err)}</div>`); return; }
    if (st.status === "pre_draft") {
      const ms = (st.startTime || 0) - Date.now();
      const when = st.startTime ? new Date(st.startTime).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }) : "time not set";
      const left = ms > 0 ? `${Math.floor(ms / 3.6e6)}h ${Math.floor((ms % 3.6e6) / 6e4)}m` : "soon";
      bn.className = "bn";
      setHTML(bn, `<div class="big">Draft starts ${esc(when)}</div><div class="t">${left}</div><div class="sub">Your picks: ${st.myPickList.slice(0, 6).join(", ")}…</div>`);
      return;
    }
    if (st.done) { bn.className = "bn"; setHTML(bn, `<div class="big">Draft complete</div><div class="sub">Team has your grades and the final power ranking</div>`); return; }
    if (st.isMyTurn) {
      bn.className = "bn me";
      setHTML(bn, `<div class="big">You're on the clock</div><div class="t" id="clk">${clockText()}</div><div class="sub">Pick ${st.current} · round ${Math.ceil(st.current / st.teams)}${st.afterMine ? ` · then #${st.afterMine}` : ""}</div>`);
      return;
    }
    bn.className = "bn" + (st.picksUntilMine != null && st.picksUntilMine <= 2 ? " soon" : "");
    setHTML(bn, `<div class="big">Your pick #${st.nextMine || "–"} is ${st.picksUntilMine == null ? "–" : st.picksUntilMine} away</div><div class="t" id="clk">${clockText()}</div><div class="sub">On the clock: ${esc(slotName(st.onClock))} · pick ${st.current}</div>`);
  }
  function paintRail() {
    const r = root.querySelector(".rail");
    if (!st) { setHTML(r, `<div class="k">WR</div>`); return; }
    const top = st.recs[0] ? last(st.recs[0].p.n) : "";
    setHTML(r, `<span class="mark"><i class="${err ? "err" : "live"}"></i></span><div class="k">${st.isMyTurn ? "Now" : "You in"}</div><div class="n">${st.isMyTurn ? "●" : st.picksUntilMine == null ? "–" : st.picksUntilMine}</div><div class="t" id="clk2">${clockText()}</div><div class="p">${esc(top)}</div>`);
  }
  function paintTake() {
    const el = $("#take");
    if (!st || !st.recs.length || st.done) { setHTML(el, ""); el.hidden = true; return; }
    el.hidden = false;
    setHTML(el, `<div class="lbl">${st.isMyTurn ? "Take now" : `Plan for pick #${st.nextMine}`}</div>` + st.recs.map((r, i) => {
      const p = r.p;
      if (i === 0) {
        const odds = !st.isMyTurn ? ` · ${pc(r.pNext)} he's there at #${st.nextMine}` : "";
        return `<div class="rec"><div class="nm">${posDot(p)} ${esc(p.n)} <span class="sub">${esc(p.p.join("/"))} · ${f1(r.now)}</span>${tags(p)}</div>
          <div class="acts">${queueBtn(p)}${draftBtn(p)}</div><div class="why">${esc(r.why || "")}${odds}</div></div>`;
      }
      return `<div class="rec alt"><div class="nm">${posDot(p)} ${esc(p.n)} <span class="sub">${f1(r.now)} · ${esc(r.why || "")}</span></div><div class="acts">${queueBtn(p)}</div></div>`;
    }).join(""));
  }
  function paintChips() {
    setHTML($("#chips"), `<button class="chip" data-act="fitSort" aria-pressed="${S.fitSort}" title="Sort by what each player adds to your lineup, counting which slots he can fill">For my team</button>` +
      ["ALL", "PG", "SG", "SF", "PF", "C"].map((x) => `<button class="chip" data-act="pos" data-v="${x}" aria-pressed="${S.pos === x}">${x === "ALL" ? "All" : x}</button>`).join("") +
      `<button class="chip" data-act="fits" aria-pressed="${S.fits}" title="Only players who fill an open starting slot">Fits need</button>` +
      `<button class="chip" data-act="showHidden" aria-pressed="${S.showHidden}">Hidden</button>`);
  }

  function boardHTML() {
    if (!st) return `<div class="empty">Loading…</div>`;
    const q = E.norm($("#q").value);
    const hidden = new Set(S.hidden.map(String)), starred = new Set(S.starred.map(String));
    const useFit = S.fitSort && st.myRoster.length > 0;
    let list = (useFit ? st.fitAvail : st.avail).filter((p) => (S.showHidden ? hidden.has(String(p.id)) : !hidden.has(String(p.id))));
    if (S.pos !== "ALL") list = list.filter((p) => p.p.includes(S.pos));
    if (q) list = list.filter((p) => E.norm(p.n).includes(q) || E.norm(p.t) === q);
    if (S.fits && st.needs.length) list = list.filter((p) => st.needs.some((slot) => D.league.slot_ok[slot].some((x) => p.p.includes(x))));
    if (!list.length) return `<div class="empty">${S.showHidden ? "No hidden players." : "No players match that filter."}</div>`;
    const rows = list.slice(0, showN).map((p) => {
      const id = String(p.id), open = expanded.has(id), s = p.s || [0, 0, 0, 0, 0, 0, 0, 0, 0];
      const parts = [["Pts", s[0] * 0.5 + s[6] * 0.5, "#FFAB0E"], ["Reb", s[1], "#00D7FF"], ["Ast", s[2], "#28E757"], ["Stl+Blk", (s[3] + s[4]) * 2, "#C96CFF"]];
      const tot = parts.reduce((a, x) => a + x[1], 0) || 1;
      const second = S.mode === "lock" ? `<span title="FPPG, and game-to-game swing: a bigger swing means more big games worth locking">${f1(p.f)} FPPG · ±${Math.round((p.cv || 0) * 100)}%</span>` : S.mode === "floor" ? `${f1(p.f)} FPPG · plays ${pc(p.a)}` : `${f1(p.lv)} lock value`;
      return `<div class="row ${starred.has(id) ? "starred" : ""}">
        <span class="tier" style="background:${TIER_COLORS[Math.min(9, (p.tier || 10) - 1)]}" title="Tier ${p.tier}"></span>
        <span class="rk">${rankMap.get(p)}</span>
        <div class="who"><div class="nm" data-act="expand" data-id="${id}">${esc(p.n)}${tags(p)}</div>
          <div class="meta">${posDot(p)}${esc(p.p.join(", "))} · ${esc(p.t)} · ADP ${Math.round(p.adp)} · <span title="Starting slots he can fill out of 9">${slotCount(p)} slots</span></div></div>
        <div class="acts">${queueBtn(p)}${draftBtn(p)}</div>
        <div class="nums"><span class="v" title="${useFit ? "What he adds to your lineup" : MODE_LABEL[S.mode] + " value"}">${f1(useFit ? p._fit : score(p))}</span><span>${useFit && Math.abs(p._fit - score(p)) > 0.05 ? `${MODE_LABEL[S.mode]} ${f1(score(p))} · ` : ""}${second}</span>${oddsPill(p)}<span class="sp"></span><button class="ib" data-act="star" data-id="${id}" title="Target">${starred.has(id) ? "★" : "☆"}</button><button class="ib" data-act="hide" data-id="${id}" title="${hidden.has(id) ? "Unhide" : "Hide (won't draft)"}">${hidden.has(id) ? "↺" : "✕"}</button></div>
        ${open ? `<div class="detail">${p.note ? `<span>${esc(p.note)}</span>` : ""}
          <span>${f1(s[0])} pts · ${f1(s[1])} reb · ${f1(s[2])} ast · ${f1(s[3])} stl · ${f1(s[4])} blk · ${f1(s[5])} TO</span>
          <div class="mini">${parts.map((x) => `<i style="width:${(x[1] / tot) * 100}%;background:${x[2]}" title="${x[0]} ${f1(x[1])}"></i>`).join("")}</div>
          <span>${parts.map((x) => `${x[0]} ${Math.round((x[1] / tot) * 100)}%`).join(" · ")} · ${p.pg || "–"} games in playoff weeks</span></div>` : ""}
      </div>`;
    }).join("");
    return rows + (list.length > showN ? `<button class="more" data-act="more">Show ${Math.min(40, list.length - showN)} more</button>` : "");
  }

  function teamHTML() {
    if (!st || !st.mySlot) return `<div class="empty">Waiting to learn your draft slot. Set it in ⚙ if this is a mock.</div>`;
    const keys = ["PG", "SG", "G", "SF", "PF", "F", "C", "UTIL7", "UTIL8"], labels = { UTIL7: "UTIL", UTIL8: "UTIL" };
    const lineup = keys.map((k) => { const p = st.lineup[k]; return `<div class="slot ${p ? "" : "need"}"><b>${labels[k] || k}</b><span>${p ? esc(last(p.n)) : "Open"}</span></div>`; }).join("");
    const bench = st.bench.length ? `<div class="hint">Bench: ${st.bench.map((p) => `${esc(p.n)} (${slotCount(p)} slots)`).join(", ")}</div>` : "";
    const co = st.myRoster.filter(isCOnlyP).length, cv = st.coverage || { G: 0, F: 0, C: 0 };
    const cover = st.myRoster.length ? `<div class="hint">Can play guard: ${cv.G} · forward: ${cv.F} · center: ${cv.C}${co ? ` · center-only: ${co}${co >= 3 ? " (max useful is 3: C + 2 UTIL)" : ""}` : ""}. Bench players only help Lock-In when they can rotate into open slots, so flexible bench picks beat a 4th big.</div>` : "";
    const mine = st.myLog.map((e) => `<div class="pk"><span class="r">${e.round}.${((e.pick_no - 1) % st.teams) + 1}</span><span>${esc(e.name)}</span><span class="g ${e.grade}">${e.gradeLabel} ${pc(Math.min(1, e.pct))}</span>
      ${e.pct < 0.995 && e.alts.length ? `<span class="alt">Could've had ${e.alts.map((a) => `${esc(a.n)} (${f1(a.s)})`).join(" or ")}</span>` : ""}</div>`).join("") || `<div class="hint">No picks yet.</div>`;
    const prof = st.profiles[st.mySlot] || {}, avg = st.lgAvg;
    const diffs = Object.keys(prof).map((k) => [k, (prof[k] || 0) - (avg[k] || 0)]);
    const mx = Math.max(0.5, ...diffs.map((d) => Math.abs(d[1])));
    const mix = st.myRoster.length ? diffs.map(([k, d]) => { const w = (Math.abs(d) / mx) * 50; return `<div class="db"><span>${k}</span><div class="ax"><div class="sg" style="left:${d >= 0 ? 50 : 50 - w}%;width:${w}%;background:${d >= 0 ? "var(--accent2)" : "var(--neg)"}"></div></div><span class="d">${d >= 0 ? "+" : "−"}${f1(Math.abs(d))}</span></div>`; }).join("") : `<div class="hint">Shows after your first pick.</div>`;
    const pmax = Math.max(1, ...st.power.map((x) => x.total));
    const power = st.power.map((x, i) => `<div class="pw ${x.slot === st.mySlot ? "me" : ""}"><span title="${x.n} players">${i + 1}. ${esc(slotName(x.slot))}</span><div class="bar"><i style="width:${(x.total / pmax) * 100}%"></i></div><span>${Math.round(x.total)}</span></div>`).join("");
    return `<div class="blk"><div class="sec">Lineup${st.needs.length ? ` · open: ${st.needs.join(", ")}` : ""}</div><div class="lineup">${lineup}</div>${bench}${cover}</div>
      <div class="blk"><div class="sec">Your picks, graded</div>${mine}</div>
      <div class="blk"><div class="sec">Where your points come from</div>${mix}<div class="hint">Fantasy points per player per game vs the room average. Rebounds and assists pay 1, steals and blocks 2, points 0.5.</div></div>
      <div class="blk"><div class="sec">Power ranking</div>${power}<div class="hint">Lock value of each team's best 9 plus a quarter of its bench.</div></div>`;
  }

  function planHTML() {
    if (!st) return `<div class="empty">Loading…</div>`;
    const out = [];
    if (st.nextMine) {
      const head = st.isMyTurn ? `On the clock at #${st.current}${st.afterMine ? `, then #${st.afterMine}` : ""}` : `Next pick #${st.nextMine}, ${st.picksUntilMine} away${st.afterMine ? ` · then #${st.afterMine}` : ""}`;
      const win = (D.plan || []).find((w) => w.picks.includes(st.nextMine)) || (D.plan || []).find((w) => w.picks[0] >= st.nextMine);
      out.push(`<div class="blk"><div class="sec">${head}</div>${win ? `<div class="note">${esc(win.text)}</div>` : ""}</div>`);
      const target = st.isMyTurn ? st.horizon : st.nextMine;
      const before = st.room.filter((r) => r.beforeMe);
      const mix = before.length ? `${before.filter((r) => r.label === "Sharp").length} sharp, ${before.filter((r) => r.label === "Mixed").length} mixed, ${before.filter((r) => r.label === "ADP-driven").length} ADP-driven pick before you` : "";
      const tops = (st.myRoster.length ? st.fitAvail : st.avail).slice(0, 10).map((p) => `<div class="qrow"><span>${posDot(p)} ${esc(p.n)} <span class="sub">${f1(st.myRoster.length ? p._fit : score(p))}</span>${tags(p)}</span>${oddsPill(p)}${queueBtn(p)}</div>`).join("");
      out.push(`<div class="blk"><div class="sec">Will they last to #${target || "–"}?</div>${tops}<div class="hint">${mix ? mix + ". " : ""}Odds come from simulating each upcoming pick with that manager's learned sharpness.</div></div>`);
      const stars = S.starred.map(playerById).filter((p) => p && st.avail.includes(p));
      if (stars.length) out.push(`<div class="blk"><div class="sec">Your targets</div>${stars.map((p) => `<div class="qrow"><span>★ ${esc(p.n)} <span class="sub">${f1(score(p))}</span></span>${oddsPill(p)}${queueBtn(p)}</div>`).join("")}</div>`);
    }
    const alerts = st.alerts.slice();
    if (autopick) alerts.unshift({ kind: "warn", text: "Auto-pick is on in Sleeper. If your timer runs out it drafts from your queue." });
    const fadesQ = [...sqIds].map(playerById).filter((p) => p && eng.isFade(p));
    if (fadesQ.length) alerts.push({ kind: "warn", text: `Fades in your Sleeper queue: ${fadesQ.map((p) => p.n).join(", ")}` });
    out.push(`<div class="blk"><div class="sec">Alerts</div>${alerts.length ? alerts.map((a) => `<div class="alert ${a.kind}">${esc(a.text)}</div>`).join("") : `<div class="hint">Nothing unusual right now.</div>`}</div>`);
    const qp = sq.names.map((nm) => ({ nm, p: eng.findByName(nm) || [...sqIds].map(playerById).find((x) => x && E.norm(last(x.n)) === E.norm(last(nm))) }));
    const qrows = qp.length ? qp.map(({ nm, p }) => `<div class="qrow"><span>${esc(p ? p.n : nm)} ${p ? `<span class="sub">#${rankMap.get(p)} · ${f1(score(p))}</span>${eng.isFade(p) ? `<span class="tag fade">Fade</span>` : ""}` : ""}</span><span></span>${p ? `<button class="b ghost" data-act="unqueue" data-id="${p.id}">Remove</button>` : ""}</div>`).join("") :
      `<div class="hint">${sq.visible ? "Your Sleeper queue is empty." : "Open the Queue tab in Sleeper to see your queue here."}</div>`;
    out.push(`<div class="blk"><div class="sec">Sleeper queue · auto-pick uses this</div>${qrows}<div class="acts"><button class="b" data-act="queueTop">Queue my top 6</button>${fadesQ.length ? `<button class="b ghost" data-act="dropFades">Remove fades</button>` : ""}</div></div>`);
    return out.join("");
  }

  function roomHTML() {
    if (!st) return `<div class="empty">Loading…</div>`;
    const rows = st.room.map((r, i) => {
      const cls = r.label === "Sharp" ? "sharp" : r.label === "ADP-driven" ? "adp" : "";
      const nxt = r.me ? "" : r.beforeMe ? `<span class="soonchip">picks #${r.nextPick}</span>` : r.nextPick ? `<span>next #${r.nextPick}</span>` : "";
      return `<div class="mgr ${r.me ? "me" : ""}"><span class="rk">${i + 1}</span><span class="nm">${esc(slotName(r.slot))}</span>
        <div class="meter ${cls}" title="Sharpness ${Math.round(r.s * 100)} ± ${Math.round(r.sd * 100)}"><i style="width:${Math.round(r.s * 100)}%"></i></div><span class="sc">${Math.round(r.s * 100)}</span>
        <div class="ln"><span class="lab ${r.label}">${r.label}</span>${r.n ? `<span>${pc(r.captured)} value captured</span><span>${r.reaches} reach${r.reaches === 1 ? "" : "es"}</span><span>${r.steals} steal${r.steals === 1 ? "" : "s"}</span>` : `<span>no picks yet</span>`}${nxt}</div></div>`;
    }).join("");
    return `<div class="blk"><div class="sec">Room sharpness</div><div class="hint">0 means a manager drafts straight off Sleeper's ADP; 100 means he drafts by points-league value. It starts at a cash-league assumption (65) and updates after every pick. One bad pick barely moves it; a pattern does.</div></div>${rows}`;
  }

  function feedHTML() {
    if (!st) return `<div class="empty">Loading…</div>`;
    let log = st.log.slice().reverse();
    if (feedFilter === "mine") log = log.filter((e) => e.mine);
    if (feedFilter === "steals") log = log.filter((e) => e.pct >= 0.97);
    if (feedFilter === "reach") log = log.filter((e) => e.grade === "reach");
    const chips = ["all", "mine", "steals", "reach"].map((f) => `<button class="chip" data-act="feed" data-v="${f}" aria-pressed="${feedFilter === f}">${{ all: "All", mine: "Mine", steals: "Steals", reach: "Reaches" }[f]}</button>`).join("");
    const rows = log.slice(0, 80).map((e) => `<div class="feed ${e.mine ? "mine" : ""}"><span class="r">${e.round}.${((e.pick_no - 1) % st.teams) + 1}</span><span>${esc(e.name)} <span class="sub">${esc((e.pos || []).join(", "))}</span></span><span class="g ${e.grade}">${e.gradeLabel}</span>
      <span class="m">${esc(slotName(e.slot))} · pick ${e.pick_no} · ${pc(Math.min(1, e.pct))} of best${e.pct < 0.95 && e.alts[0] ? ` · could've had ${esc(e.alts[0].n)}` : ""}</span></div>`).join("");
    return `<div class="tb"><div class="chips">${chips}</div></div>${rows || `<div class="empty">No picks yet.</div>`}`;
  }

  function paintSettings() {
    const el = $("#set");
    const slots = Array.from({ length: (st && st.teams) || 10 }, (_, i) => i + 1);
    el.innerHTML = `<div class="sec">Settings</div>
      <label class="ck"><input type="checkbox" id="autoConfirm" ${S.autoConfirm ? "checked" : ""}> Click Sleeper's confirm popup after I confirm here</label>
      <label class="ck"><input type="checkbox" id="sound" ${S.sound ? "checked" : ""}> Beep when I'm one pick away and on the clock</label>
      <label class="ck"><input type="checkbox" id="autoExpand" ${S.autoExpand ? "checked" : ""}> Open the panel when I'm on the clock</label>
      <label class="ck"><input type="checkbox" id="push" ${S.push ? "checked" : ""}> Make room: shrink Sleeper so the panel covers nothing</label>
      <label>Panel width <select id="size">${["compact", "normal", "wide"].map((s) => `<option value="${s}" ${S.size === s ? "selected" : ""}>${s[0].toUpperCase() + s.slice(1)}</option>`).join("")}</select></label>
      <label>Position <select id="dock"><option value="side" ${S.dock === "side" ? "selected" : ""}>On Sleeper's queue column (grows when you're up)</option><option value="right" ${S.dock === "right" ? "selected" : ""}>Right, full height</option><option value="left" ${S.dock === "left" ? "selected" : ""}>Left, full height</option></select></label>
      <label>My draft slot <select id="slot"><option value="0">Detect from my Sleeper login</option>${slots.map((s) => `<option value="${s}" ${+S.slot === s ? "selected" : ""}>${s}</option>`).join("")}</select></label>
      <div class="acts"><button class="b ghost" data-act="clearStars">Clear targets</button><button class="b ghost" data-act="clearHidden">Clear hidden</button><button class="b pri" data-act="settings">Done</button></div>
      <span class="hint">Room sharpness is learned from each pick, no setting needed. Rankings built ${esc(D.built)}; projections, ADP and injuries refresh from Sleeper every 5 minutes${lastProj ? ` (last at ${new Date(lastProj).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })})` : ""}.</span>`;
    el.querySelectorAll("input,select").forEach((inp) => inp.addEventListener("change", () => {
      if (inp.type === "checkbox") S[inp.id] = inp.checked; else if (inp.id === "slot") S.slot = +inp.value; else S[inp.id] = inp.value;
      store.save(); recompute();
    }));
  }

  /* Blend with whichever room is open: classic tokens or the beta draftboard's DLS tokens, top edge just under Sleeper's
     header, and in "side" dock sit exactly on Sleeper's Queue/Roster/Chat column, growing to full height near your pick. */
  let theme = "classic";
  const isTall = () => S.tall || !!(st && (st.isMyTurn || (st.picksUntilMine != null && st.picksUntilMine <= 2)));
  function applyGeometry(collapsed) {
    const lay = B.layout();
    if (lay === "classic" || lay === "beta") theme = lay;
    wr.dataset.theme = theme;
    const hdr = document.querySelector(".draft-header");
    const hb = hdr ? Math.round(hdr.getBoundingClientRect().bottom) : 0;
    const top = hb > 20 && hb < 200 ? hb + 8 : 64;
    wr.style.setProperty("--top", top + "px");
    const side = S.dock === "side" && !collapsed && !S.push ? document.querySelector(".right-panel-wrapper") : null;
    const r = side && side.getBoundingClientRect();
    const ok = !!(r && r.width >= 280 && r.height >= 200);
    wr.classList.toggle("anchored", ok);
    if (ok) {
      const tall = isTall();
      wr.classList.toggle("short", !tall);
      wr.style.left = Math.round(r.left) + "px";
      wr.style.width = Math.round(r.width) + "px";
      wr.style.top = (tall ? top : Math.round(r.top)) + "px";
    } else {
      wr.classList.remove("short");
      wr.style.left = wr.style.width = wr.style.top = "";
    }
    const tb = root.querySelector('[data-act="tall"]');
    if (tb) tb.setAttribute("aria-pressed", String(!!S.tall));
  }
  window.addEventListener("resize", () => render());

  let pushStyle = null;
  function applyPush(collapsed) {
    const want = S.push && !collapsed && draftId;
    if (!want) { if (pushStyle) { pushStyle.remove(); pushStyle = null; window.dispatchEvent(new Event("resize")); } return; }
    const w = WIDTH[S.size] + 24, side = S.dock === "left" ? "left" : "right";
    const css = `html{width:calc(100% - ${w}px)!important;${side === "left" ? `margin-left:${w}px!important;` : ""}}body{width:100%!important;overflow-x:hidden!important}`;
    if (!pushStyle) { pushStyle = document.createElement("style"); pushStyle.id = "wr-push"; document.head.appendChild(pushStyle); }
    if (pushStyle.textContent !== css) { pushStyle.textContent = css; window.dispatchEvent(new Event("resize")); }
  }

  /* ---------------- actions ---------------- */
  const REASONS = {
    "not-found": (n) => `Couldn't find ${n} in Sleeper's list. Use Sleeper's search.`,
    "no-button": (n) => `Sleeper isn't showing a button for ${n}.`,
    "not-your-turn": () => "Sleeper says it isn't your turn yet.",
    "not-queued": (n) => `${n} isn't in your Sleeper queue.`,
  };
  async function doDraft(p) {
    armed = null;
    toast(`Drafting ${p.n}…`);
    const res = await B.draft(p.n, { autoConfirm: S.autoConfirm });
    if (!res.ok) { toast((REASONS[res.reason] || (() => "Draft failed"))(p.n), "bad", 4500); render(); return; }
    expectPick = { pid: String(p.id), name: p.n, t: Date.now() };
    tick(true);
  }
  async function doQueue(p, quiet) {
    const res = await B.queue(p.n);
    if (!res.ok) { if (!quiet) toast((REASONS[res.reason] || (() => "Queue failed"))(p.n), "bad"); return false; }
    if (!quiet) toast(res.already ? `${p.n} is already queued` : `Queued ${p.n}`, res.already ? "" : "good", 1800);
    setTimeout(recompute, 450);
    return true;
  }
  async function doUnqueue(p) {
    const res = await B.unqueue(p.n);
    toast(res.ok ? `Removed ${p.n} from your queue` : (REASONS[res.reason] || (() => "Couldn't remove"))(p.n), res.ok ? "" : "bad", 1800);
    setTimeout(recompute, 450);
  }
  function armOrDraft(p) {
    if (!p) return;
    if (armed && armed.pid === String(p.id) && Date.now() < armed.until) return doDraft(p);
    armed = { pid: String(p.id), until: Date.now() + 2500 };
    render();
    setTimeout(() => { if (armed && Date.now() >= armed.until) { armed = null; render(); } }, 2600);
  }

  root.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-act]");
    if (!t) return;
    const act = t.dataset.act, id = t.dataset.id, v = t.dataset.v, p = id ? playerById(id) : null;
    switch (act) {
      case "collapse": S.collapsed = !(S.collapsed && !tempExpand); tempExpand = false; break;
      case "mode": S.mode = v; store.save(); recompute(); return;
      case "tall": S.tall = !S.tall; break;
      case "settings": { const s = $("#set"); s.hidden = !s.hidden; if (!s.hidden) paintSettings(); return; }
      case "tab": S.tab = v; showN = 40; break;
      case "pos": S.pos = v; break;
      case "fits": S.fits = !S.fits; break;
      case "fitSort": S.fitSort = !S.fitSort; break;
      case "showHidden": S.showHidden = !S.showHidden; break;
      case "feed": feedFilter = v; render(); return;
      case "more": showN += 40; render(); return;
      case "expand": expanded.has(id) ? expanded.delete(id) : expanded.add(id); render(); return;
      case "star": { const k = String(id); S.starred = S.starred.includes(k) ? S.starred.filter((x) => x !== k) : [...S.starred, k]; break; }
      case "hide": { const k = String(id); S.hidden = S.hidden.includes(k) ? S.hidden.filter((x) => x !== k) : [...S.hidden, k]; break; }
      case "clearStars": S.starred = []; break;
      case "clearHidden": S.hidden = []; break;
      case "draft": armOrDraft(p); return;
      case "queue": if (p) await doQueue(p); return;
      case "unqueue": if (p) await doUnqueue(p); return;
      case "queueTop": {
        const tops = st.avail.filter((x) => !S.hidden.includes(String(x.id)) && !sqIds.has(String(x.id)) && !eng.isFade(x)).slice(0, 6);
        let n = 0; for (const x of tops) { if (await doQueue(x, true)) n++; await new Promise((r) => setTimeout(r, 300)); }
        toast(`Added ${n} players to your Sleeper queue`, "good"); return;
      }
      case "dropFades": {
        const fq = [...sqIds].map(playerById).filter((x) => x && eng.isFade(x));
        for (const x of fq) { await B.unqueue(x.n); await new Promise((r) => setTimeout(r, 300)); }
        toast(`Removed ${fq.length} fades from your queue`); setTimeout(recompute, 500); return;
      }
      default: return;
    }
    store.save(); render();
  });
  $("#q").addEventListener("input", () => { showN = 40; render(); });

  window.addEventListener("keydown", (e) => {
    if (!draftId) return;
    const path = e.composedPath ? e.composedPath() : [e.target];
    const typing = path.some((n) => n && n.tagName && (/^(INPUT|TEXTAREA|SELECT)$/.test(n.tagName) || n.isContentEditable));
    if (typing) { if (e.key === "Escape" && path[0] === $("#q")) { $("#q").value = ""; $("#q").blur(); render(); } return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const top = st && st.recs[0] ? st.recs[0].p : null;
    if (e.key === "`") { S.collapsed = !(S.collapsed && !tempExpand); tempExpand = false; store.save(); render(); e.preventDefault(); }
    else if (e.key === "/") { if (S.collapsed) { S.collapsed = false; store.save(); } S.tab = "board"; render(); setTimeout(() => $("#q").focus(), 30); e.preventDefault(); }
    else if (e.key === "q" || e.key === "Q") { if (top) doQueue(top); }
    else if (e.key === "d" || e.key === "D") { if (top) armOrDraft(top); }
    else if (e.key === "Enter" && armed) { const p = playerById(armed.pid); if (p) doDraft(p); }
    else if (e.key === "Escape" && armed) { armed = null; render(); }
  }, true);

  /* ---------------- data loop ---------------- */
  function detectDraftId() { const m = location.pathname.match(/\/draft\/nba\/(\d+)/); return m ? m[1] : null; }
  async function loadUsers() {
    users = {};
    const lid = draft && (draft.league_id || (draft.metadata && draft.metadata.league_id));
    if (!lid) return;
    try { (await getJSON(`https://api.sleeper.app/v1/league/${lid}/users`)).forEach((u) => { users[u.user_id] = (u.metadata && u.metadata.team_name) || u.display_name; }); } catch (e) { /* names optional */ }
  }
  async function refreshProjections() {
    try {
      const rows = await getJSON(`https://api.sleeper.com/projections/nba/${(draft && draft.season) || "2026"}?season_type=regular`);
      eng.applyProjections(rows);
      lastProj = Date.now();
      for (const n of eng.news) toast(n, "warn", 6000);
      recompute();
    } catch (e) { /* keep baked-in numbers */ }
  }
  function schedule() {
    clearTimeout(metaTimer);
    const s = draft && draft.status;
    metaTimer = setTimeout(() => tick(false), s === "drafting" ? 700 : s === "pre_draft" ? 5000 : s === "complete" ? 20000 : 3000);
  }
  async function tick(force) {
    if (!draftId || inflight) { schedule(); return; }
    inflight = true;
    try {
      // while picks are flying, ask for the draft and its picks at the same time: one round trip instead of two (v1.2)
      const live = draft && draft.status === "drafting";
      const [d, pk] = await Promise.all([getJSON(`https://api.sleeper.app/v1/draft/${draftId}`),
        live ? getJSON(`https://api.sleeper.app/v1/draft/${draftId}/picks`) : Promise.resolve(null)]);
      const first = !draft;
      const changed = force || first || d.last_picked !== draft.last_picked || d.status !== draft.status || (pk && pk.length !== picks.length);
      draft = d;
      if (first) loadUsers().then(render);
      if (pk) { picks = pk; lastPicksAt = Date.now(); }
      else if (changed || Date.now() - lastPicksAt > 6000) { picks = await getJSON(`https://api.sleeper.app/v1/draft/${draftId}/picks`); lastPicksAt = Date.now(); }
      lastOk = Date.now(); err = null;
      recompute();
      if (Date.now() - lastProj > 5 * 60 * 1000) refreshProjections();
    } catch (e) {
      err = String((e && e.message) || e);
      if (/context invalidated/i.test(err)) err = "The extension was updated. Reload this page.";
      render();
    } finally { inflight = false; schedule(); }
  }
  let lastNudge = 0;
  const mo = new MutationObserver(() => {
    if (!draftId || !draft || draft.status !== "drafting") return;
    const now = Date.now();
    if (now - lastNudge > 250) { lastNudge = now; tick(false); }
  });
  function start(id) { draftId = id; draft = null; picks = []; st = null; err = null; lastProj = 0; mount(); render(); tick(true); mo.observe(document.body, { childList: true, subtree: true }); }
  function stop() { draftId = null; clearTimeout(metaTimer); mo.disconnect(); applyPush(true); render(); }

  setInterval(() => {
    if (!st || !draftId) return;
    const t = clockText(), a = root.getElementById("clk"), b = root.getElementById("clk2");
    if (a) a.textContent = t; if (b) b.textContent = t;
    if (st.isMyTurn && st.deadline && !beeped20 && st.deadline - Date.now() < 20000) { beeped20 = true; beep(988, 0.12, 3); }
    paintHeader();
  }, 250);
  setInterval(() => { const id = detectDraftId(); if (id !== draftId) { if (id) start(id); else stop(); } }, 1000);
  if (hasExt) chrome.runtime.onMessage.addListener((msg) => { if (msg && msg.type === "wr-toggle" && draftId) { S.collapsed = !S.collapsed; tempExpand = false; store.save(); render(); } });

  store.load().then(() => { const id = detectDraftId(); if (id) start(id); });
  window.__WR = { eng, get state() { return st; }, refresh: () => tick(true) };
})();
