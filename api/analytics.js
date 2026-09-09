// Reports endpoint. GET → analytics JSON (lib/analytics.js).
// GET ?crew=trench[&shop=a,b] → Trench Time preview (spec + HTML fragment + shop candidates).
// POST {crew, to, png} → emails the rendered board (client-rendered PNG) from Josh's MDB mailbox.
// All folded in here because Vercel Hobby caps us at 12 functions.
import { computeAnalytics } from "../lib/analytics.js";
import { buildSpec, buildSpecFromPunches, loadCrewConfig, renderHtml, dateLine, fileDate } from "../lib/crew-board.js";
import { todayStr } from "../lib/today.js";
import { verifySession } from "../lib/session.js";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://lufrguiekfkhtxsgcqjo.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FROM = process.env.MDB_MAIL_FROM || "joshuamontanez@momsdesignbuild.com"; // MDB rule: automation mail is always from Josh's MDB address
const TRENCH_TO = process.env.TRENCH_TO || ""; // Cherilyn in production; a test address locally. Never typed in the UI.

async function liveState() {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/board_state?id=eq.1&select=data`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
  if (!r.ok) throw new Error(`board_state read failed: ${r.status}`);
  return (await r.json())[0]?.data || {};
}
async function graphToken() {
  const r = await fetch(`https://login.microsoftonline.com/${process.env.MDB_TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.MDB_CLIENT_ID, client_secret: process.env.MDB_CLIENT_SECRET, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }),
  });
  const j = await r.json(); if (!j.access_token) throw new Error("graph token failed"); return j.access_token;
}

export default async function handler(req, res) {
  if (!SERVICE_KEY) { res.status(500).json({ error: "server isn't configured (SUPABASE_SERVICE_ROLE_KEY)" }); return; }
  try {
    if (req.method === "GET" && !req.query?.crew) { res.status(200).json(await computeAnalytics(SUPABASE_URL, SERVICE_KEY)); return; }

    const board = String(req.query?.crew || req.body?.crew || "trench");
    if (board !== "trench" && board !== "hammer") { res.status(400).json({ error: "crew must be trench or hammer" }); return; }
    const crew = loadCrewConfig(board);
    // trench = badge positions on the board; hammer = BuilderTrend first punches (fed by the mini)
    const build = async (shop) => {
      const state = await liveState();
      if (board === "trench") return buildSpec(state, crew, shop);
      const r = await fetch(`${SUPABASE_URL}/rest/v1/crew_punches?date=eq.${todayStr()}&select=name,job,punched_at&order=punched_at`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
      if (!r.ok) throw new Error(`crew_punches read failed: ${r.status}`);
      return buildSpecFromPunches(await r.json(), state, crew, shop);
    };

    if (req.method === "GET") {
      const shop = req.query.shop === undefined ? undefined : String(req.query.shop).split(",").filter(Boolean);
      const { spec, candidates, receipt, shop: chosen, punches } = await build(shop);
      res.status(200).json({ html: renderHtml(spec, crew.cfg, (p) => p, { fragment: true }), candidates, shop: chosen, receipt, punches: punches ?? null, recipient: TRENCH_TO || null, groups: spec.map((g) => ({ name: g.name, color: g.color, members: g.members })), fileName: `${crew.cfg.title.replace(/\b\w+/g, (w) => w[0] + w.slice(1).toLowerCase())} ${fileDate()}` });
      return;
    }

    if (req.method === "POST") {
      if (!verifySession(req.headers.authorization, process.env.SESSION_SECRET)) { res.status(401).json({ error: "unauthorized" }); return; }
      const { png, shop } = req.body || {};
      const to = TRENCH_TO;
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) { res.status(500).json({ error: "server isn't configured (TRENCH_TO — who receives Trench Time)" }); return; }
      const b64 = String(png || "").replace(/^data:image\/png;base64,/, "");
      if (b64.length < 1000) { res.status(400).json({ error: "missing png" }); return; }
      if (!process.env.MDB_CLIENT_SECRET) { res.status(500).json({ error: "server isn't configured (MDB_* graph vars)" }); return; }
      const { spec } = await build(Array.isArray(shop) ? shop : undefined);
      const name = `${crew.cfg.title.replace(/\b\w+/g, (w) => w[0] + w.slice(1).toLowerCase())} ${fileDate()}`;
      const lines = spec.map((g) => `${g.name}: ${g.members.join(", ")}`).join("<br>");
      const r = await fetch(`https://graph.microsoft.com/v1.0/users/${FROM}/sendMail`, {
        method: "POST", headers: { Authorization: `Bearer ${await graphToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ saveToSentItems: true, message: {
          subject: `${name} — ${dateLine()}`,
          body: { contentType: "HTML", content: `<p>Today's ${crew.cfg.title} board${board === "trench" ? ", generated from the production board" : ", from this morning's BuilderTrend punches"}.</p><p style="font-family:sans-serif;font-size:13px">${lines}</p>` },
          toRecipients: [{ emailAddress: { address: to } }],
          attachments: [{ "@odata.type": "#microsoft.graph.fileAttachment", name: `${name}.png`, contentType: "image/png", contentBytes: b64 }],
        } }),
      });
      if (!r.ok) throw new Error(`sendMail ${r.status}: ${(await r.text()).slice(0, 300)}`);
      res.status(200).json({ ok: true, to, name });
      return;
    }
    res.status(405).json({ error: "method not allowed" });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
}
