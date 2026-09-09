// Powers the calendar/history view: GET a snapshot for any date (100 years
// back to 100 years forward), POST a plan for a future date. Past dates are
// read-only — the whole point of history is that it doesn't change. Today
// is always live (mirrors board_state, see save-board.js). Future dates are
// a plan sitting in board_history until that day actually arrives.

import crypto from "node:crypto";
import { todayStr } from "../lib/today.js";
import { promotePlan } from "../lib/promote.js";

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

function isValidDate(d) {
  return typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(new Date(d + "T00:00:00Z").getTime());
}

function withinRange(d) {
  const target = new Date(d + "T00:00:00Z").getFullYear();
  const now = new Date().getFullYear();
  return target >= now - 100 && target <= now + 100;
}

export default async function handler(req, res) {
  if (!SERVICE_KEY) {
    res.status(500).json({ error: "server isn't configured (SUPABASE_SERVICE_ROLE_KEY)" });
    return;
  }

  if (req.method === "GET") {
    const date = req.query?.date;
    if (!isValidDate(date) || !withinRange(date)) {
      res.status(400).json({ error: "invalid or out-of-range date (must be within 100 years)" });
      return;
    }
    const today = todayStr();

    try {
      if (date === today) {
        await promotePlan(SUPABASE_URL, SERVICE_KEY); // day rollover: plan → live if not yet
        const resp = await fetch(`${SUPABASE_URL}/rest/v1/board_state?id=eq.1&select=data`, {
          headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
        });
        if (!resp.ok) throw new Error(`board_state read failed: ${resp.status}`);
        const rows = await resp.json();
        res.status(200).json({ date, data: rows[0]?.data ?? null, editable: true, isToday: true, hasPlan: true });
        return;
      }

      const resp = await fetch(`${SUPABASE_URL}/rest/v1/board_history?date=eq.${date}&select=data`, {
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      });
      if (!resp.ok) throw new Error(`board_history read failed: ${resp.status}`);
      const rows = await resp.json();

      if (rows[0]) {
        // a plan/snapshot already exists for this date — show exactly that
        res.status(200).json({ date, data: rows[0].data, editable: date > today, isToday: false, hasPlan: true });
        return;
      }

      if (date > today) {
        // unplanned future day: NEVER show a blank board here. Roll today's
        // current live badges forward as the starting point, same as what
        // tomorrow will actually look like if nothing changes between now
        // and then. Saving from here is what turns this into a real plan.
        const liveResp = await fetch(`${SUPABASE_URL}/rest/v1/board_state?id=eq.1&select=data`, {
          headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
        });
        if (!liveResp.ok) throw new Error(`board_state read failed: ${liveResp.status}`);
        const liveRows = await liveResp.json();
        res.status(200).json({ date, data: liveRows[0]?.data ?? null, editable: true, isToday: false, hasPlan: false });
        return;
      }

      // past date, nothing recorded — genuinely nothing to show
      res.status(200).json({ date, data: null, editable: false, isToday: false, hasPlan: false });
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
    return;
  }

  if (req.method === "POST") {
    if (!SECRET) {
      res.status(500).json({ error: "server isn't configured (SESSION_SECRET)" });
      return;
    }
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    const session = verify(token);
    if (!session) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    const { date, data } = req.body || {};
    if (!isValidDate(date) || !withinRange(date)) {
      res.status(400).json({ error: "invalid or out-of-range date (must be within 100 years)" });
      return;
    }
    if (!data || typeof data !== "object") {
      res.status(400).json({ error: "missing data" });
      return;
    }
    const today = todayStr();
    if (date <= today) {
      res.status(403).json({ error: "past and today are read-only here — today's board is edited via /api/save-board" });
      return;
    }

    try {
      const resp = await fetch(`${SUPABASE_URL}/rest/v1/board_history`, {
        method: "POST",
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify({ date, data, updated_at: new Date().toISOString() }),
      });
      if (!resp.ok) throw new Error(`board_history write failed: ${resp.status}`);
      res.status(200).json({ ok: true });
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
    return;
  }

  res.status(405).json({ error: "method not allowed" });
}
