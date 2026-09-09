// Thin HTTP wrapper — the math lives in lib/analytics.js so the daily Excel
// job on the MDB mini can run it against the database directly (the Vercel
// URL is behind SSO, so machines can't call this endpoint).
import { computeAnalytics } from "../lib/analytics.js";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://lufrguiekfkhtxsgcqjo.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  if (req.method !== "GET") { res.status(405).json({ error: "method not allowed" }); return; }
  if (!SERVICE_KEY) { res.status(500).json({ error: "server isn't configured (SUPABASE_SERVICE_ROLE_KEY)" }); return; }
  try {
    res.status(200).json(await computeAnalytics(SUPABASE_URL, SERVICE_KEY));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
}
