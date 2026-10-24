#!/usr/bin/env node
// Pull everything the War Room needs from Sleeper's public API (no auth) and shape it into the compact files the
// models read. Runs in Node 18+ (GitHub Actions) and, for testing, in any browser page (paste, then WRPull.pull()).
//   node tools/sleeper_pull.js            -> data/live/{league,extras,trending,week}_<ET date>.json, prints the date
// Files:
//   league   users, settings, draft order, rosters, real draft picks, matchup ids for weeks 1-18, finished-week points,
//            actual records, current week + live points
//   extras   players the model doesn't know (rostered or top free agents), injuries, free-agent pool
//   trending Sleeper's most added / dropped (48 h) with each player's latest games, owner and teammates out
//   week     the current matchup for week_calls.js / week_page.js: both lineups, official points, box scores, schedule
(function (root) {
  "use strict";
  const A = "https://api.sleeper.app/v1", B = "https://api.sleeper.com";
  const LEAGUE = "1398532731020828672", ME = "107261208461459456";
  const etDate = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

  async function pull(opts) {
    const o = opts || {};
    // every request gets a 20 s timeout and one retry, so a hung connection can't stall the refresh
    const get1 = async (u) => { const r = await fetch(u, { signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new Error(`${r.status} ${u}`); return r.json(); };
    const get = o.fetchJson || (async (u) => { try { return await get1(u); } catch (e) { await new Promise((ok) => setTimeout(ok, 1500)); return get1(u); } });
    const now = o.now || new Date();
    const today = etDate(now);
    const modelIds = new Set((o.modelIds || []).map(String));

    const [state, league, users, rosters] = await Promise.all([
      get(`${A}/state/nba`), get(`${A}/league/${LEAGUE}`), get(`${A}/league/${LEAGUE}/users`), get(`${A}/league/${LEAGUE}/rosters`)]);
    const season = String(league.season || state.season);
    const regWeeks = (league.settings.playoff_week_start || 19) - 1;
    const [draft, picks, players, projRows, sched, tAdd, tDrop] = await Promise.all([
      get(`${A}/draft/${league.draft_id}`), get(`${A}/draft/${league.draft_id}/picks`), get(`${A}/players/nba`),
      get(`${B}/projections/nba/${season}?season_type=regular`), get(`${B}/schedule/nba/regular/${season}`),
      get(`${A}/players/nba/trending/add?lookback_hours=48&limit=25`), get(`${A}/players/nba/trending/drop?lookback_hours=48&limit=25`)]);
    const matchups = await Promise.all(Array.from({ length: regWeeks }, (_, i) => get(`${A}/league/${LEAGUE}/matchups/${i + 1}`)));

    // current fantasy week: the week of today's games, else the next game day's week
    const upcoming = sched.filter((g) => g.date >= today).sort((a, b) => a.date.localeCompare(b.date));
    const cur = Math.min(regWeeks, Math.max(1, (upcoming[0] && upcoming[0].week) || state.week || regWeeks));
    const [stats, prevStats] = await Promise.all([
      get(`${B}/stats/nba/${season}/${cur}?season_type=regular`), cur > 1 ? get(`${B}/stats/nba/${season}/${cur - 1}?season_type=regular`) : Promise.resolve([])]);

    const P = (id) => players[id] || {};
    const nameOf = (id) => { const p = P(id); return p.full_name || [p.first_name, p.last_name].filter(Boolean).join(" ") || String(id); };
    const posOf = (id) => (P(id).fantasy_positions || []).join("/");
    const injOf = (id) => P(id).injury_status || "";
    // projections come as per-game rows of box-score stats (no pts_std): average each player's rows, score with the league
    const SCORE = { pts: 0.5, tpm: 0.5, reb: 1, ast: 1, stl: 2, blk: 2, to: -1, dd: 1, td: 2 };
    const acc = {};
    for (const r of projRows) {
      const s = r.stats || {}, id = String(r.player_id);
      const fp = s.pts_std != null ? +s.pts_std : Object.entries(SCORE).reduce((a, [k, w]) => a + w * (+s[k] || 0), 0);
      const a = (acc[id] = acc[id] || { fp: 0, n: 0, adp: null });
      if (s.pts != null || s.pts_std != null) { a.fp += fp; a.n++; }
      if (s.adp_std != null) a.adp = +s.adp_std;
    }
    const fppg = (id) => (acc[id] && acc[id].n ? +(acc[id].fp / acc[id].n).toFixed(2) : null);
    const adpOf = (id) => (acc[id] && acc[id].adp != null ? +acc[id].adp.toFixed(1) : null);
    const proj = acc;

    rosters.sort((a, b) => a.roster_id - b.roster_id);
    const ownerOf = {};
    for (const r of rosters) for (const id of r.players || []) ownerOf[id] = r.roster_id;
    const mine = rosters.find((r) => r.owner_id === ME);

    // ---------- league ----------
    const results = [];
    for (let w = 1; w < cur; w++) results.push(Object.fromEntries(matchups[w - 1].map((m) => [m.roster_id, +(m.points || 0).toFixed(2)])));
    // the current week's matchup is read three times and settled by majority (Sleeper's replicas can disagree)
    const WKL = typeof require !== "undefined" ? require("./lockweek.js") : root.WR_WEEK;
    const extra2 = await Promise.all([1, 2].map((i) => get(`${A}/league/${LEAGUE}/matchups/${cur}?r=${Date.now()}${i}`).catch(() => null)));
    const reads = [matchups[cur - 1], ...extra2].filter(Boolean);
    const curRows = rosters.map((r) => WKL.consensus(reads, r.roster_id)).filter(Boolean);
    const LG = {
      asof: today, asofTs: now.toISOString(), curWeek: cur, myRid: mine.roster_id,
      users: Object.fromEntries(users.map((u) => [u.user_id, [u.display_name, (u.metadata && u.metadata.team_name) || ""]])),
      settings: { playoff_teams: league.settings.playoff_teams, playoff_week_start: league.settings.playoff_week_start,
        waiver_type: league.settings.waiver_type === 2 ? "FAAB" : String(league.settings.waiver_type), waiver_budget: league.settings.waiver_budget,
        trade_deadline: league.settings.trade_deadline, reserve_slots: league.settings.reserve_slots },
      slots: (league.roster_positions || []).filter((s) => s !== "BN"),
      draft_order: draft.draft_order,
      rosters: rosters.map((r) => [r.roster_id, r.owner_id, r.players || [], r.starters || [], r.reserve || []]),
      picks: picks.slice().sort((a, b) => a.pick_no - b.pick_no).map((p) => [p.player_id, p.draft_slot]),
      weeks: matchups.map((ms) => { const byR = Object.fromEntries(ms.map((m) => [m.roster_id, m.matchup_id])); return rosters.map((r) => byR[r.roster_id] || 0); }),
      results,
      record: Object.fromEntries(rosters.map((r) => [r.roster_id, [r.settings.wins || 0, r.settings.losses || 0, r.settings.ties || 0]])),
      cur: Object.fromEntries(curRows.map((m) => [m.roster_id, +(m.points || 0).toFixed(2)])),
    };

    // ---------- extras ----------
    const rostered = new Set(Object.keys(ownerOf));
    const extra = {};
    for (const id of rostered) if (!modelIds.has(id)) extra[id] = [nameOf(id), P(id).team || "", posOf(id) || "UTIL", injOf(id), fppg(id) || 8, adpOf(id) || 300];
    const inj = {};
    for (const [id, p] of Object.entries(players)) if (p.injury_status && p.team) inj[id] = p.injury_status;
    const fa = Object.keys(proj).filter((id) => !rostered.has(id) && P(id).team && fppg(id) != null)
      .sort((a, b) => fppg(b) - fppg(a)).slice(0, 60).map((id) => [id, nameOf(id), P(id).team, posOf(id) || "UTIL", injOf(id), fppg(id)]);

    // ---------- trending ----------
    const logs = {};
    for (const r of prevStats.concat(stats)) (logs[r.player_id] = logs[r.player_id] || []).push(r);
    const lastGames = (id) => (logs[id] || []).slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 2).map((r) => {
      const s = r.stats || {};
      return [r.date.slice(5), r.opponent || "", +(s.pts_std || 0).toFixed(1), Math.round((s.sp || 0) / 60), s.pts || 0, s.reb || 0, s.ast || 0, (s.stl || 0) + (s.blk || 0)];
    });
    const trow = (t) => { const id = String(t.player_id); return [id, t.count, nameOf(id), P(id).team || "", posOf(id), injOf(id), fppg(id), adpOf(id), ownerOf[id] || 0, lastGames(id)]; };
    const injured = {};
    for (const [id, p] of Object.entries(players)) if (p.team && p.injury_status === "Out") (injured[p.team] = injured[p.team] || []).push(`${nameOf(id)} Out`);
    const TR = { asof: today, lookback_hours: 48, add: tAdd.map(trow), drop: tDrop.map(trow), injured, context: {}, short: {} };

    // ---------- this week's matchup ----------
    const myRow = curRows.find((m) => m.roster_id === mine.roster_id) || {};
    const oppRow = curRows.find((m) => m.matchup_id === myRow.matchup_id && m.roster_id !== mine.roster_id) || {};
    const oppRoster = rosters.find((r) => r.roster_id === oppRow.roster_id) || {};
    const userName = (uid) => (LG.users[uid] || [uid])[0];
    const side = (row, r) => ({ rid: r.roster_id, name: userName(r.owner_id), starters: (row.starters || []).map(String), starters_points: row.starters_points || [], points: row.points || 0,
      unsure: row.unsure || [], agree: row.agree !== false,
      bench: (r.players || []).filter((id) => !(row.starters || []).includes(id) && !(r.reserve || []).includes(id)) });
    const ids = new Set([...(mine.players || []), ...(oppRow.starters || [])].map(String));
    const WK = {
      today, week: cur, season, league: LEAGUE, slots: LG.slots,
      me: side(myRow, mine), opp: oppRoster.roster_id ? side(oppRow, oppRoster) : null,
      P: Object.fromEntries([...ids].map((id) => [id, [nameOf(id), P(id).team || "", posOf(id), injOf(id), fppg(id)]])),
      rows: stats.filter((r) => ids.has(String(r.player_id))).map((r) => [String(r.player_id), r.date, r.team, +((r.stats || {}).pts_std || 0), (r.stats || {}).sp || 0]),
      games: sched.filter((g) => g.week === cur).map((g) => [g.date, g.home.team, g.away.team, g.status]),
    };
    return { date: today, league: LG, extras: { extra, inj, fa }, trending: TR, week: WK };
  }

  const api = { pull, etDate };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WRPull = api;

  if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
    (async () => {
      const fs = require("fs"), path = require("path"), vm = require("vm");
      const base = path.join(__dirname, "..");
      const ctx = {}; vm.createContext(ctx);
      vm.runInContext(fs.readFileSync(path.join(base, "extension/data.js"), "utf8") + ";this.WR_DATA=WR_DATA;", ctx);
      const out = await pull({ modelIds: ctx.WR_DATA.players.map((p) => p.id) });
      const dir = path.join(base, "data", "live");
      fs.mkdirSync(dir, { recursive: true });
      for (const k of ["league", "extras", "trending", "week"]) fs.writeFileSync(path.join(dir, `${k}_${out.date}.json`), JSON.stringify(out[k]));
      console.error(`pulled week ${out.league.curWeek} as of ${out.league.asofTs}`);
      console.log(out.date);
    })().catch((e) => { console.error(e); process.exit(1); });
  }
})(typeof self !== "undefined" ? self : this);
