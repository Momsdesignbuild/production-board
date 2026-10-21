// Reports endpoint. GET → analytics JSON (lib/analytics.js).
// GET ?crew=trench[&shop=a,b] → Trench Time preview (spec + HTML fragment + shop candidates).
// POST {crew, shop, png} → posts the rendered board (client-rendered PNG) to Slack (CREW_SLACK_CHANNEL).
// All folded in here because Vercel Hobby caps us at 12 functions.
import { computeAnalytics } from "../lib/analytics.js";
import { buildSpec, loadCrewConfig, renderHtml, dateLine, fileDate } from "../lib/crew-board.js";
import { verifySession } from "../lib/session.js";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://lufrguiekfkhtxsgcqjo.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SLACK_TOKEN = process.env.SLACK_BOT_TOKEN || "";
const SLACK_CHANNEL = process.env.CREW_SLACK_CHANNEL || ""; // channel id; #mdb-bot-dev while testing. Never typed in the UI.
const SLACK_LABEL = process.env.CREW_SLACK_LABEL || "Slack";

async function liveState(boardId = 1) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/board_state?id=eq.${boardId}&select=data`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
  if (!r.ok) throw new Error(`board_state read failed: ${r.status}`);
  const data = (await r.json())[0]?.data || {};
  // rows the active template flags as the fixed Shop row (job_rows[i].shop)
  const tplUrl = boardId === 2 ? `frame_templates?id=eq.00000000-0000-0000-0000-000000000002&select=job_rows` : `board_config?id=eq.1&select=frame_templates(job_rows)`;
  const t = await fetch(`${SUPABASE_URL}/rest/v1/${tplUrl}`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
  const row = t.ok ? (await t.json())[0] : null;
  const rows = boardId === 2 ? row?.job_rows : row?.frame_templates?.job_rows;
  data.shopRows = (rows || []).flatMap((j, i) => (j.shop ? [i] : []));
  return data;
}
async function slack(method, body) {
  const r = await fetch(`https://slack.com/api/${method}`, { method: "POST", headers: { Authorization: `Bearer ${SLACK_TOKEN}`, "Content-Type": body instanceof URLSearchParams ? "application/x-www-form-urlencoded" : "application/json" }, body: body instanceof URLSearchParams ? body : JSON.stringify(body) });
  const j = await r.json(); if (!j.ok) throw new Error(`slack ${method}: ${j.error}`); return j;
}

export default async function handler(req, res) {
  if (!SERVICE_KEY) { res.status(500).json({ error: "server isn't configured (SUPABASE_SERVICE_ROLE_KEY)" }); return; }
  try {
    if (req.method === "GET" && !req.query?.crew) { res.status(200).json(await computeAnalytics(SUPABASE_URL, SERVICE_KEY)); return; }

    const board = String(req.query?.crew || req.body?.crew || "trench");
    if (board !== "trench" && board !== "hammer") { res.status(400).json({ error: "crew must be trench or hammer" }); return; }
    const crew = loadCrewConfig(board);
    // both crew boards are badge positions: trench = LA board, hammer = R&C board
    const build = async (shop) => buildSpec(await liveState(board === "hammer" ? 2 : 1), crew, shop);

    if (req.method === "GET") {
      const shop = req.query.shop === undefined ? undefined : String(req.query.shop).split(",").filter(Boolean);
      const { spec, candidates, receipt, shop: chosen, punches } = await build(shop);
      res.status(200).json({ html: renderHtml(spec, crew.cfg, (p) => p, { fragment: true }), candidates, shop: chosen, receipt, punches: punches ?? null, recipient: SLACK_CHANNEL ? SLACK_LABEL : null, groups: spec.map((g) => ({ name: g.name, color: g.color, members: g.members })), fileName: `${crew.cfg.title.replace(/\b\w+/g, (w) => w[0] + w.slice(1).toLowerCase())} ${fileDate()}` });
      return;
    }

    if (req.method === "POST") {
      if (!verifySession(req.headers.authorization, process.env.SESSION_SECRET)) { res.status(401).json({ error: "unauthorized" }); return; }
      const { png, shop } = req.body || {};
      if (!SLACK_TOKEN || !SLACK_CHANNEL) { res.status(500).json({ error: "server isn't configured (SLACK_BOT_TOKEN / CREW_SLACK_CHANNEL)" }); return; }
      const b64 = String(png || "").replace(/^data:image\/png;base64,/, "");
      if (b64.length < 1000) { res.status(400).json({ error: "missing png" }); return; }
      const { spec } = await build(Array.isArray(shop) ? shop : undefined);
      const name = `${crew.cfg.title.replace(/\b\w+/g, (w) => w[0] + w.slice(1).toLowerCase())} ${fileDate()}`;
      const lines = spec.map((g) => `*${g.name}:* ${g.members.join(", ")}`).join("\n");
      const bytes = Buffer.from(b64, "base64");
      const up = await slack("files.getUploadURLExternal", new URLSearchParams({ filename: `${name}.png`, length: String(bytes.length) }));
      const put = await fetch(up.upload_url, { method: "POST", headers: { "Content-Type": "image/png" }, body: bytes });
      if (!put.ok) throw new Error(`slack upload ${put.status}`);
      await slack("files.completeUploadExternal", { files: [{ id: up.file_id, title: name }], channel_id: SLACK_CHANNEL, initial_comment: `${name} — ${dateLine()}\n${lines}` });
      const to = SLACK_LABEL;
      res.status(200).json({ ok: true, to, name });
      return;
    }
    res.status(405).json({ error: "method not allowed" });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
}
