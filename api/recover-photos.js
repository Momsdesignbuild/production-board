// One-time recovery: migrate-photos.js had a bug — when a badge's old
// EZOfficeInventory/OneDrive link had already expired, it wrote `photo:
// null` instead of leaving the card alone, wiping out ~150 badges' photos
// at once. This re-pulls fresh signed URLs straight from EZO/OneDrive one
// more time (matched by the ezoId already stored on each card) and embeds
// them permanently, same as migrate-photos was supposed to do. Only touches
// cards that currently have no photo — anything already showing an image
// (including a manually-added one) is left completely alone.

import crypto from "node:crypto";
import assetsHandler from "./assets.js";
import employeesHandler from "./employees.js";

const SECRET = process.env.SESSION_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL || "https://lufrguiekfkhtxsgcqjo.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
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

function captureJson(handlerFn, req) {
  return new Promise((resolve) => {
    const fakeRes = {
      setHeader() {},
      status() {
        return this;
      },
      json(body) {
        resolve(body);
      },
    };
    handlerFn(req, fakeRes).catch((err) => resolve({ error: err.message }));
  });
}

async function toDataUrl(url) {
  const resp = await fetch(url);
  if (!resp.ok) return null;
  const contentType = (resp.headers.get("content-type") || "image/jpeg").split(";")[0];
  const buf = Buffer.from(await resp.arrayBuffer());
  if (buf.length > MAX_BYTES) return null;
  return `data:${contentType};base64,${buf.toString("base64")}`;
}

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
    const [ezoData, odData] = await Promise.all([
      captureJson(assetsHandler, { query: {} }),
      captureJson(employeesHandler, { query: {} }),
    ]);
    const freshById = {};
    (ezoData.items || []).forEach((i) => {
      if (i.photo) freshById[String(i.ezoId)] = i.photo;
    });
    (odData.items || []).forEach((i) => {
      if (i.photo) freshById[String(i.ezoId)] = i.photo;
    });

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

    const targets = cards.filter((c) => !c.photo && c.ezoId && freshById[String(c.ezoId)]);

    let recovered = 0;
    let stillMissing = 0;
    await mapThrottled(targets, 6, async (card) => {
      const dataUrl = await toDataUrl(freshById[String(card.ezoId)]).catch(() => null);
      if (dataUrl) {
        card.photo = dataUrl;
        recovered++;
      } else {
        stillMissing++;
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

    const remainingWithNoPhoto = cards.filter((c) => !c.photo).length;
    res.status(200).json({
      ok: true,
      totalCards: cards.length,
      attempted: targets.length,
      recovered,
      stillMissing,
      remainingWithNoPhoto,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
