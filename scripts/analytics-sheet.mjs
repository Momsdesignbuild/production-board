// Builds the Production Board analytics workbook and (optionally) uploads it
// to OneDrive as a view-only link. Runs on the MDB mini after the 6am rollover.
//
//   node scripts/analytics-sheet.mjs --api https://production-board-moms-design-build.vercel.app --out /tmp/board.xlsx
//   node scripts/analytics-sheet.mjs --direct --upload           # on the mini: DB direct + Graph env (see below)
//
// Graph env (only for --upload): MDB_TENANT_ID MDB_CLIENT_ID MDB_CLIENT_SECRET MDB_DRIVE_ID
// — on the mini: `set -a; . ~/repos/moms-bot/mcp-servers/onedrive/.env.brain; set +a`.
// Supabase env (only for --upload, to store the link): SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY
import ExcelJS from "exceljs";
import fs from "node:fs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const API = arg("--api", "http://localhost:3333");
const OUT = arg("--out", "/tmp/Production Board Analytics.xlsx");
const UPLOAD = process.argv.includes("--upload");
const ONEDRIVE_PATH = "/PM - LANDSCAPE/2 DEPARTMENT RESOURCES/Production Board/Production Board Analytics.xlsx";

const TZ = "America/Chicago";
const today = new Date().toLocaleDateString("en-CA", { timeZone: TZ });
const stamp = new Date().toLocaleString("en-US", { timeZone: TZ });

let data;
if (process.argv.includes("--direct")) {
  // straight from the database — used on the mini, where the Vercel URL is SSO-protected
  const { computeAnalytics } = await import("../lib/analytics.js");
  data = await computeAnalytics(process.env.SUPABASE_URL || "https://lufrguiekfkhtxsgcqjo.supabase.co", process.env.SUPABASE_SERVICE_ROLE_KEY);
} else {
  const res = await fetch(`${API}/api/analytics`);
  data = await res.json();
  if (data.error) throw new Error("analytics API: " + data.error);
}

const CAT = { employee: "Crew", truck: "Truck", equipment: "Equipment", trailer: "Trailer", dumpster: "Dumpster", sign: "Sign", camera: "Camera" };
const cat = (c) => CAT[c] || (c ? c[0].toUpperCase() + c.slice(1) : "Other");
const jobOf = (lane) => String(lane || "").replace(/ — .*$/, "");

// ---- styling helpers ----
const NAVY = "FF1F3A5F", RED = "FFC0392B", AMBER = "FFF39C12", GREEN = "FF27AE60", GREY = "FFF2F4F7", WHITE = "FFFFFFFF";
const fill = (argb) => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
function header(ws, cols) {
  ws.columns = cols.map((c) => ({ header: c.h, key: c.k, width: c.w }));
  const row = ws.getRow(1);
  row.height = 22;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: WHITE }, size: 11 };
    cell.fill = fill(NAVY);
    cell.alignment = { vertical: "middle" };
    cell.border = { bottom: { style: "thin", color: { argb: NAVY } } };
  });
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
}
function zebra(ws) {
  ws.eachRow((row, i) => { if (i > 1 && i % 2 === 0) row.eachCell({ includeEmpty: true }, (c) => { if (!c.fill || !c.fill.fgColor) c.fill = fill(GREY); }); });
}
function daysColor(cell, d) {
  if (d >= 30) { cell.fill = fill(RED); cell.font = { bold: true, color: { argb: WHITE } }; }
  else if (d >= 7) { cell.fill = fill(AMBER); cell.font = { bold: true } };
}

const wb = new ExcelJS.Workbook();
wb.creator = "MDB Production Board";
wb.created = new Date();

// ---- Tab 1: Days on Job (what's sitting where, right now) ----
{
  const ws = wb.addWorksheet("Days on Job", { properties: { tabColor: { argb: NAVY } } });
  header(ws, [
    { h: "Badge", k: "label", w: 28 }, { h: "Type", k: "cat", w: 12 }, { h: "Job", k: "job", w: 40 },
    { h: "Where", k: "lane", w: 18 }, { h: "Since", k: "since", w: 12 }, { h: "Days", k: "days", w: 8 }, { h: "Flag", k: "flag", w: 10 },
  ]);
  for (const it of data.items) {
    const lane = String(it.laneLabel || "");
    const r = ws.addRow({
      label: it.label || it.ezoId, cat: cat(it.category), job: jobOf(lane),
      lane: lane.includes(" — ") ? lane.split(" — ")[1] : lane, since: it.sinceDate, days: it.daysInPlace,
      flag: it.daysInPlace >= 30 ? "30+ days" : it.daysInPlace >= 7 ? "7+ days" : "",
    });
    daysColor(r.getCell("days"), it.daysInPlace);
    r.getCell("days").alignment = { horizontal: "center" };
  }
  zebra(ws);
}

