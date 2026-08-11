// One-time cleanup: converts every badge's externally-hosted photo (EZOfficeInventory
// S3 links, OneDrive/SharePoint thumbnail links) into a permanent embedded
// data: URL, the same way a manually-added badge's photo is stored. Those
// external links are all signed with an expiry (EZO's is ~12h) — now that
// sync is gone and nothing will ever refresh them again, this is what stops
// every already-placed badge from eventually going gray forever.
//
// Safe to run more than once — anything already a data: URL is left alone.

import crypto from "node:crypto";

const SECRET = process.env.SESSION_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL || "https://lufrguiekfkhtxsgcqjo.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// a badge only ever renders at ~90px — cap what we'll embed so a handful of
// multi-MB phone-camera originals can't bloat board_state unreasonably.
const MAX_BYTES = 1.5 * 1024 * 1024;

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

async function toDataUrl(url) {
  const resp = await fetch(url);
  if (!resp.ok) return null;
  const contentType = (resp.headers.get("content-type") || "image/jpeg").split(";")[0];
  const buf = Buffer.from(await resp.arrayBuffer());
  if (buf.length > MAX_BYTES) return null;
  return `data:${contentType};base64,${buf.toString("base64")}`;
}

// bounded concurrency — dozens of images fetched one-at-a-time would blow
// past the function timeout; all at once risks rate limits on the source.
async function mapThrottled(items, concurrency, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
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

    const targets = cards.filter((c) => c.photo && /^https?:\/\//i.test(c.photo));

    let converted = 0;
    let failed = 0;
    await mapThrottled(targets, 6, async (card) => {
      const dataUrl = await toDataUrl(card.photo).catch(() => null);
      if (dataUrl) {
        card.photo = dataUrl;
        converted++;
      } else {
        // leave the existing (possibly already-dead) link alone — overwriting
        // it with null on a failed fetch is what wiped out ~150 badges' photos
        // in one shot the first time this ran. A dead link a viewer never
        // sees isn't worse than an explicit null; it's also still recoverable
        // later (via /api/recover-photos), whereas null loses that option.
        failed++;
      }
    });

    if (targets.length > 0) {
      const patchResp = await fetch(`${SUPABASE_URL}/rest/v1/board_state?id=eq.1`, {
        method: "PATCH",
        headers: { ...supaHeaders, Prefer: "return=minimal" },
        body: JSON.stringify({ data: state, updated_at: new Date().toISOString() }),
      });
      if (!patchResp.ok) throw new Error(`board_state write failed: ${patchResp.status}`);
    }

    res.status(200).json({ ok: true, totalCards: cards.length, examined: targets.length, converted, failed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
