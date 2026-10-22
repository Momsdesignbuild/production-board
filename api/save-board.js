import { todayStr } from "../lib/today.js";
import { boardOf } from "../lib/boards.js";
import { shareBadges, fillTray } from "../lib/share.js";
// The only path allowed to write board_state now — the browser used to talk
// to Supabase directly with the (necessarily public) anon key, which meant
// anyone who viewed page source could write/delete board data with no auth
// at all. Now the anon key only has SELECT on board_state; every write goes
// through here, gated by a signed session token from api/unlock.js, and
// performed with the service-role key (server-only, never shipped to the
// browser).

import crypto from "node:crypto";

const SECRET = process.env.SESSION_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL || "https://lufrguiekfkhtxsgcqjo.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function verify(token) {
  if (!token) return null;
  const parts = String(token).split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  if (sig !== expected) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString());
  } catch (e) {
    return null;
  }
  if (!payload.exp || Date.now() > payload.exp) return null;
  return payload;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }
  if (!SECRET || !SERVICE_KEY) {
    res.status(500).json({ error: "server isn't configured (SESSION_SECRET / SUPABASE_SERVICE_ROLE_KEY)" });
    return;
  }

  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  const session = verify(token);
  if (!session) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const { data, board } = req.body || {};
  const { id: boardId, history } = boardOf(board); // LA (default) or R&C
  if (!data || typeof data !== "object") {
    res.status(400).json({ error: "missing data" });
    return;
  }

  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/board_state?id=eq.${boardId}`, {
      method: "PATCH",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ data, updated_at: new Date().toISOString() }),
    });
    if (!resp.ok) throw new Error(`board_state write failed: ${resp.status}`);
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err.message });
    return;
  }

  // best-effort: one badge, one board — pull what this board placed out of the other board's layout
  try {
    const otherId = boardId === 1 ? 2 : 1;
    const h = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" };
    const [o] = await (await fetch(`${SUPABASE_URL}/rest/v1/board_state?id=eq.${otherId}&select=data`, { headers: h })).json();
    const r = o && shareBadges(data, o.data || {});
    const patch = async (id, d) => { const w = await fetch(`${SUPABASE_URL}/rest/v1/board_state?id=eq.${id}`, { method: "PATCH", headers: { ...h, Prefer: "return=minimal" }, body: JSON.stringify({ data: d, updated_at: new Date().toISOString() }) }); if (!w.ok) console.error("badge sync write failed", id, w.status); };
    if (r && r.changed) await patch(otherId, r.data);
    const f = o && fillTray(o.data || {}, data);
    if (f && f.changed) await patch(boardId, { ...f.data, saveId: "srv" + Date.now().toString(36) }); // new saveId so the saving tab applies it
  } catch (e) { /* the save itself already succeeded */ }

  // best-effort: mirror today's live save into board_history so the
  // history/calendar view has a same-day snapshot. Never blocks or fails
  // the response above — the live save already succeeded by this point.
  try {
    const today = todayStr();
    await fetch(`${SUPABASE_URL}/rest/v1/${history}`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({ date: today, data, updated_at: new Date().toISOString() }),
    });
  } catch (err) {
    console.error("board_history snapshot failed (non-fatal):", err.message);
  }
}
