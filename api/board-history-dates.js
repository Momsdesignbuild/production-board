// Lightweight companion to board-history.js — powers the calendar grid's
// checkmarks. Returns just the list of dates that have a snapshot in a
// range, never the actual board data (which can be several MB of photos
// per day), so painting a month view stays cheap.

const SUPABASE_URL = process.env.SUPABASE_URL || "https://lufrguiekfkhtxsgcqjo.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function isValidDate(d) {
  return typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(new Date(d + "T00:00:00Z").getTime());
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }
  if (!SERVICE_KEY) {
    res.status(500).json({ error: "server isn't configured (SUPABASE_SERVICE_ROLE_KEY)" });
    return;
  }

  const { start, end } = req.query || {};
  if (!isValidDate(start) || !isValidDate(end) || start > end) {
    res.status(400).json({ error: "invalid start/end (expected YYYY-MM-DD, start <= end)" });
    return;
  }

  try {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/board_history?date=gte.${start}&date=lte.${end}&select=date`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    );
    if (!resp.ok) throw new Error(`board_history read failed: ${resp.status}`);
    const rows = await resp.json();
    res.status(200).json({ dates: rows.map((r) => r.date) });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
}
