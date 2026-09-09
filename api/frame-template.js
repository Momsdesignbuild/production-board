// Returns the currently active frame template's job_rows — this is what
// used to be the hardcoded JOB_ROWS constant in index.html. Read-only, no
// auth, same trust level as reading the live board itself.

const SUPABASE_URL = process.env.SUPABASE_URL || "https://lufrguiekfkhtxsgcqjo.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }
  if (!SERVICE_KEY) {
    res.status(500).json({ error: "server isn't configured (SUPABASE_SERVICE_ROLE_KEY)" });
    return;
  }

  try {
    const configResp = await fetch(`${SUPABASE_URL}/rest/v1/board_config?id=eq.1&select=active_frame_template_id`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    if (!configResp.ok) throw new Error(`board_config read failed: ${configResp.status}`);
    const configRows = await configResp.json();
    const activeId = configRows[0]?.active_frame_template_id;
    if (!activeId) {
      res.status(200).json({ id: null, name: null, job_rows: [] });
      return;
    }

    const tplResp = await fetch(`${SUPABASE_URL}/rest/v1/frame_templates?id=eq.${activeId}&select=id,name,job_rows`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    if (!tplResp.ok) throw new Error(`frame_templates read failed: ${tplResp.status}`);
    const tplRows = await tplResp.json();
    res.status(200).json(tplRows[0] || { id: null, name: null, job_rows: [] });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
}
