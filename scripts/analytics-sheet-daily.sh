#!/bin/bash
# Runs on the MDB mini at 6:10am (launchd: com.momsbot.board-analytics-sheet),
# after the 6:00 board rollover in Supabase. Env comes from the Vercel
# production env pulled to .env.production.local (`vercel env pull`).
set -euo pipefail
cd "$(dirname "$0")/.."
set -a
. ./.env.production.local
SUPABASE_URL=https://lufrguiekfkhtxsgcqjo.supabase.co
set +a
exec /opt/homebrew/bin/node scripts/analytics-sheet.mjs --direct --upload