// ---- Tab 2: By Job (one line per job, what it's holding) ----
{
  const ws = wb.addWorksheet("By Job", { properties: { tabColor: { argb: GREEN } } });
  const byJob = {};
  for (const it of data.items) {
    const job = jobOf(it.laneLabel);
    const j = byJob[job] ||= { job, crew: 0, trucks: 0, equipment: 0, trailers: 0, dumpsters: 0, other: 0, longest: 0, longestWhat: "" };
    const k = { employee: "crew", truck: "trucks", equipment: "equipment", trailer: "trailers", dumpster: "dumpsters" }[it.category] || "other";
    j[k]++;
    if (it.daysInPlace > j.longest) { j.longest = it.daysInPlace; j.longestWhat = it.label || it.ezoId; }
  }
  header(ws, [
    { h: "Job", k: "job", w: 40 }, { h: "Crew", k: "crew", w: 8 }, { h: "Trucks", k: "trucks", w: 8 }, { h: "Equipment", k: "equipment", w: 11 },
    { h: "Trailers", k: "trailers", w: 9 }, { h: "Dumpsters", k: "dumpsters", w: 11 }, { h: "Other", k: "other", w: 8 },
    { h: "Longest sitter (days)", k: "longest", w: 20 }, { h: "Which", k: "longestWhat", w: 28 },
  ]);
  for (const j of Object.values(byJob).sort((a, b) => b.longest - a.longest)) {
    const r = ws.addRow(j);
    daysColor(r.getCell("longest"), j.longest);
    ["crew", "trucks", "equipment", "trailers", "dumpsters", "other", "longest"].forEach((k) => (r.getCell(k).alignment = { horizontal: "center" }));
  }
  zebra(ws);
}

// ---- Tab 3: Daily Log (long format — flexible, new badges are just new rows) ----
{
  const ws = wb.addWorksheet("Daily Log", { properties: { tabColor: { argb: AMBER } } });
  header(ws, [{ h: "Date", k: "date", w: 12 }, { h: "Badge", k: "label", w: 28 }, { h: "Type", k: "cat", w: 12 }, { h: "Job / Pool", k: "lane", w: 44 }, { h: "Badge ID", k: "ezoId", w: 22 }]);
  for (const h of data.history) ws.addRow({ date: h.date, label: h.label || h.ezoId, cat: cat(h.category), lane: h.lane, ezoId: h.ezoId });
  zebra(ws);
}

// ---- Tab 4: About ----
{
  const ws = wb.addWorksheet("About");
  ws.columns = [{ width: 100 }];
  [
    ["Production Board Analytics", { bold: true, size: 16, color: { argb: NAVY } }],
    [`Generated ${stamp} (Minneapolis). Rebuilt automatically every morning after the 6am board rollover.`],
    [""],
    ["How it's computed", { bold: true }],
    ["The board is snapshotted once per day. A badge's 'Days' is how many days it has sat under the same job name, in the same slot."],
    ["If the job name in a row changes, every badge in that row starts over at 0 — it's on a new job even though it didn't move."],
    ["Typed job names and names picked from the tracker are treated the same: the text is the job."],
    ["New badges (crew, trucks, custom) appear the first day they sit under a job. Nothing to configure."],
    [""],
    ["Flags", { bold: true }],
    ["Amber = 7+ days on the same job.   Red = 30+ days."],
    [""],
    [`Days tracked: ${data.daysTracked} (${data.earliestDate} → ${data.latestDate}). Badges currently on a job: ${data.items.length}.`],
    ["This file is read-only. Edits are overwritten daily. Source of truth is the board itself."],
  ].forEach(([t, f]) => { const r = ws.addRow([t]); if (f) r.getCell(1).font = f; });
}

await wb.xlsx.writeFile(OUT);
console.log(`wrote ${OUT} — ${data.items.length} on-job badges, ${data.history.length} log rows`);

if (!UPLOAD) process.exit(0);

// ---- OneDrive upload + view link ----
const need = (k) => { if (!process.env[k]) throw new Error("missing env " + k); return process.env[k]; };
const tok = await fetch(`https://login.microsoftonline.com/${need("MDB_TENANT_ID")}/oauth2/v2.0/token`, {
  method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ client_id: need("MDB_CLIENT_ID"), client_secret: need("MDB_CLIENT_SECRET"), scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }),
}).then((r) => r.json());
if (!tok.access_token) throw new Error("graph token failed: " + JSON.stringify(tok).slice(0, 200));
const G = `https://graph.microsoft.com/v1.0/drives/${need("MDB_DRIVE_ID")}/root:${encodeURI(ONEDRIVE_PATH)}`;
const H = { Authorization: `Bearer ${tok.access_token}` };

const up = await fetch(`${G}:/content`, { method: "PUT", headers: { ...H, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }, body: fs.readFileSync(OUT) });
if (!up.ok) throw new Error(`upload failed ${up.status}: ${(await up.text()).slice(0, 300)}`);
const item = await up.json();

const link = await fetch(`https://graph.microsoft.com/v1.0/drives/${need("MDB_DRIVE_ID")}/items/${item.id}/createLink`, {
  method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ type: "view", scope: "organization" }),
}).then((r) => r.json());
const url = link.link?.webUrl;
if (!url) throw new Error("createLink failed: " + JSON.stringify(link).slice(0, 300));
console.log("uploaded:", item.webUrl); console.log("view link:", url);

if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/board_config?id=eq.1`, {
    method: "PATCH", headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ analytics_sheet_url: url }),
  });
  console.log("board_config.analytics_sheet_url:", r.ok ? "saved" : `failed ${r.status}`);
}
