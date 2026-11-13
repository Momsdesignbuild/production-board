#!/bin/bash
# MDB mini, every 5 min (launchd: com.momsbot.board-punch-log). BuilderTrend shifts for the Trench/Hammer rosters -> crew_log for the Logs popup.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env.sheet; set +a
exec /opt/homebrew/bin/node scripts/punch-log.mjs
