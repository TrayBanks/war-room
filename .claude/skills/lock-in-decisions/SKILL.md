---
name: lock-in-decisions
description: Decide Lock or Hold for Tray's starters this week in NBA League Revamped (Sleeper Lock-In, one game per starter per week). Use for "should I lock X", weekly lock plans, or explaining a lock line.
---

# Lock-In decisions

The rule: each starter counts one game per week (Mon–Sun). After a game you can lock it before his next tip-off; otherwise his last game counts. Only started games can be locked.

## Steps

1. Get the facts for each player in question: the score of the game he just played, how many games his team has left this week (Mon–Sun, Eastern dates), and injury status. From Sleeper (see the sleeper-api skill): `/v1/league/1398532731020828672/rosters` (Tray's roster has `owner_id` 107261208461459456; `starters`), `schedule/nba/regular/2026` (games with `week`, `date`, `status`), `stats/nba/2026/<week>?season_type=regular` (rows with `date`, `team`, `stats.pts_std`, `stats.sp` seconds played; sp 0 = DNP).
2. Ignore partial stats from a game in progress and wait if a finished game has no stat line yet.
3. Whole matchup at once: save the week's data as a payload (format at the top of tools/week_calls.js; pull it from a browser tab on sleeper.com if the shell can't reach the API) and run `node tools/week_calls.js payload.json auto`. It scores both sides, projects final totals, picks the risk mode (down 15+ → chase, up 15+ → protect) and gives each starter's call. For one player:
   Run the calculator: `npm run lock -- "<player>" <score> <games left> [even|chase|protect]`. Players not in data: `npm run lock -- --avg <fppg> [--cv 0.35] <score> <left>`.
4. Pick the risk mode from the matchup: underdog → chase, clear favorite → protect, otherwise even.
5. Answer per player: Lock or Hold, the lock line, what waiting is worth, and when the next decision comes (his next game day). Lead with the players who must be decided before tonight's games.

## Reading the numbers

- The lock line T_k is where locking and waiting are worth the same. It falls as games run out; with 1 game left it sits near his average (a bit under, because he might sit).
- Volatile players (high ±%) have higher lines: their best game is likely still ahead.
- A questionable/doubtful tag cuts his play probability to 60% of normal, which lowers the line.
- Backtest (Nov 17–23, 2025, Tray's mock roster): following the calls scored 399 vs 353 letting last games ride.
