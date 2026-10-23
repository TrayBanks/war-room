/* War Room — Lock-In decision math (pure, no DOM).
   Sleeper rule: each starter counts ONE game per week. After a game you may lock it, but only before his next game
   starts. If you never lock, his final game of the week counts.

   For a player with latest score c and k scheduled games left, each played with probability q:
     V_0(c) = c
     V_k(c) = (1-q)·V_{k-1}(c) + q·A_k,   A_k = E[ max(X, V_{k-1}(X)) ]      (X = next game's score)
   which solves to V_k(c) = α_k·c + B_k with α_k = (1-q)^k. Lock when c ≥ V_k(c), i.e. c ≥ T_k = B_k / (1 − α_k).
   Risk modes apply a utility u(x) = x^γ before solving (γ > 1 chases upside, γ < 1 protects a lead). */
(function (root) {
  "use strict";
  const RISK = { even: 1, chase: 1.35, protect: 0.75 };

  function scoreGrid(mu, cv, z) {
    return z.map((zz) => Math.max(0, mu * (1 + cv * zz)));
  }

  function solve(mu, cv, q, kmax, opts) {
    const g = RISK[(opts && opts.risk) || "even"] || 1;
    const z = (opts && opts.z) || root.WR_DEFAULT_Z;
    const xs = scoreGrid(mu, cv, z).map((x) => Math.pow(x, g));
    const alpha = [1], B = [0], T = [0];
    for (let k = 1; k <= kmax; k++) {
      let s = 0;
      for (const x of xs) s += Math.max(x, alpha[k - 1] * x + B[k - 1]);
      const A = s / xs.length;
      alpha[k] = (1 - q) * alpha[k - 1];
      B[k] = (1 - q) * B[k - 1] + q * A;
      T[k] = alpha[k] < 1 ? Math.pow(B[k] / (1 - alpha[k]), 1 / g) : 0;
    }
    const cont = (c, k) => Math.pow(alpha[k] * Math.pow(Math.max(0, c), g) + B[k], 1 / g);
    return { T, cont, gamma: g };
  }

  const dayName = (iso) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });

  /* One player's week. games: team schedule rows this week [{date, status}], logs: [{date, score, sp}] */
  function analyzePlayer(pl, games, logs, today, opts) {
    const o = opts || {};
    const q0 = Math.max(0, Math.min(1, 1 - (pl.rest || 0.07)));
    const q = pl.inj === "Out" ? 0 : /^(Questionable|DTD|Doubtful)$/i.test(pl.inj || "") ? q0 * 0.6 : q0;
    const sched = games.slice().sort((a, b) => a.date.localeCompare(b.date));
    // a game in progress can show partial stats: never treat those as a finished score
    const liveDates = new Set(sched.filter((g) => g.status === "in_game").map((g) => g.date));
    const played = logs.filter((l) => (l.sp || 0) > 0 && !liveDates.has(l.date)).sort((a, b) => a.date.localeCompare(b.date));
    const latest = played.length ? played[played.length - 1] : null;
    const live = sched.find((g) => g.status === "in_game");
    const lastDate = latest ? latest.date : null;
    // a finished game with no stat line yet (Sleeper posts finals a few minutes late): don't decide on stale data
    const yday = new Date(Date.parse(today + "T12:00:00Z") - 864e5).toISOString().slice(0, 10);
    const pending = sched.find((g) => g.status === "complete" && g.date >= yday && !logs.find((l) => l.date === g.date) && (!lastDate || g.date > lastDate));
    const future = sched.filter((g) => g.status !== "complete" && g.status !== "in_game" && (!lastDate || g.date > lastDate) && g.date >= today);
    const k = future.length;
    const sol = solve(pl.mu, pl.cv, q, 6, { risk: o.risk, z: o.z });
    const out = { id: pl.id, n: pl.n, pos: pl.pos, starter: !!pl.starter, games: sched.length, playedCount: played.length,
      latest: latest ? latest.score : null, latestDay: latest ? dayName(latest.date) : null, k, q,
      next: future[0] ? dayName(future[0].date) : null, lines: sol.T.slice(1, 5), timeline: sched.map((g) => {
        const lg = logs.find((l) => l.date === g.date);
        const isLive = g.status === "in_game", wait = pending && pending.date === g.date;
        return { day: dayName(g.date), date: g.date, played: !isLive && !!(lg && lg.sp > 0), dnp: !isLive && !wait && (!!(lg && !(lg.sp > 0)) || (g.status === "complete" && !lg)),
          score: !isLive && lg && lg.sp > 0 ? lg.score : null, live: isLive, pending: !!wait };
      }) };
    if (o.locked) return { ...out, verdict: "locked", text: latest ? `Locked at ${latest.score.toFixed(1)}` : "Marked locked" };
    if (live && (!lastDate || live.date >= lastDate)) return { ...out, verdict: "live", text: latest ? `Playing now. ${latest.score.toFixed(1)} from ${out.latestDay} can no longer be locked.` : "Playing now. Decide after the game." };
    if (pending) return { ...out, verdict: "pending", text: `${dayName(pending.date)}'s final isn't in Sleeper's stats yet. Check back in a few minutes.` };
    if (!latest) {
      if (k === 0) return { ...out, verdict: "none", text: out.starter ? "No games left this week. Start someone who plays." : "No games left this week." };
      const need = sol.T[k - 1];
      return { ...out, verdict: "wait", threshold: need, text: k - 1 > 0 ? `First game ${out.next}. Lock it if he scores ${need.toFixed(1)}+.` : `Only game ${out.next}. It counts automatically.` };
    }
    if (k === 0) return { ...out, verdict: "final", threshold: 0, text: `No games left. ${latest.score.toFixed(1)} counts automatically.` };
    const T = sol.T[k], hold = sol.cont(latest.score, k);
    if (latest.score >= T) return { ...out, verdict: "lock", threshold: T, gain: latest.score - hold,
      text: `Lock ${latest.score.toFixed(1)}. Waiting is worth about ${hold.toFixed(1)} with ${k} game${k > 1 ? "s" : ""} left.` };
    return { ...out, verdict: "hold", threshold: T, gain: hold - latest.score,
      text: `Hold. ${latest.score.toFixed(1)} is under the ${T.toFixed(1)} lock line; waiting is worth about ${hold.toFixed(1)}.` };
  }

  /* Whole roster for a week. */
  function analyzeWeek(input) {
    const { roster, schedule, stats, today, locks, risk, z } = input;
    const byTeam = {};
    for (const g of schedule) for (const t of [g.home, g.away]) (byTeam[t] = byTeam[t] || []).push({ date: g.date, status: g.status });
    const logsBy = {};
    for (const r of stats) (logsBy[String(r.player_id)] = logsBy[String(r.player_id)] || []).push({ date: r.date, score: +r.pts_std || 0, sp: +r.sp || 0 });
    const rows = roster.map((pl) => analyzePlayer(pl, byTeam[pl.team] || [], logsBy[String(pl.id)] || [], today, { risk, z, locked: locks && locks.has(String(pl.id)) }));
    const order = { lock: 0, pending: 1, live: 2, hold: 3, wait: 4, final: 5, none: 6, locked: 7 };
    rows.sort((a, b) => (b.starter - a.starter) || (order[a.verdict] - order[b.verdict]) || ((b.latest || 0) - (a.latest || 0)));
    const count = (v) => rows.filter((r) => r.starter && r.verdict === v).length;
    return { rows, summary: { lock: count("lock"), live: count("live"), pending: count("pending"), hold: count("hold"), wait: count("wait"), final: count("final"), locked: count("locked"), none: count("none") } };
  }

  const api = { solve, analyzePlayer, analyzeWeek, RISK };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WR_LOCK = api;
})(typeof self !== "undefined" ? self : this);
