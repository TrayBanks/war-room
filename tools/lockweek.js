/* Lock-In week logic shared by tools/week_page.js (Node, every refresh) and the live "Lock or wait" card (browser).
   Sleeper's API has no lock field, so locks are worked out here:
   - inferred: once a starter has played again, Sleeper's counted points (starters_points) matching an earlier game
     instead of his latest one means that earlier game is locked;
   - manual: locks Tray told us about (data/locks.json) or marked on his phone, each with the date of the game he locked;
   - broken: a manual lock that Sleeper contradicts (it counts a game played after the locked one), so it never went through.
   Needs lock.js (passed in as L). */
(function (root) {
  "use strict";
  const close = (a, b) => Math.abs(a - b) <= 0.75;

  function analyzeSide(o) {
    // o: { L, starters, points, slots, player(id) -> {id, n, team, pos[], inj, mu, cv, rest}, schedule: [{date, home, away, status}],
    //      stats: [{player_id, date, team, pts_std, sp}], today, manual: Map(id -> locked game date or "") or Set, risk, z }
    const unsure = new Set((o.unsure || []).map(String));
    const man = o.manual instanceof Map ? o.manual : new Map([...(o.manual || [])].map((id) => [String(id), ""]));
    const roster = o.starters.map((id, i) => Object.assign({}, o.player(id), { starter: true, slot: o.slots[i] || "UTIL" }));
    const stats = o.stats.filter((s) => o.starters.includes(String(s.player_id))).map((s) => Object.assign({}, s, { player_id: String(s.player_id) }));
    const official = {};
    o.starters.forEach((id, i) => { official[id] = o.points[i]; });
    const locks = new Set(), inferred = new Set(), broken = new Set();
    for (const p of roster) {
      const id = p.id, manual = man.has(id), lockedOn = man.get(id) || "";
      // while his game is on, Sleeper's count is the live partial score: leave his finished games alone
      const live = o.schedule.some((g) => g.status === "in_game" && (g.home === p.team || g.away === p.team));
      const played = stats.filter((s) => s.player_id === id && s.sp > 0).sort((a, b) => a.date.localeCompare(b.date));
      const off = official[id];
      if (live || off == null || !played.length) { if (manual) locks.add(id); continue; }
      const latest = played[played.length - 1];
      const earlier = played.slice(0, -1).find((s) => close(off, s.pts_std));
      if (played.length >= 2 && !close(off, latest.pts_std) && earlier) {
        inferred.add(id); locks.add(id);
        earlier.pts_std = off;                                   // the locked game is the one that counts
        for (const s of stats) if (s.player_id === id && s.date > earlier.date) s.sp = 0;
      } else {
        if (manual && unsure.has(id)) locks.add(id);             // reads disagreed: trust the lock he made
        else if (manual) {
          // broken only if Sleeper counts a game played after the one he locked
          const prev = played[played.length - 2];
          const after = lockedOn ? latest.date > lockedOn : !!prev;
          const lockedGame = lockedOn ? played.find((s) => s.date === lockedOn) : prev;
          if (after && close(off, latest.pts_std) && lockedGame && !close(latest.pts_std, lockedGame.pts_std)) broken.add(id);
          else locks.add(id);
        }
        latest.pts_std = off;                                    // the league's counted number (stat corrections)
      }
    }
    const res = o.L.analyzeWeek({ roster, schedule: o.schedule, stats, today: o.today, locks, risk: o.risk, z: o.z });
    let now = 0, exp = 0, rem = 0, tot = 0;
    for (const r of res.rows) {
      const pl = roster.find((x) => x.id === r.id);
      const sol = o.L.solve(pl.mu, pl.cv, r.q, 6, { risk: "even", z: o.z });
      const c = r.latest || 0;
      r.exp = ["lock", "final", "locked"].includes(r.verdict) ? c : r.verdict === "none" ? 0 : r.verdict === "live" ? Math.max(c, pl.mu * 0.9) : sol.cont(c, r.k);
      r.pl = pl; r.slot = pl.slot; r.inferred = inferred.has(r.id); r.broken = broken.has(r.id);
      now += c; exp += r.exp; rem += r.k; tot += r.games;
    }
    return { res, now, exp, remFrac: tot ? rem / tot : 0, roster };
  }

  /* Sleeper's matchup endpoint can answer differently from one read to the next (replicas catching up, or a lineup
     being edited). Read it a few times and take, per roster, the most common lineup and per-starter the most common
     count. Starters whose count differed between reads are "unsure": a manual lock is trusted for them. */
  function consensus(reads, rid) {
    const rows = reads.map((ms) => (ms || []).find((m) => m.roster_id === rid)).filter(Boolean);
    if (!rows.length) return null;
    const key = (r) => (r.starters || []).join(","), top = (arr) => { const c = new Map(); for (const v of arr) c.set(v, (c.get(v) || 0) + 1); return [...c.entries()].sort((a, b) => b[1] - a[1])[0][0]; };
    const lineup = top(rows.map(key)), same = rows.filter((r) => key(r) === lineup), st = (same[0].starters || []).map(String);
    const pts = st.map((_, i) => +top(same.map((r) => (r.starters_points || [])[i] || 0)));
    const unsure = st.filter((_, i) => new Set(same.map((r) => (r.starters_points || [])[i])).size > 1);
    return { roster_id: rid, matchup_id: same[0].matchup_id, starters: st, starters_points: pts, points: +pts.reduce((a, b) => a + b, 0).toFixed(2),
      unsure, agree: !unsure.length && same.length === rows.length, reads: rows.length };
  }

  const riskOf = (diff) => (diff < -15 ? "chase" : diff > 15 ? "protect" : "even");
  const api = { analyzeSide, riskOf, consensus };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WR_WEEK = api;
})(typeof self !== "undefined" ? self : this);
