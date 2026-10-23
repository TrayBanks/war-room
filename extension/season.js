/* War Room — Lock-In coach for Sleeper NBA league pages (v1.1).
   Each starter counts one game per week. After every game this says Lock or Hold, using the optimal-stopping lines in lock.js.
   Read-only: it reads Sleeper's public API and never clicks anything in your league. */
(function () {
  "use strict";
  if (window.__WR_SEASON) return;
  window.__WR_SEASON = true;

  const D = window.WR_DATA, E = window.WR_ENGINE, L = window.WR_LOCK;
  if (!D || !L) return;
  const Z = D.league.lock.z, POOL_CV = D.league.lock.pool_cv;
  window.WR_DEFAULT_Z = Z;
  const byId = new Map(D.players.map((p) => [String(p.id), p]));
  const hasExt = typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const f1 = (x) => (x == null || isNaN(x) ? "–" : (+x).toFixed(1));
  const etDate = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(d || new Date());
  const addDays = (iso, n) => new Date(Date.parse(iso + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
  const dow = (iso) => new Date(iso + "T12:00:00Z").getUTCDay();
  const mondayOf = (iso) => addDays(iso, -((dow(iso) + 6) % 7));
  const sundayOf = (iso) => addDays(mondayOf(iso), 6);
  const short = (iso) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const RISK_HELP = {
    even: "Even: maximize your expected score.",
    chase: "Chase: you're the underdog this week. Holds out for bigger games.",
    protect: "Protect: you're favored. Locks good games sooner.",
  };

  /* ---------------- settings & storage ---------------- */
  let S = { collapsed: true, risk: "even", tab: "week", bench: false };
  let LOCKS = {};
  async function loadStore() {
    try {
      if (hasExt && chrome.storage) {
        const r = await chrome.storage.local.get(["wrSeason", "wrLocks"]);
        S = { ...S, ...(r.wrSeason || {}) };
        LOCKS = r.wrLocks || {};
      }
    } catch (e) { /* defaults */ }
  }
  function save() { try { if (hasExt && chrome.storage) chrome.storage.local.set({ wrSeason: S, wrLocks: LOCKS }); } catch (e) { /* ignore */ } }

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
  let leagueId = null, league = null, rosters = null, schedule = null, proj = new Map(), stats = [], statsWeek = null;
  let T = { league: 0, rosters: 0, schedule: 0, proj: 0, stats: 0 };
  let week = null, wk = null, err = null, lastOk = 0, timer = null, busy = false, notNba = false;
  let result = null, roster = [], seenLock = new Set(), seeded = false;
  let calc = { id: "", score: "", k: "2", mu: "" };

  /* ---------------- DOM ---------------- */
  const host = document.createElement("div");
  host.id = "wr-season-host";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>${window.WR_CSS}</style>
  <div class="wr" hidden>
    <div class="rail" data-act="collapse" title="Open Lock-In ( \` )"></div>
    <div class="hd">
      <span class="mark"><i id="dot"></i></span>
      <div class="grow"><div class="ttl">Lock-In</div><div class="sub" id="hsub">Loading your league…</div></div>
      <div class="seg" role="group" aria-label="Risk">
        <button data-act="risk" data-v="even" title="${RISK_HELP.even}">Even</button>
        <button data-act="risk" data-v="chase" title="${RISK_HELP.chase}">Chase</button>
        <button data-act="risk" data-v="protect" title="${RISK_HELP.protect}">Protect</button>
      </div>
      <button class="ib" data-act="collapse" title="Hide ( \` )">›</button>
    </div>
    <div class="bn" id="bn"></div>
    <div class="tabs" role="tablist">
      <button role="tab" data-act="tab" data-v="week">This week</button>
      <button role="tab" data-act="tab" data-v="calc">Calculator</button>
    </div>
    <div class="main" id="main"></div>
    <div class="ft"><span id="upd"></span><span><kbd>\`</kbd> hide</span></div>
    <div class="toasts" id="toasts"></div>
  </div>`;
  const $ = (s) => root.querySelector(s);
  const wr = $(".wr");
  function mount() { if (!host.isConnected) document.documentElement.appendChild(host); }
  function toast(msg, kind, ms) {
    const el = document.createElement("div");
    el.className = "toast " + (kind || "");
    el.textContent = msg;
    $("#toasts").appendChild(el);
    setTimeout(() => el.remove(), ms || 3500);
  }

  /* ---------------- data ---------------- */
  const season = () => (league && league.season) || "2026";
  const lockKey = () => `${leagueId}|${season()}|${week}`;
  const lockedSet = () => new Set(LOCKS[lockKey()] || []);

  function weekRanges(games) {
    const r = {};
    for (const g of games) { const w = (r[g.week] = r[g.week] || { min: g.date, max: g.date }); if (g.date < w.min) w.min = g.date; if (g.date > w.max) w.max = g.date; }
    for (const k of Object.keys(r)) { r[k].start = mondayOf(r[k].min); r[k].end = sundayOf(r[k].max); }
    return r;
  }
  function pickWeek(games, today) {
    const r = weekRanges(games), weeks = Object.keys(r).map(Number).sort((a, b) => a - b);
    for (const w of weeks) if (today <= r[w].end) return { week: w, ...r[w] };
    const w = weeks[weeks.length - 1];
    return w ? { week: w, ...r[w] } : null;
  }
  function buildRoster() {
    const mine = (rosters || []).find((r) => r.owner_id === userId || (r.co_owners || []).includes(userId));
    if (!mine) return null;
    const starters = new Set((mine.starters || []).map(String));
    const ids = [...new Set([...(mine.starters || []), ...(mine.players || [])].map(String))].filter((id) => id && id !== "0");
    const teamFromStats = (id) => { let t = ""; for (const x of stats) if (x.player_id === id && x.team) t = x.team; return t; };   // this week's actual team wins (trades)
    return ids.map((id) => {
      const p = byId.get(id), pr = proj.get(id), pl = (pr && pr.player) || {};
      const fp = pr && pr.stats && pr.stats.pts ? E.scoreFppg(pr.stats, D.league.scoring) : null;
      return {
        id, n: p ? p.n : pl.first_name ? `${pl.first_name} ${pl.last_name}` : `Player ${id}`,
        pos: p ? p.p : pl.fantasy_positions || [], team: teamFromStats(id) || (pr && pr.team) || pl.team || (p && p.t) || "",
        mu: fp || (p ? p.f : 15), cv: p && p.cv ? p.cv : POOL_CV, rest: p && p.rest != null ? p.rest : 0.1,
        inj: pl.injury_status || (p && p.inj) || "", starter: starters.has(id), known: !!p,
      };
    });
  }
  function analyze() {
    if (!schedule || !wk) return;
    const today = etDate();
    const games = schedule.filter((g) => g.week === week).map((g) => ({ date: g.date, status: g.status, home: g.home && g.home.team, away: g.away && g.away.team }));
    roster = buildRoster() || [];
    result = L.analyzeWeek({ roster, schedule: games, stats: statsWeek === week ? stats : [], today, locks: lockedSet(), risk: S.risk, z: Z });
    result.games = games;
    result.today = today;
    for (const r of result.rows) {
      const key = `${week}|${r.id}|${r.latestDay}`;
      if (r.starter && r.verdict === "lock" && !seenLock.has(key)) {
        if (seeded) toast(`Lock ${r.n}: ${f1(r.latest)}`, "good", 6000);
        seenLock.add(key);
      }
    }
    seeded = true;
  }
  async function load() {
    const now = Date.now();
    if (!league || now - T.league > 30 * 60e3) {
      league = await getJSON(`https://api.sleeper.app/v1/league/${leagueId}`);
      T.league = now;
      notNba = league && league.sport && league.sport !== "nba";
      if (notNba) return;
    }
    const today = etDate();
    const gamesToday = schedule ? schedule.filter((g) => g.date === today) : [];
    const hot = gamesToday.some((g) => g.status === "in_game") || (gamesToday.length && gamesToday.some((g) => g.status !== "complete"));
    const jobs = [];
    if (!rosters || now - T.rosters > 5 * 60e3) jobs.push(getJSON(`https://api.sleeper.app/v1/league/${leagueId}/rosters`).then((r) => { rosters = r; T.rosters = now; }));
    if (!schedule || now - T.schedule > (hot ? 60e3 : 15 * 60e3)) jobs.push(getJSON(`https://api.sleeper.com/schedule/nba/regular/${season()}`).then((r) => { if (Array.isArray(r)) { schedule = r; T.schedule = now; } }));
    if (!proj.size || now - T.proj > 30 * 60e3) jobs.push(getJSON(`https://api.sleeper.com/projections/nba/${season()}?season_type=regular`).then((rows) => {
      if (Array.isArray(rows)) { proj = new Map(rows.map((r) => [String(r.player_id), r])); T.proj = now; }
    }).catch(() => { /* projections optional */ }));
    await Promise.all(jobs);
    wk = schedule ? pickWeek(schedule, today) : null;
    week = wk ? wk.week : null;
    const started = wk && today >= wk.min;
    if (started && (statsWeek !== week || now - T.stats > (hot ? 55e3 : 10 * 60e3))) {
      const rows = await getJSON(`https://api.sleeper.com/stats/nba/${season()}/${week}?season_type=regular`);
      stats = (Array.isArray(rows) ? rows : []).filter((r) => r && r.date).map((r) => {
        const s = r.stats || {};
        const sp = s.sp != null ? +s.sp : (s.pts || s.reb || s.ast || s.min) ? 1 : 0;
        return { player_id: String(r.player_id), date: r.date, team: r.team, pts_std: s.pts_std != null ? +s.pts_std : E.scoreFppg(s, D.league.scoring), sp };
      });
      statsWeek = week; T.stats = now;
    }
    analyze();
  }
  async function tick() {
    if (!leagueId || busy) return;
    busy = true;
    try { await load(); err = null; lastOk = Date.now(); }
    catch (e) { err = String((e && e.message) || e); if (/context invalidated/i.test(err)) err = "The extension was updated. Reload this page."; }
    finally { busy = false; render(); schedulePoll(); }
  }
  function schedulePoll() {
    clearTimeout(timer);
    const today = etDate();
    const live = schedule && schedule.some((g) => g.date === today && g.status === "in_game");
    const later = schedule && schedule.some((g) => g.date === today && g.status !== "complete");
    timer = setTimeout(tick, live ? 60e3 : later ? 120e3 : 300e3);
  }

  /* ---------------- render ---------------- */
  let raf = 0;
  function render() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; paint(); }); }
  const posDot = (pos) => `<span class="dot ${esc((pos || ["?"])[0])}"></span>`;
  const VD = { lock: "Lock", hold: "Hold", wait: "Wait", final: "Final", none: "No games", locked: "Locked", live: "Live", pending: "Final soon" };

  function paint() {
    if (!leagueId || notNba) { wr.hidden = true; return; }
    wr.hidden = false;
    wr.classList.toggle("collapsed", !!S.collapsed);
    placePanel();
    const nLock = result ? result.summary.lock : 0;
    wr.classList.toggle("me", nLock > 0);
    root.querySelectorAll('[data-act="risk"]').forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === S.risk)));
    root.querySelectorAll('[data-act="tab"]').forEach((b) => b.setAttribute("aria-selected", String(b.dataset.v === S.tab)));
    const age = Date.now() - lastOk;
    $("#dot").className = err ? "err" : age < 150e3 ? "live" : age < 600e3 ? "stale" : "";
    $("#hsub").textContent = err ? "Can't reach Sleeper. Retrying." : wk ? `Week ${week} · ${short(wk.start)} – ${short(wk.end)}` : "Loading your league…";
    $("#upd").textContent = lastOk ? `Updated ${new Date(lastOk).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "";
    paintRail(nLock);
    if (S.collapsed) return;
    paintBanner();
    const main = $("#main"), y = main.scrollTop;
    main.innerHTML = S.tab === "calc" ? calcHTML() : weekHTML();
    main.scrollTop = y;
    if (S.tab === "calc") wireCalc();
  }
  /* Sit exactly on the league page's right column (chat), same width, top and 16px corners; Sleeper's chat is one ` away. */
  function placePanel() {
    wr.dataset.theme = "classic";
    wr.classList.add("lg");
    const rp = !S.collapsed ? document.querySelector(".right-panel") : null;
    const r = rp && rp.getBoundingClientRect();
    const ok = !!(r && r.width >= 300 && r.height >= 300);
    wr.classList.toggle("anchored", ok);
    const panel = document.querySelector(".center-panel, .right-panel");
    const top = panel ? Math.round(panel.getBoundingClientRect().top) : 100;
    wr.style.setProperty("--top", (top > 20 && top < 220 ? top : 100) + "px");
    if (ok) {
      wr.style.left = Math.round(r.left) + "px"; wr.style.width = Math.round(r.width) + "px";
      wr.style.top = Math.round(r.top) + "px"; wr.style.bottom = Math.max(0, Math.round(innerHeight - r.bottom)) + "px";
    } else wr.style.left = wr.style.width = wr.style.top = wr.style.bottom = "";
  }
  window.addEventListener("resize", () => render());

  function paintRail(nLock) {
    const r = root.querySelector(".rail");
    if (!result) { r.innerHTML = `<span class="mark"><i class="${err ? "err" : "live"}"></i></span><div class="k">Lock</div>`; return; }
    const top = result.rows.find((x) => x.starter && x.verdict === "lock");
    r.innerHTML = `<span class="mark"><i class="${err ? "err" : "live"}"></i></span><div class="k">Lock now</div><div class="n">${nLock}</div><div class="k">Wk ${week || "–"}</div>${top ? `<div class="p">${esc(top.n.split(" ").slice(-1)[0])}</div>` : ""}`;
  }
  function paintBanner() {
    const bn = $("#bn");
    if (err && !result) { bn.className = "bn err"; bn.innerHTML = `<div class="big">Can't reach Sleeper</div><div class="sub">${esc(err)}</div>`; return; }
    if (!result) { bn.className = "bn"; bn.innerHTML = `<div class="big">Loading this week…</div>`; return; }
    if (!roster.length) { bn.className = "bn err"; bn.innerHTML = `<div class="big">Can't find your team</div><div class="sub">Log in to Sleeper as the owner of a team in this league, then reload.</div>`; return; }
    const s = result.summary, today = result.today;
    const tonight = result.rows.filter((r) => r.starter && r.timeline.some((g) => g.date === today && !g.played && !g.dnp));
    const preseason = wk && today < wk.min;
    if (s.lock) {
      bn.className = "bn me";
      const names = result.rows.filter((r) => r.starter && r.verdict === "lock").map((r) => `${r.n.split(" ").slice(-1)[0]} ${f1(r.latest)}`);
      bn.innerHTML = `<div class="big">Lock ${s.lock} game${s.lock > 1 ? "s" : ""} before tip-off</div><div class="sub">${esc(names.join(" · "))}</div>`;
      return;
    }
    bn.className = "bn";
    const big = preseason ? `Week ${week} starts ${new Date(wk.min + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })}` :
      s.live ? `${s.live} starter${s.live > 1 ? "s" : ""} playing now` : s.pending ? "Waiting on final stats" : tonight.length ? `${tonight.length} starter${tonight.length > 1 ? "s" : ""} play today` : "Nothing to lock right now";
    const sub = preseason ? "Your lock lines for the week are below. A score at or above the line is worth locking." :
      tonight.length ? `Today: ${tonight.map((r) => r.n.split(" ").slice(-1)[0]).join(", ")}` : `${s.hold} holding · ${s.wait} waiting · ${s.final + s.locked} done`;
    bn.innerHTML = `<div class="big">${esc(big)}</div><div class="sub">${esc(sub)}</div>`;
  }
  function gameChip(g, r) {
    const counts = r.latest != null && r.timeline.filter((x) => x.played).slice(-1)[0] === g;
    const cls = g.live ? "live" : g.pending ? "live" : g.dnp ? "dnp" : g.played ? (counts ? "best" : "played") : "";
    const val = g.live ? "live" : g.pending ? "final…" : g.dnp ? "DNP" : g.played ? f1(g.score) : "";
    return `<span class="gm ${cls}" title="${esc(g.date)}">${esc(g.day)}${val ? " " + val : ""}</span>`;
  }
  function lineText(r) {
    if (!["hold", "wait", "lock"].includes(r.verdict) || !r.lines) return "";
    const k = r.verdict === "wait" ? r.k - 1 : r.k;
    const parts = [];
    for (let j = Math.min(k, 4); j >= 1; j--) parts.push(`${f1(r.lines[j - 1])} with ${j} game${j > 1 ? "s" : ""} left`);
    return parts.length ? `<div class="txt sub">Lock line${parts.length > 1 ? "s" : ""}: ${parts.join(" · ")}</div>` : "";
  }
  function cardHTML(r) {
    const locked = r.verdict === "locked";
    const canMark = r.starter && (r.latest != null || locked);
    if (!r.starter) return `<div class="lk">
      <div class="nm">${posDot(r.pos)}<span>${esc(r.n)}</span><span class="sub">${esc(roster.find((x) => x.id === r.id)?.team || "")}</span></div>
      <span class="vd">Bench</span>
      <div class="tl">${r.timeline.length ? r.timeline.map((g) => gameChip(g, r)).join("") : `<span class="gm dnp">No games</span>`}</div>
      <div class="txt">${r.k ? `${r.k} game${r.k > 1 ? "s" : ""} left. Only games he starts can be locked.` : "No games left this week."}</div>
    </div>`;
    return `<div class="lk">
      <div class="nm">${posDot(r.pos)}<span>${esc(r.n)}</span><span class="sub">${esc(roster.find((x) => x.id === r.id)?.team || "")}</span>${(() => { const inj = roster.find((x) => x.id === r.id)?.inj || ""; return inj === "Out" ? `<span class="tag inj">Out</span>` : inj ? `<span class="tag dtd">${esc(inj)}</span>` : ""; })()}</div>
      <span class="vd ${r.verdict}">${VD[r.verdict] || r.verdict}</span>
      <div class="tl">${r.timeline.length ? r.timeline.map((g) => gameChip(g, r)).join("") : `<span class="gm dnp">No games</span>`}</div>
      <div class="txt">${esc(r.text)}</div>
      ${lineText(r)}
      ${canMark ? `<div class="acts"><button class="b ${locked ? "on" : "ghost"}" data-act="mark" data-id="${esc(r.id)}">${locked ? "Locked here · undo" : "I locked this in Sleeper"}</button></div>` : ""}
    </div>`;
  }
  function weekHTML() {
    if (!result) return `<div class="empty">Loading…</div>`;
    const starters = result.rows.filter((r) => r.starter), bench = result.rows.filter((r) => !r.starter);
    const s = result.summary;
    const chips = [["lock", "to lock"], ["live", "live"], ["hold", "holding"], ["wait", "waiting"], ["final", "final"], ["locked", "locked"], ["none", "no games"]]
      .filter(([k]) => s[k]).map(([k, t]) => `<span class="vd ${k}">${s[k]} ${t}</span>`).join("");
    const unknown = result.rows.filter((r) => !roster.find((x) => x.id === r.id)?.known).length;
    return `<div class="blk"><div class="sumrow">${chips || `<span class="vd">No starters set</span>`}</div><div class="hint">${esc(RISK_HELP[S.risk])}</div></div>
      <div class="sec" style="padding:10px 10px 0">Starters</div>${starters.map(cardHTML).join("") || `<div class="empty">No starters set in Sleeper.</div>`}
      ${bench.length ? `<button class="more" data-act="bench">${S.bench ? "Hide" : "Show"} bench (${bench.length}) · bench games can't be locked</button>${S.bench ? bench.map(cardHTML).join("") : ""}` : ""}
      <div class="blk"><div class="hint">Marking a lock here only tracks it in this panel. Lock the game in Sleeper too.${unknown ? ` ${unknown} player${unknown > 1 ? "s use" : " uses"} league-average volatility (not in my rankings).` : ""}</div></div>`;
  }
  function calcHTML() {
    const opts = roster.map((r) => `<option value="${esc(r.id)}" ${calc.id === r.id ? "selected" : ""}>${esc(r.n)}</option>`).join("");
    return `<div class="calc">
      <label>Player <select id="c-id"><option value="">Custom average…</option>${opts}</select></label>
      ${calc.id ? "" : `<label>His average fantasy points per game <input id="c-mu" type="number" inputmode="decimal" step="0.5" value="${esc(calc.mu)}" placeholder="e.g. 32"></label>`}
      <label>Score in the game he just played <input id="c-score" type="number" inputmode="decimal" step="0.5" value="${esc(calc.score)}" placeholder="e.g. 41.5"></label>
      <label>Games left this week after it <select id="c-k">${[1, 2, 3, 4, 5].map((k) => `<option ${+calc.k === k ? "selected" : ""}>${k}</option>`).join("")}</select></label>
      <div class="res" id="c-res">${calcResult()}</div>
      <div class="hint">The lock line is the score where locking and waiting are worth the same. It drops as games run out, because fewer chances remain to beat it. Chase raises it, Protect lowers it.</div>
    </div>`;
  }
  function calcResult() {
    const pl = calc.id ? roster.find((r) => r.id === calc.id) : null;
    const mu = pl ? pl.mu : +calc.mu, cv = pl ? pl.cv : POOL_CV, q = pl ? 1 - (pl.rest || 0.07) : 0.93;
    const c = +calc.score, k = +calc.k;
    if (!(mu > 0)) return "Pick a player or enter his average.";
    const sol = L.solve(mu, cv, q, Math.max(k, 1), { risk: S.risk, z: Z });
    const line = sol.T[k];
    if (calc.score === "" || isNaN(c)) return `Lock line with ${k} game${k > 1 ? "s" : ""} left: <b>${f1(line)}</b>`;
    const hold = sol.cont(c, k);
    return c >= line ? `<span class="vd lock">Lock</span> ${f1(c)} beats the ${f1(line)} line. Waiting is worth about ${f1(hold)}.`
      : `<span class="vd hold">Hold</span> ${f1(c)} is under the ${f1(line)} line. Waiting is worth about ${f1(hold)}.`;
  }
  function wireCalc() {
    const on = (id, key) => { const el = root.getElementById(id); if (el) el.addEventListener(el.tagName === "SELECT" ? "change" : "input", () => { calc[key] = el.value; if (key === "id") render(); else root.getElementById("c-res").innerHTML = calcResult(); }); };
    on("c-id", "id"); on("c-mu", "mu"); on("c-score", "score"); on("c-k", "k");
  }

  /* ---------------- events ---------------- */
  root.addEventListener("click", (e) => {
    const t = e.target.closest("[data-act]");
    if (!t) return;
    const act = t.dataset.act;
    if (act === "collapse") S.collapsed = !S.collapsed;
    else if (act === "risk") { S.risk = t.dataset.v; analyze(); }
    else if (act === "tab") S.tab = t.dataset.v;
    else if (act === "bench") S.bench = !S.bench;
    else if (act === "mark") {
      const k = lockKey(), set = lockedSet(), id = t.dataset.id;
      if (set.has(id)) set.delete(id); else { set.add(id); toast("Tracked here. Make sure it's locked in Sleeper too.", "", 3500); }
      LOCKS[k] = [...set];
      analyze();
    } else return;
    save(); render();
  });
  window.addEventListener("keydown", (e) => {
    if (!leagueId || notNba || e.ctrlKey || e.metaKey || e.altKey) return;
    const path = e.composedPath ? e.composedPath() : [e.target];
    if (path.some((n) => n && n.tagName && (/^(INPUT|TEXTAREA|SELECT)$/.test(n.tagName) || n.isContentEditable))) return;
    if (e.key === "`") { S.collapsed = !S.collapsed; save(); render(); e.preventDefault(); }
  }, true);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && leagueId && Date.now() - lastOk > 30e3) tick(); });
  if (hasExt) chrome.runtime.onMessage.addListener((msg) => { if (msg && msg.type === "wr-toggle" && leagueId && !notNba) { S.collapsed = !S.collapsed; save(); render(); } });

  function detect() { const m = location.pathname.match(/^\/leagues\/(\d+)/); return m ? m[1] : null; }
  function start(id) {
    leagueId = id; league = null; rosters = null; result = null; notNba = false; T = { league: 0, rosters: 0, schedule: T.schedule, proj: T.proj, stats: 0 }; statsWeek = null;
    mount(); render(); tick();
  }
  function stop() { leagueId = null; clearTimeout(timer); render(); }
  setInterval(() => { const id = detect(); if (id !== leagueId) { if (id) start(id); else stop(); } }, 1000);
  loadStore().then(() => { const id = detect(); if (id) start(id); });
  window.__WR_SEASON_API = { get result() { return result; }, refresh: tick, analyze };
})();
