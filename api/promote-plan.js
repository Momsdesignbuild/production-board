// Called by the client before every Load and at day change. No auth: it only
// ever copies an already-saved plan into live, and only once per day.
import { promotePlan } from "../lib/promote.js";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://lufrguiekfkhtxsgcqjo.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  if (!SERVICE_KEY) { res.status(500).json({ error: "server isn't configured (SUPABASE_SERVICE_ROLE_KEY)" }); return; }
  try {
    res.status(200).json(await promotePlan(SUPABASE_URL, SERVICE_KEY));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
}
