-- Where the daily analytics workbook lives in OneDrive (a view-only share
-- link). Written by scripts/analytics-sheet.mjs after each upload; read by
-- /api/analytics so the modal can link to it.
ALTER TABLE "public"."board_config" ADD COLUMN IF NOT EXISTS "analytics_sheet_url" text;
