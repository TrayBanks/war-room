---
name: refresh-rankings
description: Refresh projections, ADP, injuries and teams from Sleeper and rebuild the Lock-In rankings, extension data and Top 120. Use before a draft, after big news, or when asked to update the rankings.
---

# Refresh rankings

1. `python3 tools/fetch_sleeper.py` (add `--add 260` to pull in new names under ADP 260, `--schedule` after schedule changes). If the network blocks api.sleeper.com, fetch `https://api.sleeper.com/projections/nba/2026?season_type=regular` from a browser tab on sleeper.com, save the JSON, and pass `--from-file`.
2. Review what changed (team changes, new injuries). Availability judgment calls live in `OVERRIDE` in model/build_ext.py; update them when news warrants (a player newly out for weeks, a load-management announcement) and say which ones you changed.
3. New players have no game-log spread; they get the pool spread (0.348) shrunk in. That's expected.
4. `npm run build` → extension/data.js and reports/top120.md/csv.
5. `npm test`. All five suites must pass.
6. Summarize for Tray: biggest risers and fallers vs the previous top120 (diff the CSV ranks), any injuries in the top 60, and anything that changes the draft plan.
7. If he needs the extension updated: `npm run package` and send the zip (reload the unpacked extension in chrome://extensions).
