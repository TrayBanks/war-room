---
name: sleeper-api
description: Reference for Sleeper's public NBA API endpoints and field formats used by the War Room (verified Oct 17, 2026). Use when fetching league, draft, roster, schedule, stats or projection data.
---

# Sleeper public API (no auth, read-only)

Base A: `https://api.sleeper.app/v1` · Base B: `https://api.sleeper.com`

| What | Endpoint | Shape |
|---|---|---|
| Season state | A `/state/nba` | `{week, season, season_type, season_start_date, display_week}` (2026: week 1 starts 2026-10-20) |
| League | A `/league/{id}` | `sport`, `season`, `roster_positions`, `scoring_settings`, `settings` |
| Users | A `/league/{id}/users` | `[{user_id, display_name, metadata.team_name}]` |
| Rosters | A `/league/{id}/rosters` | `[{roster_id, owner_id, co_owners, players[], starters[]}]` ("0" = empty slot) |
| Matchups | A `/league/{id}/matchups/{week}` | `[{roster_id, matchup_id, starters, players_points, points}]` (standard shape; Lock-In fields not verified yet, check once week 1 starts) |
| Draft | A `/draft/{id}` | `status` (pre_draft/drafting/complete), `start_time`, `last_picked`, `draft_order {user_id: slot}`, `settings {teams, rounds, pick_timer, reversal_round}` |
| Picks | A `/draft/{id}/picks` | `[{pick_no, round, draft_slot, player_id, picked_by, metadata}]` |
| Projections | B `/projections/nba/2026?season_type=regular` | `[{player_id, date, game_id, stats: {pts, reb, ast, stl, blk, to, tpm, dd, td, sp, adp_std, …}, player: {first_name, last_name, team, fantasy_positions, injury_status}}]` — per-game rows; in season there is **no `pts_std`**: score it from the box-score stats with the league weights (tools/sleeper_pull.js does) |
| Trending | A `/players/nba/trending/add` (or `/drop`) `?lookback_hours=48&limit=25` | `[{player_id, count}]` across all of Sleeper |
| All players | A `/players/nba` | `{player_id: {full_name, team, fantasy_positions, injury_status, …}}` (~5 MB; fine once per refresh) |
| Week stats | B `/stats/nba/{season}/{week}?season_type=regular` | one row per player-game: `{player_id, date, team, opponent, game_id, week, stats: {pts_std, sp, pts, reb, …}}`; `sp` = seconds played, 0 = DNP |
| Player game log | B `/stats/nba/player/{id}?season_type=regular&season=2025&grouping=week` | per-week groups of games |
| Schedule | B `/schedule/nba/regular/{season}` | `[{date, week, status (pre_game/in_game/complete), home: {team}, away: {team}, game_id}]` |

Notes
- Dates are US Eastern game dates. Fantasy weeks run Mon–Sun.
- `pts_std` equals this league's scoring exactly.
- Never call authenticated endpoints and never read the user's token; `localStorage.user_id` is enough to find his team.
- Matchups (verified week 1): `starters_points` is the league's counted number per starter, including a live partial score while his game is on. There is still no lock field; tools/week_page.js infers a lock once a starter plays again (counted points match an earlier game), and data/locks.json + the page's "Mark locked" cover the rest.
- Rosters carry `settings.wins/losses/ties` (the real record).
- Some sandboxes block these hosts from the shell; GitHub Actions runners reach them fine. Fetching from a page on sleeper.com (browser JS) works with CORS.
