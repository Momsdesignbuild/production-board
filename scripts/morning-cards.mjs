// Morning Trench Time + Hammer Time cards. Runs on the MDB mini (weekdays 7:30, launchd com.momsbot.board-morning-cards).
// Placement = BuilderTrend punches up to the cutoff; Shop default (Joe = Trench, Mike = Hammer) unless an all-day Outlook event says they're out.
// The board's saved badges are used as a name -> photo library ONLY (never placement, never written to). Separate from the board by decision (Josh 2026-11-13).
//   node scripts/morning-cards.mjs [--at 07:30] [--date YYYY-MM-DD] [--channel dev|real] [--dry]
// Default channel is dev (#mdb-bot-dev) until Josh says go-live.
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { loadCrewConfig, buildSpecFromPunches, renderHtml, dateLine, fileDate } from "../lib/crew-board.js";
import { btGetJson } from "../../moms-bot/scripts/bt-client.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const DRY = process.argv.includes("--dry");
const DATE = arg("--date", new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" }));
const AT = arg("--at", "07:30");
const CUT = `${DATE}T${AT}`;
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const readEnv = (f) => Object.fromEntries(fs.readFileSync(f, "utf8").split("\n").filter((l) => /^[A-Z_0-9]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
const MOMS = path.resolve(ROOT, "../moms-bot");
const brain = readEnv(`${MOMS}/mcp-servers/onedrive/.env.brain`);
const slackEnv = readEnv(`${MOMS}/.env.slack.mdbws`);
const SUPABASE_URL = process.env.SUPABASE_URL || "https://lufrguiekfkhtxsgcqjo.supabase.co";
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; if (!KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing (run via morning-cards.sh)");

// board: which crew, whose Shop default, whose calendar says they're out
const BOARDS = {
  trench: { shopPerson: "Joe Smyth", mailbox: "joesmyth@momsdesignbuild.com", channel: { dev: slackEnv.DEV_CHANNEL_ID, real: process.env.CREW_SLACK_CHANNEL_TRENCH || "C5E68JQV6" } },
  hammer: { shopPerson: "Mike Weckman", mailbox: "mikeweckman@momsdesignbuild.com", channel: { dev: slackEnv.DEV_CHANNEL_ID, real: process.env.CREW_SLACK_CHANNEL_HAMMER || "C7PSFA0BU" } },
};
const CHANNEL = arg("--channel", "dev"); if (!["dev", "real"].includes(CHANNEL)) throw new Error("--channel dev|real");

// ---- Outlook: is this person out today? (all-day event, any status, not cancelled) -------------
let graphTok;
async function outToday(mailbox) {
  graphTok ||= (await (await fetch(`https://login.microsoftonline.com/${brain.MDB_TENANT_ID}/oauth2/v2.0/token`, { method: "POST", body: new URLSearchParams({ client_id: brain.MDB_CLIENT_ID, client_secret: brain.MDB_CLIENT_SECRET, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }) })).json()).access_token;
  const r = await fetch(`https://graph.microsoft.com/v1.0/users/${mailbox}/calendarView?startDateTime=${DATE}T00:00:00&endDateTime=${DATE}T23:59:59&$top=100&$select=subject,isAllDay,isCancelled,end`, { headers: { Authorization: "Bearer " + graphTok, Prefer: 'outlook.timezone="America/Chicago"' } });
  if (!r.ok) return { err: `calendar ${r.status}`, out: null };
  const hit = (await r.json()).value.find((e) => e.isAllDay && !e.isCancelled && e.end.dateTime.slice(0, 10) > DATE); // end is next-day midnight for a one-day event
  return { out: hit ? hit.subject : null };
}

// ---- BuilderTrend: one punch per person (their first real-job punch up to the cutoff) ----------
const SHOPLIKE = /^(shop|general|mom's world|fg - shop)/i, NOTLANDSCAPE = /^(FG - |CM |MDB )/i;
const toks = (s) => String(s || "").toLowerCase().replace(/[^a-z ]+/g, " ").split(/\s+/).filter(Boolean);
// roster name matches a BuilderTrend name when every token of the shorter name is in the longer ("Jose Navarro Alba" ~ "Jose Guadalupe Navarro Alba")
const sameName = (a, b) => { const x = toks(a), y = toks(b); const [s, l] = x.length <= y.length ? [x, y] : [y, x]; return s.length >= 2 && s.every((t) => l.includes(t)); };
const res = await btGetJson(`/api/TimeClock/List?startDate=${DATE}&endDate=${DATE}`);
const today = (res?.data?.timeclocks || []).filter((r) => String(r.timeIn).startsWith(DATE) && String(r.timeIn) <= CUT + ":59" && r.name && r.jobName).sort((a, b) => (a.timeIn < b.timeIn ? -1 : 1));

// ---- photos: board badges, read-only, both boards, name -> card only ---------------------------
const sb = async (p) => (await fetch(`${SUPABASE_URL}/rest/v1/${p}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } })).json();
const cards = (await sb("board_state?select=data")).flatMap((r) => r.data?.cards || []).filter((c) => c.category === "employee");
const photoSrc = (p) => { if (typeof p !== "string" || !p) return null; if (/^(data:image|https?:)/.test(p)) return p; const f = path.join(ROOT, p.replace(/^\//, "")); return fs.existsSync(f) ? `data:image/${f.endsWith(".png") ? "png" : "jpeg"};base64,${fs.readFileSync(f).toString("base64")}` : null; };

// ---- render (Playwright from moms-bot) + Slack upload -------------------------------------------
const { chromium } = await import(`${MOMS}/node_modules/playwright/index.mjs`);
async function png(html) {
  const b = await chromium.launch({ headless: true }); const pg = await b.newPage({ viewport: { width: 940, height: 1200 }, deviceScaleFactor: 2 });
  await pg.setContent(html, { waitUntil: "load" }); const buf = await pg.locator(".tt").screenshot(); await b.close(); return buf;
}
async function slack(method, body) {
  const r = await (await fetch(`https://slack.com/api/${method}`, { method: "POST", headers: { Authorization: `Bearer ${slackEnv.SLACK_BOT_TOKEN}`, "Content-Type": body instanceof URLSearchParams ? "application/x-www-form-urlencoded" : "application/json" }, body: body instanceof URLSearchParams ? body : JSON.stringify(body) })).json();
  if (!r.ok) throw new Error(`slack ${method}: ${r.error}`); return r;
}

for (const board of ["trench", "hammer"]) {
  const B = BOARDS[board], crew = loadCrewConfig(board);
  const people = Object.fromEntries(Object.values(crew.roster).flatMap((c) => c.members.map((m) => [m, 1])));
  // Shop default unless out
  const cal = await outToday(B.mailbox);
  const inShop = !cal.out && !cal.err; // calendar read failure → default them in (the default is Shop), flagged below
  const cfg = { ...crew.cfg, pinned: inShop || cal.err ? { [B.shopPerson]: "Shop" } : {} };
  // one punch per roster person
  const picked = {}, seenPunch = new Set();
  for (const r of today) {
    const n = Object.keys(people).find((p) => sameName(p, r.name)); if (!n) continue;
    seenPunch.add(n);
    if (picked[n] || SHOPLIKE.test(r.jobName) || NOTLANDSCAPE.test(r.jobName)) continue;
    picked[n] = { name: n, job: r.jobName, punched_at: r.timeIn + "-06:00" };
  }
  const { spec, receipt } = buildSpecFromPunches(Object.values(picked), { cards }, { cfg, roster: crew.roster }, cfg.pinned[B.shopPerson] ? [B.shopPerson] : []);
  const missing = Object.keys(people).filter((n) => n !== B.shopPerson && !picked[n]).map((n) => `${n}${seenPunch.has(n) ? " (shop/other)" : ""}`);
  const html = renderHtml(spec, cfg, photoSrc);
  const name = `${cfg.title.replace(/\b\w+/g, (w) => w[0] + w.slice(1).toLowerCase())} ${fileDate()}`;
  const shopLine = cal.err ? `:warning: ${B.shopPerson}: calendar unreadable (${cal.err}) — kept in Shop` : cal.out ? `:no_entry: ${B.shopPerson} is out today ("${cal.out}") — not in Shop` : `${B.shopPerson}: in Shop (no all-day event today)`;
  const text = `${name} — ${dateLine()} _(BuilderTrend punches through ${AT})_\n${spec.filter((g) => g.name !== "Shop").map((g) => `*${g.name}:* ${g.members.join(", ")}`).join("\n")}\n${shopLine}${missing.length ? `\nNo job punch by ${AT}: ${missing.join(", ")}` : ""}`;
  console.log(`\n=== ${board} ===\n${text}\n--- receipt ---\n${receipt.join("\n")}`);
  if (DRY) continue;
  const buf = await png(html); const out = path.join(os.tmpdir(), `${board}-${DATE}.png`); fs.writeFileSync(out, buf);
  const up = await slack("files.getUploadURLExternal", new URLSearchParams({ filename: `${name}.png`, length: String(buf.length) }));
  const put = await fetch(up.upload_url, { method: "POST", headers: { "Content-Type": "image/png" }, body: buf }); if (!put.ok) throw new Error(`slack upload ${put.status}`);
  await slack("files.completeUploadExternal", { files: [{ id: up.file_id, title: name }], channel_id: B.channel[CHANNEL] }); // card only, no caption (Josh 2026-11-13); the text stays in the console
  console.log(`posted ${name} → ${CHANNEL} (${B.channel[CHANNEL]}), png ${out}`);
}
