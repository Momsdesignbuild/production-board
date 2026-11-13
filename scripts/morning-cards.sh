#!/bin/bash
# MDB mini, weekdays 7:30 (launchd: com.momsbot.board-morning-cards). Posts Trench + Hammer cards from BuilderTrend + Outlook.
# Channel: dev (#mdb-bot-dev) until Josh says go-live; then set MORNING_CARDS_CHANNEL=real in the plist.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env.sheet; set +a
exec /opt/homebrew/bin/node scripts/morning-cards.mjs --channel "${MORNING_CARDS_CHANNEL:-dev}"
