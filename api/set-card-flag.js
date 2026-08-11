// Tiny admin utility: flips ONE boolean field on ONE card, matched by
// ezoId, via a fresh server-side read-modify-write. Used instead of
// round-tripping the whole board through the browser (which risks a race
// against whatever the live board is doing) when only a single field on a
// single card needs to change.

import crypto from "node:crypto";

const SECRET = process.env.SESSION_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL || "https://lufrguiekfkhtxsgcqjo.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ALLOWED_FIELDS = ["showBar"];

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
  if (!verify(token)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const { ezoId, field, value } = req.body || {};
  if (!ezoId || !ALLOWED_FIELDS.includes(field)) {
    res.status(400).json({ error: "bad request — need ezoId and an allowed field" });
    return;
  }

  try {
    const supaHeaders = {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    };
    const getResp = await fetch(`${SUPABASE_URL}/rest/v1/board_state?id=eq.1&select=data`, { headers: supaHeaders });
    if (!getResp.ok) throw new Error(`board_state read failed: ${getResp.status}`);
    const rows = await getResp.json();
    const state = (rows[0] && rows[0].data) || {};
    const cards = state.cards || [];
    const matches = cards.filter((c) => c.ezoId === ezoId);
    if (!matches.length) {
      res.status(404).json({ error: "no card with that ezoId" });
      return;
    }
    matches.forEach((c) => {
      if (value) c[field] = true;
      else delete c[field];
    });

    const patchResp = await fetch(`${SUPABASE_URL}/rest/v1/board_state?id=eq.1`, {
      method: "PATCH",
      headers: { ...supaHeaders, Prefer: "return=minimal" },
      body: JSON.stringify({ data: state, updated_at: new Date().toISOString() }),
    });
    if (!patchResp.ok) throw new Error(`board_state write failed: ${patchResp.status}`);

    res.status(200).json({ ok: true, matched: matches.length, labels: matches.map((c) => c.label) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
