#!/bin/bash
# Runs on the MDB mini at 6:10am (launchd: com.momsbot.board-analytics-sheet),
# after the 6:00 board rollover in Supabase. Env comes from .env.sheet on the
# mini (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MDB_TENANT_ID, MDB_CLIENT_ID,
# MDB_CLIENT_SECRET, MDB_DRIVE_ID) — Vercel masks sensitive values on pull, so
# it was assembled by hand from the Supabase CLI + moms-bot's .env.brain.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a
. ./.env.sheet
set +a
exec /opt/homebrew/bin/node scripts/analytics-sheet.mjs --direct --upload
