#!/usr/bin/env bash
# One full War Room refresh: Sleeper's public API -> lock calls, season sims, trending -> the page.
# Used by .github/workflows/refresh.yml.   tools/refresh.sh [site_dir]      (WR_DATE=YYYY-MM-DD skips the pull)
set -euo pipefail
cd "$(dirname "$0")/.."
SITE="${1:-site}"
D="${WR_DATE:-$(node tools/sleeper_pull.js)}"
L=data/live
node tools/week_page.js "$L/week_$D.json"
node tools/season_report.js "$L/league_$D.json" "$L/extras_$D.json" "$L/weekproj_$D.json" | sed -n 2p
WR_SD=30 WR_TAG=_wide node tools/season_report.js "$L/league_$D.json" "$L/extras_$D.json" "$L/weekproj_$D.json" > /dev/null
node tools/trending.js "$L/trending_$D.json" "$L/league_$D.json" "$L/extras_$D.json" > /dev/null
python3 tools/build_season_page.py "$D" --site "$SITE"
