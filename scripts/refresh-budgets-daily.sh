#!/bin/bash
# Runs on the MDB mini at 6:20am (launchd: com.momsbot.board-budgets), after the 6:00 rollover. Env: .env.sheet.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a
. ./.env.sheet
set +a
exec /opt/homebrew/bin/node scripts/refresh-budgets.mjs --write
