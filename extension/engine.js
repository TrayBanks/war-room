/* War Room engine — pure draft math, no DOM. Runs in the extension and in Node tests.
   v1.1: Lock-In values, learned per-manager sharpness, Monte Carlo "will he last" odds, room leaderboard. */
(function (root) {
  "use strict";

  const GRADES = [[0.95, "strong", "Strong"], [0.85, "solid", "Solid"], [0.75, "q", "Questionable"], [0, "reach", "Reach"]];
  const STAT_KEYS = ["pts", "reb", "ast", "stl", "blk", "to", "tpm", "dd", "td"];
  const SOURCES = [
    ["Points", (s) => s[0] * 0.5], ["3PM", (s) => s[6] * 0.5], ["Rebounds", (s) => s[1]], ["Assists", (s) => s[2]],
    ["Steals+Blocks", (s) => (s[3] + s[4]) * 2], ["DD/TD", (s) => s[7] + 2 * s[8]], ["Turnovers", (s) => -s[5]],
  ];
  // Room model: each manager ranks players by (1-s)*ADP rank + s*value rank, picks via softmax(temperature TAU),
  // and blunders with probability EPS (uniform among plausible picks). s is learned per manager from every pick.
  const GRID = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
  const ROOM = { priorMean: 0.65, priorSd: 0.22, tau: 2.5, eps: 0.08, pool: 45, sims: 400 };
  // Roster fit: bench players count 30% (scaled by slot flexibility), a C-only player in UTIL counts 90%,
  // and each bench player already covering the same positions halves-then-thirds the next one's bench value.
  const FIT = { bench: 0.30, cUtil: 0.9, dim: 0.5 };

  function norm(s) {
    return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
      .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, "").replace(/[^a-z]/g, "");
  }
  const grade = (pct) => GRADES.find((g) => pct >= g[0]);
  function slotForPick(pickNo, teams, reversal) {
    const r = Math.ceil(pickNo / teams), idx = (pickNo - 1) % teams;
    let forward = r % 2 === 1;
    if (reversal && r >= reversal) forward = !forward;
    return forward ? idx + 1 : teams - idx;
  }
  function picksForSlot(slot, teams, rounds, reversal) {
    const out = [];
    for (let p = 1; p <= teams * rounds; p++) if (slotForPick(p, teams, reversal) === slot) out.push(p);
    return out;
  }
  function scoreFppg(st, sc) {
    const g = (k) => +st[k] || 0;
    return sc.pts * g("pts") + sc.reb * g("reb") + sc.ast * g("ast") + sc.stl * g("stl") + sc.blk * g("blk") +
      sc.to * g("to") + sc.tpm * g("tpm") + sc.dd * g("dd") + sc.td * g("td");
  }
  function rng(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const isCOnly = (p) => p && p.p && p.p.length === 1 && p.p[0] === "C";

  class Engine {
    constructor(data) {
      this.data = data;
      this.L = data.league;
      this.players = data.players.map((p) => ({ ...p, a0: p.a, lv0: p.lv, out: p.inj === "Out" || /^Out/.test(p.note || "") }));
      this.byId = new Map(this.players.map((p) => [String(p.id), p]));
      this.byNorm = new Map(this.players.map((p) => [norm(p.n), p]));
      this.fades = new Set((data.fades || []).map(norm));
      this.news = [];
      this._cache = null;
      this._room = null;
      this.SLOTS = this.L.slots;
      const bits = (pred) => this.SLOTS.reduce((m, sl, i) => (pred(sl) ? m | (1 << i) : m), 0);
      this.utilBits = bits((sl) => sl === "UTIL");
      this.gBits = bits((sl) => ["PG", "SG", "G"].includes(sl));
      this.fBits = bits((sl) => ["SF", "PF", "F"].includes(sl));
      this.cBits = bits((sl) => sl === "C");
    }

    applyProjections(rows) {
      if (!Array.isArray(rows)) return 0;
      let n = 0;
      this.news = [];
      for (const r of rows) {
        const p = this.byId.get(String(r.player_id));
        if (!p || !r.stats || !r.stats.pts) continue;
        const f = scoreFppg(r.stats, this.L.scoring);
        if (isFinite(f) && f > 0) p.f = Math.round(f * 100) / 100;
        if (r.stats.adp_std && r.stats.adp_std < 999) p.adp = Math.round(r.stats.adp_std * 10) / 10;
        p.s = STAT_KEYS.map((k) => Math.round((+r.stats[k] || 0) * 100) / 100);
        const inj = (r.player && r.player.injury_status) || "";
        if (inj !== (p.inj || "")) {
          if (inj === "Out" && !p.out) this.news.push(`${p.n} now listed Out`);
          if (!inj && p.inj === "Out") this.news.push(`${p.n} no longer listed Out`);
        }
        p.inj = inj;
        let lvScale = 1;
        if (inj === "Out" && !p.out) { p.out = true; p.a = Math.min(p.a0, 0.5); lvScale = 0.5; }
        p.v = Math.round(p.f * p.a * 100) / 100;
        p.lv = Math.round(p.f * (p.lk || 1) * lvScale * 100) / 100;
        n++;
      }
      this._cache = null;
      this._room = null;
      this._memo = null;
      this._ver = (this._ver || 0) + 1;
      return n;
    }

    findByName(name) { return this.byNorm.get(norm(name)) || null; }
    isFade(p) { return this.fades.has(norm(p.n)); }
    score(p, mode) {
      if (mode === "ceiling") return p.out ? p.f * p.a : p.f;
      if (mode === "floor") return p.v;
      return p.lv != null ? p.lv : p.v;     // "lock" (default): Lock-In value
    }

    /* Learn each manager's sharpness from the picks so far. Returns posterior over GRID per slot.
       Incremental (v1.2): only picks that arrived since the last call are scored. */
    learnRoom(picks, teams) {
      let R = this._room;
      const same = R && R.teams === teams && R.ids.length <= picks.length && R.ids.every((id, i) => id === String(picks[i].player_id));
      if (!same) {
        R = this._room = { teams, ids: [], taken: new Set(), ll: {}, evidence: [],
          byAdp: this.players.slice().sort((a, b) => a.adp - b.adp), byVal: this.players.slice().sort((a, b) => (b.lv || 0) - (a.lv || 0)) };
        for (let t = 1; t <= teams; t++) R.ll[t] = GRID.map(() => 0);
      }
      const { byAdp, byVal, taken, ll, evidence } = R;
      for (const pk of picks.slice(R.ids.length)) {
        const pid = String(pk.player_id), p = this.byId.get(pid), slot = pk.draft_slot;
        if (p && ll[slot]) {
          const ar = new Map(), vr = new Map();
          let i = 0; for (const q of byAdp) if (!taken.has(String(q.id))) ar.set(q, i++);
          i = 0; for (const q of byVal) if (!taken.has(String(q.id))) vr.set(q, i++);
          const cand = [];
          for (const [q, a] of ar) { const v = vr.get(q); if (a < ROOM.pool || v < ROOM.pool || q === p) cand.push([q, a, v]); }
          const pa = ar.get(p), pv = vr.get(p);
          GRID.forEach((sv, gi) => {
            let z = 0, mn = Infinity;
            for (const [, a, v] of cand) mn = Math.min(mn, (1 - sv) * a + sv * v);
            for (const [, a, v] of cand) z += Math.exp(-(((1 - sv) * a + sv * v) - mn) / ROOM.tau);
            const sp = Math.exp(-(((1 - sv) * pa + sv * pv) - mn) / ROOM.tau) / z;
            ll[slot][gi] += Math.log((1 - ROOM.eps) * sp + ROOM.eps / cand.length);
          });
          evidence.push({ slot, adpRank: pa, valRank: pv });
        }
        taken.add(pid);
        R.ids.push(pid);
      }
      const prior = GRID.map((sv) => Math.exp(-((sv - ROOM.priorMean) ** 2) / (2 * ROOM.priorSd ** 2)));
      const post = {};
      for (let t = 1; t <= teams; t++) {
        const m = Math.max(...ll[t]);
        const w = GRID.map((_, gi) => prior[gi] * Math.exp(ll[t][gi] - m));
        const z = w.reduce((a, b) => a + b, 0);
        const pr = w.map((x) => x / z);
        const mean = pr.reduce((a, x, gi) => a + x * GRID[gi], 0);
        const sd = Math.sqrt(pr.reduce((a, x, gi) => a + x * (GRID[gi] - mean) ** 2, 0));
        post[t] = { probs: pr, mean, sd };
      }
      return { post, evidence };
    }

    /* Simulate every pick from `current` to `lastPick` with each manager drawing his sharpness from his posterior.
       Returns survival probability per player at each checkpoint pick number.
       v1.2: O(pool) per simulated pick. Softmax weights are precomputed per sharpness grid value (no sorting, no exp
       in the inner loop), and the pool is cut to what can plausibly go before your pick. ~30x faster than v1.1. */
    simulate(avail, current, lastPick, checkpoints, ctx) {
      const { teams, reversal, mySlot, post, rosters } = ctx;
      const res = {};
      checkpoints.forEach((c) => { res[c] = new Map(); });
      if (!avail.length || lastPick < current) return res;
      const byAdp = avail.slice().sort((a, b) => a.adp - b.adp);
      const ar0 = new Map(byAdp.map((p, i) => [p, i]));
      const vr0 = new Map(avail.map((p, i) => [p, i]));                 // avail arrives sorted by Lock value
      const cut = Math.min(avail.length, (lastPick - current + 1) + 55);
      const pool = avail.filter((p) => ar0.get(p) < cut || vr0.get(p) < cut);
      const n = pool.length;
      const A = pool.map((p) => ar0.get(p)), V = pool.map((p) => vr0.get(p)), C = Uint8Array.from(pool, (p) => (isCOnly(p) ? 1 : 0));
      const SC = GRID.map((s) => Float64Array.from(A, (a, i) => (1 - s) * a + s * V[i]));
      const W = SC.map((row) => Float64Array.from(row, (x) => Math.exp(-x / ROOM.tau)));
      const counts = {}; checkpoints.forEach((c) => { counts[c] = new Float64Array(n); });
      const cOnly0 = new Int32Array(teams + 1); for (let t = 1; t <= teams; t++) cOnly0[t] = (rosters[t] || []).filter(isCOnly).length;
      const pickSlot = []; for (let pk = current; pk <= lastPick; pk++) pickSlot.push(slotForPick(pk, teams, reversal));
      const rand = rng(1234 + current * 7);
      const sampleG = (t) => { const pr = post[t].probs; let u = rand(), acc = 0; for (let gi = 0; gi < GRID.length; gi++) { acc += pr[gi]; if (u <= acc) return gi; } return GRID.length - 1; };
      const N = ROOM.sims, gone = new Uint8Array(n), cOnly = new Int32Array(teams + 1), gOf = new Int32Array(teams + 1);
      for (let sim = 0; sim < N; sim++) {
        gone.fill(0); cOnly.set(cOnly0);
        for (let t = 1; t <= teams; t++) gOf[t] = sampleG(t);
        for (let pk = current, k = 0; pk <= lastPick; pk++, k++) {
          const cnt = counts[pk];
          if (cnt) for (let i = 0; i < n; i++) if (!gone[i]) cnt[i]++;
          if (pk === lastPick) break;
          const t = pickSlot[k];
          let chosen = -1;
          if (t === mySlot) { // assume I take the best Lock value left
            let best = Infinity; for (let i = 0; i < n; i++) if (!gone[i] && V[i] < best) { best = V[i]; chosen = i; }
          } else {
            const sc = SC[gOf[t]], w = W[gOf[t]], capped = cOnly[t] >= 3;
            if (rand() < ROOM.eps) {             // blunder: anyone within ~40 spots of his own board
              let mn = Infinity; for (let i = 0; i < n; i++) if (!gone[i] && sc[i] < mn) mn = sc[i];
              let m = 0; for (let i = 0; i < n; i++) if (!gone[i] && sc[i] <= mn + 40) m++;
              let j = Math.floor(rand() * m);
              for (let i = 0; i < n; i++) if (!gone[i] && sc[i] <= mn + 40) { if (j-- === 0) { chosen = i; break; } }
            } else {
              let tot = 0; for (let i = 0; i < n; i++) if (!gone[i]) tot += capped && C[i] ? w[i] * 0.3 : w[i];
              let u = rand() * tot;
              for (let i = 0; i < n; i++) if (!gone[i]) { u -= capped && C[i] ? w[i] * 0.3 : w[i]; if (u <= 0) { chosen = i; break; } }
              if (chosen < 0) for (let i = n - 1; i >= 0; i--) if (!gone[i]) { chosen = i; break; }
            }
          }
          if (chosen >= 0) { gone[chosen] = 1; if (C[chosen]) cOnly[t]++; }
        }
      }
      checkpoints.forEach((c) => { pool.forEach((p, i) => res[c].set(p, counts[c][i] / N)); });
      return res;
    }

    /* ---------- Roster fit (v1.2) ----------
       What a player adds to YOUR lineup, not just his own value. Starters: best assignment of your players to
       PG, SG, G, SF, PF, F, C, UTIL, UTIL (bitmask DP over the 9 slots). A center-only player can only fill C or UTIL,
       and counts 90% in a UTIL slot because he freezes your most flexible spot. Whatever doesn't start counts at the
       bench rate (30%, Lock-In lets bench players rotate into open slots), scaled by how many slots he can fill and
       cut further when your bench already covers his positions. */
    slotMask(p) {
      if (p._em != null && p._emKey === (p.p || []).join("/")) return p._em;
      let m = 0;
      this.SLOTS.forEach((s, i) => { if ((p.p || []).some((x) => (this.L.slot_ok[s] || []).includes(x))) m |= 1 << i; });
      p._em = m; p._emKey = (p.p || []).join("/");
      return m;
    }
    fitModel(roster, S) {
      const NS = this.SLOTS.length, FULL = 1 << NS, NEG = -1e9, UT = this.utilBits, eng = this;
      const groupsOf = (em) => ((em & this.gBits) ? 1 : 0) | ((em & this.fBits) ? 2 : 0) | ((em & this.cBits) ? 4 : 0);
      const flexOf = (em) => { let c = 0; for (let x = em; x; x &= x - 1) c++; return Math.max(0.6, Math.min(1.2, c / 5)); };
      function pass(dp, used, idx, v, em, cOnly) {
        const nd = dp.slice(), nu = used.slice();
        for (let m = 0; m < FULL; m++) {
          const base = dp[m]; if (base <= NEG) continue;
          for (let free = em & ~m; free; free &= free - 1) {
            const s = free & -free, val = base + (cOnly && (s & UT) ? v * FIT.cUtil : v), nm = m | s;
            if (val > nd[nm]) { nd[nm] = val; nu[nm] = used[m] | (1 << idx); }
          }
        }
        return [nd, nu];
      }
      function build(list, benchExtra) {
        let dp = new Float64Array(FULL).fill(NEG), used = new Int32Array(FULL);
        dp[0] = 0;
        list.forEach((p, i) => { [dp, used] = pass(dp, used, i, S(p), eng.slotMask(p), isCOnly(p)); });
        let best = 0, bm = 0; for (let m = 0; m < FULL; m++) if (dp[m] > best) { best = dp[m]; bm = m; }
        const startBits = used[bm];
        const starters = list.filter((_, i) => startBits & (1 << i));
        const bench = list.filter((_, i) => !(startBits & (1 << i))).concat(benchExtra || []);
        const benchGroups = bench.map((b) => groupsOf(eng.slotMask(b)));
        const model = {
          best, starters, bench,
          gain(q) {
            const v = S(q), em = eng.slotMask(q), c = isCOnly(q);
            let b = best;
            for (let m = 0; m < FULL; m++) {
              const base = dp[m]; if (base <= NEG) continue;
              for (let free = em & ~m; free; free &= free - 1) {
                const s = free & -free, val = base + (c && (s & UT) ? v * FIT.cUtil : v);
                if (val > b) b = val;
              }
            }
            return Math.max(0, b - best);
          },
          marginal(q) {
            const v = S(q); if (v <= 0) return 0;
            const g = Math.min(v, model.gain(q));
            const em = eng.slotMask(q), gq = groupsOf(em);
            let k = 0; for (const bg of benchGroups) if ((bg & gq) === gq) k++;
            return g + FIT.bench * (v - g) * flexOf(em) / (1 + FIT.dim * k);
          },
          // roster after taking q (bench approximated: q sits if he adds under half his value)
          add(q) { const g = model.gain(q); return g >= 0.5 * S(q) ? build(list.concat([q]), benchExtra) : build(list, (benchExtra || []).concat([q])); },
          slots: eng.slotMask.bind(eng), flexOf, groupsOf,
        };
        return model;
      }
      return build(roster.slice(0, 20), []);
    }

    compute(draft, picks, opts) {
      const mode = opts.mode || "lock";
      const st = (draft && draft.settings) || {};
      const teams = st.teams || this.L.teams, rounds = st.rounds || this.L.rounds;
      const reversal = st.reversal_round || 0, timer = st.pick_timer || this.L.pick_timer;
      picks = (picks || []).slice().sort((a, b) => a.pick_no - b.pick_no);

      let mySlot = opts.slot || null;
      if (!mySlot && draft && draft.draft_order && opts.userId && draft.draft_order[opts.userId]) mySlot = draft.draft_order[opts.userId];
      if (!mySlot) { const mine = picks.find((p) => p.picked_by && p.picked_by === opts.userId); if (mine) mySlot = mine.draft_slot; }

      // same picks, same settings → same answer: return the last result (v1.2; keeps polling ticks ~free)
      const memoKey = [teams, rounds, reversal, mode, mySlot, draft && draft.status, draft && draft.last_picked, draft && draft.start_time, this._ver || 0,
        picks.map((p) => p.player_id).join(",")].join("|");
      if (this._memo && this._memo.k === memoKey) return this._memo.v;

      const S = (p) => this.score(p, mode);
      const sorted = this.players.slice().sort((a, b) => S(b) - S(a));
      const taken = new Set(), log = [], rosters = {};
      for (let s = 1; s <= teams; s++) rosters[s] = [];
      for (const pk of picks) {
        const pid = String(pk.player_id), p = this.byId.get(pid);
        const top4 = [];
        for (const q of sorted) { if (!taken.has(String(q.id))) { top4.push(q); if (top4.length >= 4) break; } }
        const best = top4[0], scv = p ? S(p) : 0;
        const pct = best && S(best) > 0 ? Math.min(1.2, scv / S(best)) : 0;
        const g = grade(pct), meta = pk.metadata || {};
        const name = p ? p.n : `${meta.first_name || ""} ${meta.last_name || ""}`.trim() || "Unknown";
        const slot = pk.draft_slot || slotForPick(pk.pick_no, teams, reversal);
        log.push({ pick_no: pk.pick_no, round: pk.round || Math.ceil(pk.pick_no / teams), slot, pid, name,
          pos: p ? p.p : [meta.position || "?"], team: p ? p.t : meta.team || "", score: scv, pct, grade: g[1], gradeLabel: g[2],
          mine: slot === mySlot, adp: p ? p.adp : null,
          alts: top4.filter((q) => String(q.id) !== pid).slice(0, 2).map((q) => ({ n: q.n, s: S(q) })) });
        taken.add(pid);
        if (rosters[slot]) rosters[slot].push(p || { id: pid, n: name, p: [meta.position || "?"], t: meta.team || "", f: 0, a: 0, v: 0, lv: 0, s: [0, 0, 0, 0, 0, 0, 0, 0, 0] });
      }

      const total = teams * rounds, current = picks.length + 1;
      const done = picks.length >= total || (draft && draft.status === "complete");
      const onClock = done ? null : slotForPick(current, teams, reversal);
      const myPickList = mySlot ? picksForSlot(mySlot, teams, rounds, reversal) : [];
      const upcoming = myPickList.filter((p) => p >= current);
      const nextMine = upcoming[0] || null, afterMine = upcoming[1] || null;
      const isMyTurn = !!(nextMine && nextMine === current);
      const othersBetween = (from, to) => { let n = 0; for (let k = from; k < to; k++) if (slotForPick(k, teams, reversal) !== mySlot) n++; return n; };
      const horizon = isMyTurn ? (upcoming.slice(1).find((pk) => othersBetween(current + 1, pk) > 0) || afterMine) : nextMine;

      // available list sorted by the display mode; sharpness and simulation always use Lock value as "smart"
      const avail = sorted.filter((p) => !taken.has(String(p.id)));
      const availLV = avail.slice().sort((a, b) => (b.lv || 0) - (a.lv || 0));

      // learn the room (cached per pick count)
      const key = `${teams}|${picks.map((p) => p.player_id).join(",")}`;
      if (!this._cache || this._cache.key !== key) this._cache = { key, room: this.learnRoom(picks, teams), sims: {} };
      const { post } = this._cache.room;

      const checkpoints = [...new Set([nextMine, afterMine, horizon].filter(Boolean))];
      const lastPick = checkpoints.length ? Math.max(...checkpoints) : current;
      const simKey = `${current}|${checkpoints.join(",")}`;
      if (!this._cache.sims[simKey]) this._cache.sims[simKey] = this.simulate(availLV, isMyTurn ? current + 1 : current, lastPick, checkpoints, { teams, reversal, mySlot, post, rosters });
      const surv = this._cache.sims[simKey];
      const at = (cp, p) => (cp && surv[cp] && surv[cp].has(p) ? surv[cp].get(p) : 1);
      for (const p of avail) { p._pNext = at(nextMine, p); p._pAfter = at(afterMine, p); p._pH = at(horizon, p); }

      // roster fit: what each player adds to MY lineup (v1.2), then a two-pick lookahead on that
      const myRoster = mySlot ? rosters[mySlot] : [];
      const cOnly = myRoster.filter(isCOnly).length;
      const fm = this.fitModel(myRoster, S);
      for (const p of avail) { p._fit = fm.marginal(p); p._slots = fm.slots(p); }
      const fitAvail = avail.slice().sort((a, b) => b._fit - a._fit);
      const expBest = (excl, fmNext) => {
        const cand = [];
        for (const q of fitAvail) { if (q !== excl) cand.push([q, fmNext.marginal(q)]); if (cand.length >= 40) break; }
        cand.sort((x, y) => y[1] - x[1]);
        let none = 1, e = 0;
        for (const [q, val] of cand) { const pr = q._pAfter; e += none * pr * val; none *= 1 - pr; if (none < 0.002) break; }
        return e;
      };
      const recs = fitAvail.slice(0, 14).map((p) => {
        const now = p._fit;
        return { p, now, ev: now + (afterMine ? expBest(p, fm.add(p)) : 0), pNext: p._pNext, pAfter: p._pAfter, pH: p._pH, fills: p._fit >= 0.97 * S(p) };
      }).sort((a, b) => b.ev - a.ev);
      const viable = isMyTurn ? recs : recs.filter((r) => r.pNext >= 0.25);
      const top = viable.slice(0, 3);
      if (top.length) {
        const bestNow = fitAvail[0], r0 = top[0];
        const adpGap = r0.p.adp - (isMyTurn ? current : nextMine);
        const rawBest = avail[0];
        if (afterMine && othersBetween((nextMine || current) + 1, afterMine) === 0) {
          r0.why = `Best fit. You pick again at #${afterMine}`;
          for (const r of top.slice(1)) r.why = `Pair it with your next pick (#${afterMine})`;
        } else if (bestNow && r0.p !== bestNow && bestNow._pAfter >= 0.55) {
          r0.why = `${bestNow.n} should still be there at #${afterMine} (${Math.round(bestNow._pAfter * 100)}%)`;
        } else if (adpGap > 12 && r0.pAfter < 0.5) {
          r0.why = `Reach now: only ${Math.round(r0.pAfter * 100)}% he lasts to #${afterMine} against this room`;
        } else r0.why = r0.p === rawBest ? "Best value on the board" : r0.p === bestNow ? "Best fit for your lineup" : "Best two-pick total";
        if (rawBest && r0.p !== rawBest && rawBest._fit < 0.8 * S(rawBest) && myRoster.length)
          r0.why += `. ${rawBest.n} ranks higher but would ${rawBest._fit < 0.5 * S(rawBest) ? "mostly sit" : "crowd your " + (isCOnly(rawBest) ? "C/UTIL slots" : "lineup")}`;
        for (const r of top.slice(1)) if (!r.why) r.why = r.pAfter >= 0.6 ? `Likely lasts to #${afterMine} (${Math.round(r.pAfter * 100)}%)` : "Next-best two-pick total";
      }

      // lineup: the fit model's starters, placed into slots (most restricted players first, UTIL last)
      const SL = this.SLOTS, keyOf = (i) => (SL[i] === "UTIL" ? `UTIL${i}` : SL[i]);
      const lineup = {}; SL.forEach((_, i) => { lineup[keyOf(i)] = null; });
      const st9 = fm.starters.slice().sort((a, b) => { const ca = this.slotMask(a), cb = this.slotMask(b); const pc = (x) => { let c = 0; for (; x; x &= x - 1) c++; return c; }; return pc(ca) - pc(cb) || S(b) - S(a); });
      const slotOrder = SL.map((_, i) => i).sort((x, y) => (SL[x] === "UTIL") - (SL[y] === "UTIL"));
      const place = (k, usedM) => {
        if (k === st9.length) return true;
        const em = this.slotMask(st9[k]);
        for (const i of slotOrder) if ((em & (1 << i)) && !(usedM & (1 << i))) { lineup[keyOf(i)] = st9[k]; if (place(k + 1, usedM | (1 << i))) return true; lineup[keyOf(i)] = null; }
        return false;
      };
      place(0, 0);
      const inLineup = new Set(Object.values(lineup).filter(Boolean));
      const bench = myRoster.filter((p) => !inLineup.has(p)).sort((a, b) => S(b) - S(a));
      const needs = SL.map((sl, i) => (lineup[keyOf(i)] ? null : sl)).filter((sl) => sl && sl !== "UTIL");
      const coverage = { G: 0, F: 0, C: 0 };
      for (const p of myRoster) { const em = this.slotMask(p); if (em & this.gBits) coverage.G++; if (em & this.fBits) coverage.F++; if (em & this.cBits) coverage.C++; }

      // where the points come from (per player, top 10)
      const profile = (ros) => {
        const top10 = ros.slice().sort((a, b) => (b.lv || 0) - (a.lv || 0)).slice(0, 10), k10 = Math.max(1, top10.length), out = {};
        for (const [k, fn] of SOURCES) out[k] = top10.reduce((acc, p) => acc + fn(p.s || [0, 0, 0, 0, 0, 0, 0, 0, 0]) * (p.a || 0), 0) / k10;
        return out;
      };
      const profiles = {}, power = [];
      for (let s = 1; s <= teams; s++) {
        profiles[s] = profile(rosters[s]);
        const vals = rosters[s].map((p) => p.lv || 0).sort((a, b) => b - a);
        power.push({ slot: s, total: vals.slice(0, 9).reduce((a, b) => a + b, 0) + 0.25 * vals.slice(9).reduce((a, b) => a + b, 0), n: rosters[s].length });
      }
      power.sort((a, b) => b.total - a.total);
      const active = Object.keys(profiles).filter((s) => rosters[s].length > 0);
      const lgAvg = {};
      for (const [k] of SOURCES) lgAvg[k] = active.length ? active.reduce((a, s) => a + profiles[s][k], 0) / active.length : 0;

      // room leaderboard
      const room = [];
      for (let t = 1; t <= teams; t++) {
        const mine = log.filter((e) => e.slot === t);
        const nextPick = (() => { for (let k = current; k <= total; k++) if (slotForPick(k, teams, reversal) === t) return k; return null; })();
        const sMean = post[t].mean;
        room.push({ slot: t, s: sMean, sd: post[t].sd, n: mine.length,
          label: mine.length < 2 ? "New" : sMean >= 0.7 ? "Sharp" : sMean >= 0.45 ? "Mixed" : "ADP-driven",
          captured: mine.length ? mine.reduce((a, e) => a + Math.min(1, e.pct), 0) / mine.length : null,
          reaches: mine.filter((e) => e.grade === "reach").length,
          steals: mine.filter((e) => e.pct >= 0.98 && e.adp != null && e.adp > e.pick_no + 6).length,
          nextPick, beforeMe: !!(nextPick && nextMine && nextPick < nextMine && t !== mySlot), me: t === mySlot });
      }
      room.sort((a, b) => b.s - a.s);

      // alerts
      const alerts = [];
      const last6 = log.slice(-6);
      if (last6.length === 6) {
        const nc = last6.filter((e) => e.pos && e.pos.includes("C")).length;
        const ng = last6.filter((e) => e.pos && (e.pos.includes("PG") || e.pos.includes("SG")) && !e.pos.includes("C")).length;
        if (nc >= 4) alerts.push({ kind: "run", text: `Center run: ${nc} of the last 6 picks` });
        if (ng >= 5) alerts.push({ kind: "run", text: `Guard run: ${ng} of the last 6 picks` });
      }
      for (const p of avail.slice(0, 12).filter((p) => p.adp + 8 < current).slice(0, 3)) alerts.push({ kind: "fall", text: `Falling: ${p.n} (ADP ${Math.round(p.adp)}) still here at pick ${current}` });
      if (cOnly >= 2) alerts.push({ kind: "cap", text: `You have ${cOnly} center-only players. They can only play C or UTIL, so ${cOnly >= 3 ? "another one would sit" : "a third would lock up your UTIL slots"}. Picks are scored for your lineup.` });
      const sharpBefore = room.filter((r) => r.beforeMe && r.label === "Sharp").length, before = room.filter((r) => r.beforeMe).length;
      if (before >= 3 && sharpBefore / before >= 0.6) alerts.push({ kind: "warn", text: `${sharpBefore} of ${before} managers picking before you are drafting sharp. Value targets won't fall.` });
      for (const n of this.news) alerts.push({ kind: "news", text: n });

      let deadline = null;
      if (draft && draft.status === "drafting") { const base = draft.last_picked || draft.start_time; if (base) deadline = base + timer * 1000; }

      const result = { mode, teams, rounds, total, current, done, onClock, mySlot, myPickList, upcoming, nextMine, afterMine, isMyTurn, horizon,
        picksUntilMine: nextMine ? nextMine - current : null, avail, fitAvail, recs: top, log, rosters, myRoster, lineup, bench, needs, coverage, starterValue: fm.best,
        profiles, lgAvg, power, room, alerts, cOnly, deadline, status: draft ? draft.status : "unknown",
        startTime: draft ? draft.start_time : null, myLog: log.filter((e) => e.mine) };
      this._memo = { k: memoKey, v: result };
      return result;
    }
  }

  const api = { Engine, norm, grade, GRADES, slotForPick, picksForSlot, scoreFppg, SOURCES, GRID, ROOM, rng };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WR_ENGINE = api;
})(typeof self !== "undefined" ? self : this);
