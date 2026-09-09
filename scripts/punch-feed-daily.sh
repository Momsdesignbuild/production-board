#!/bin/bash
# MDB mini, weekdays 6:30–9:30 every 15 min (launchd: com.momsbot.board-punch-feed).
# Writes today's first BuilderTrend punch per person into crew_punches for Hammer Time.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env.sheet; set +a
exec /opt/homebrew/bin/node scripts/punch-feed.mjs
