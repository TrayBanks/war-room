/* Lock-In week logic shared by tools/week_page.js (Node, every refresh) and the live "Lock or wait" card (browser).
   Sleeper's API has no lock field, so locks are worked out here:
   - inferred: once a starter has played again, Sleeper's counted points (starters_points) matching an earlier game
     instead of his latest one means that earlier game is locked;
   - manual: locks Tray told us about (data/locks.json) or marked on his phone, each with the date of the game he locked;
   - conflict: Sleeper's feed counts a newer game for a manual lock. The feed flips between servers for minutes at a time
     (seen Oct 24, 2026), so the lock Tray made wins and the page just notes the disagreement; the app is the final word.
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
    const locks = new Set(), inferred = new Set(), conflict = new Map();
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
        if (manual) {
          locks.add(id);
          const prev = played[played.length - 2];
          const after = lockedOn ? latest.date > lockedOn : !!prev;
          const lockedGame = lockedOn ? played.find((s) => s.date === lockedOn) : prev;
          if (after && lockedGame && !close(latest.pts_std, lockedGame.pts_std)) {
            // he locked an earlier game: that game counts, whatever the feed shows right now
            if (!close(off, lockedGame.pts_std)) conflict.set(id, off);
            for (const s of stats) if (s.player_id === id && s.date > lockedGame.date) s.sp = 0;
            continue;
          }
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
      r.pl = pl; r.slot = pl.slot; r.inferred = inferred.has(r.id); r.feed = conflict.has(r.id) ? conflict.get(r.id) : null;
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

  /* Start these 9: best lineup from a given day on.
     Each player's worth that day: if he plays that day, his counted score plus the value of the games he has left (lock.js
     cont); if not, just the score he has banked (a bench player who sits that day can be swapped in later at no cost).
     Fixed in place: locked starters, and anyone whose game that day has already tipped (Sleeper locks them). A bench player
     whose game already tipped can't start that day. Bitmask DP over the 9 slots.
     o: { L, z, risk, slots, starters: [ids by slot], counted: {id: score}, locks: Set, roster: [ids], player(id), schedule, day, today } */
  const SLOT_OK = { PG: ["PG"], SG: ["SG"], G: ["PG", "SG"], SF: ["SF"], PF: ["PF"], F: ["SF", "PF"], C: ["C"], UTIL: null };
  const fits = (slot, pos) => !SLOT_OK[slot] || (pos || []).some((x) => SLOT_OK[slot].includes(x));
  function planLineup(o) {
    const day = o.day || o.today, tipped = (team) => o.schedule.some((g) => g.date === day && g.status !== "pre_game" && (g.home === team || g.away === team));
    const left = (team) => o.schedule.filter((g) => (g.home === team || g.away === team) && g.status === "pre_game" && g.date >= day).length;
    const playsDay = (team) => o.schedule.some((g) => g.date === day && (g.home === team || g.away === team));
    const worth = (id) => {
      const p = o.player(id), c = o.counted[id] || 0, k = left(p.team);
      const q0 = Math.max(0, Math.min(1, 1 - (p.rest || 0.07))), q = /^(Out|IR|Suspended)$/i.test(p.inj || "") ? 0 : /^(Questionable|GTD|DTD|Doubtful)$/i.test(p.inj || "") ? q0 * 0.6 : q0;
      // only a player who plays that day can use the slot that day; anyone else can be swapped in later for free,
      // so off days are worth just the score he has banked
      return k && q && playsDay(p.team) ? o.L.solve(p.mu, p.cv, q, 6, { risk: o.risk || "even", z: o.z }).cont(c, k) : c;
    };
    const fixed = {}, used = new Set();
    o.slots.forEach((s, i) => { const id = o.starters[i]; if (id && id !== "0" && (o.locks.has(id) || (day === o.today && tipped(o.player(id).team)))) { fixed[i] = id; used.add(id); } });
    const free = o.slots.map((s, i) => i).filter((i) => fixed[i] == null);
    const cands = o.roster.filter((id) => !used.has(id) && !(day === o.today && tipped(o.player(id).team) && !o.starters.includes(id)));
    const val = Object.fromEntries(cands.map((id) => [id, worth(id)]));
    const F = free.length, full = (1 << F) - 1;
    let best = new Map([[0, { v: 0, pick: [] }]]);
    for (const id of cands) {
      const nx = new Map(best);
      for (const [mask, st] of best) for (let j = 0; j < F; j++) {
        if (mask & (1 << j) || !fits(o.slots[free[j]], o.player(id).pos)) continue;
        const m2 = mask | (1 << j), v = st.v + val[id] + (o.starters[free[j]] === id ? 0.05 : 0), cur = nx.get(m2);   // ties: leave him where he is
        if (!cur || v > cur.v) nx.set(m2, { v, pick: st.pick.concat([[free[j], id]]) });
      }
      best = nx;
    }
    let top = null;
    for (const [mask, st] of best) if (!top || st.v > top.v || (st.v === top.v && mask === full)) top = st;
    const lineup = o.slots.map((s, i) => fixed[i] || null);
    for (const [i, id] of top.pick) lineup[i] = id;
    const rows = o.slots.map((s, i) => {
      const id = lineup[i], was = o.starters[i];
      return { slot: s, id, was, change: !!id && id !== was, fixed: fixed[i] != null, locked: !!(id && o.locks.has(id)), plays: id ? playsDay(o.player(id).team) : false, worth: id ? +(fixed[i] != null ? (o.counted[id] || 0) : val[id]).toFixed(1) : 0 };
    });
    const nowVal = o.slots.reduce((a, s, i) => { const id = o.starters[i]; return a + (!id || id === "0" ? 0 : fixed[i] != null ? o.counted[id] || 0 : cands.includes(id) ? val[id] : 0); }, 0);
    return { day, rows, total: +rows.reduce((a, r) => a + r.worth, 0).toFixed(1), gain: +(rows.reduce((a, r) => a + r.worth, 0) - nowVal).toFixed(1) };
  }

  const riskOf = (diff) => (diff < -15 ? "chase" : diff > 15 ? "protect" : "even");
  const api = { analyzeSide, riskOf, consensus, planLineup, fits };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WR_WEEK = api;
})(typeof self !== "undefined" ? self : this);
