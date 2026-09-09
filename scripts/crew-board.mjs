// Trench Time / Hammer Time from the production board. No BuilderTrend, no
// calendar: the badges under each job row ARE the crew board.
//
//   node scripts/crew-board.mjs --board trench --out ~/Desktop
//   node scripts/crew-board.mjs --board hammer --out ~/Desktop
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (local: .env.local; mini: .env.sheet).
// Output: "<TITLE> M.D.YYYY.pdf" + a .txt receipt (who was placed where, who was
// skipped and why) so a human can approve it before it ever reaches Slack.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const BOARD = arg("--board", "trench");
const OUT_DIR = arg("--out", path.join(os.homedir(), "Desktop")).replace(/^~/, os.homedir());
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "crew", BOARD + ".json"), "utf8"));
const roster = JSON.parse(fs.readFileSync(path.join(ROOT, "crew", cfg.roster), "utf8")).crews;
// every roster, so a person on the OTHER board is silently ignored instead of flagged
const allNames = new Set(fs.readdirSync(path.join(ROOT, "crew")).filter((f) => f.endsWith("-map.json")).flatMap((f) => Object.values(JSON.parse(fs.readFileSync(path.join(ROOT, "crew", f), "utf8")).crews).flatMap((c) => c.members)));
const CHROME = process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://lufrguiekfkhtxsgcqjo.supabase.co";
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing");

// ---- board ----
const rows = await fetch(`${SUPABASE_URL}/rest/v1/board_state?id=eq.1&select=data,updated_at`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } }).then((r) => r.json());
const state = rows[0]?.data || {};
const cards = state.cards || [];
const jobs = state.jobs || [];

// ---- roster matching: board labels are often shorter than roster names
// ("Dalber Vargas" vs "Dalber Arellano Vargas", "Max" vs "Maxwell") ----
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z ]+/g, " ").trim().split(/\s+/).filter(Boolean);
const people = {}; // roster name -> { crew, lead }
for (const [crew, c] of Object.entries(roster)) for (const m of c.members) people[m] = { crew, lead: c.lead === m };
function rosterNameIn(names, label) {
  const lt = norm(label);
  if (!lt.length) return null;
  const hits = [...names].filter((n) => { const rt = norm(n); return lt.every((t) => rt.some((r) => r === t || r.startsWith(t))); });
  if (hits.length === 1) return hits[0];
  const exact = hits.find((n) => norm(n).join(" ") === lt.join(" "));
  return exact || null;
}
const rosterName = (label) => rosterNameIn(Object.keys(people), label);

// ---- placement ----
const jobName = (i) => {
  const raw = jobs[i]?.name || "";
  if (cfg.jobRenames?.[raw]) return cfg.jobRenames[raw];
  return raw.split(",")[0].replace(/\s+\d{4}\s*(\+|ps)?\s*$/i, "").trim() || `Row ${i + 1}`; // "Schreier, Megan & Adam 2026" → "Schreier" (Cherilyn's style; jobRenames for exceptions)
};
const groups = {}; const receipt = []; const seen = new Set();
for (const c of cards) {
  if (c.inTray || !c.label || c.category !== "employee") continue; // trucks are named after people (Frank, Corey…) — never match them
  const name = rosterName(c.label);
  if (!name) { if (!rosterNameIn(allNames, c.label)) receipt.push(`skip  ${c.label} — tagged employee but on no roster`); continue; }
  if (seen.has(name)) { receipt.push(`dup   ${name} — appears twice, first placement kept`); continue; }
  seen.add(name);
  const m = /^job(\d+)/.exec(c.laneId || "");
  if (m) { (groups[Number(m[1])] ||= { members: [], cards: [] }).members.push(name); groups[Number(m[1])].cards.push(c); receipt.push(`job   ${name} → ${jobName(Number(m[1]))}`); continue; }
  if (c.laneId === "vaca" || c.laneId === "unavail") { receipt.push(`off   ${name} — ${c.laneId === "vaca" ? "vacation/sick strip" : "unavailable strip"}`); continue; }
  receipt.push(`skip  ${name} — on the board but not under a job (${c.laneId || "no lane"})`);
}
// Shop: pinned people + shop-crew members whose badge is sitting in the tray (not placed, not off)
const shop = { members: [], cards: [] };
for (const c of cards) {
  if (c.category !== "employee") continue;
  const name = rosterName(c.label); if (!name || seen.has(name)) continue;
  const pinned = cfg.pinned?.[name] === "Shop";
  const shopCrew = people[name].crew === cfg.shopCrew && c.inTray;
  if (pinned || shopCrew) { seen.add(name); shop.members.push(name); shop.cards.push(c); receipt.push(`shop  ${name}${pinned ? " (pinned)" : " (shop crew, in tray)"}`); }
}
for (const n of Object.keys(cfg.pinned || {})) if (!seen.has(n)) receipt.push(`miss  ${n} — pinned to Shop but has no badge on the board`);

const spec = Object.keys(groups).map(Number).sort((a, b) => a - b).map((i) => {
  const g = groups[i];
  const crews = g.members.map((n) => people[n].crew);
  const color = crews.sort((a, b) => crews.filter((x) => x === b).length - crews.filter((x) => x === a).length)[0];
  g.members.sort((a, b) => (people[b].lead ? 1 : 0) - (people[a].lead ? 1 : 0)); // leader first
  return { name: jobName(i), color, members: g.members, cards: g.cards };
});
if (shop.members.length) spec.push({ name: "Shop", color: "SHOP", members: shop.members, cards: shop.cards });

// ---- render (mirrors Cherilyn's layout: header box + KEY, then cards over a colored job bar) ----
const now = new Date();
const dayLine = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "America/Chicago" }).toUpperCase();
const fileDate = now.toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "numeric", timeZone: "America/Chicago" }).replace(/\//g, ".");
const colors = { ...cfg.colors, SHOP: "#9a9a9a" };
// the badge IS the production board's face-card (name bar baked in) — show it as-is
const photoSrc = (p) => {
  if (typeof p !== "string" || !p) return null;
  if (/^(data:image|https?:)/.test(p)) return p;
  const f = path.join(ROOT, p.replace(/^\//, "")); // "/badges/x.png" ships with the site
  if (!fs.existsSync(f)) return null;
  return `data:image/${f.endsWith(".png") ? "png" : "jpeg"};base64,${fs.readFileSync(f).toString("base64")}`;
};
const card = (c, name) => {
  const src = photoSrc(c.photo);
  const bare = src && !String(c.photo).startsWith("data:"); // site badge = plain photo, no name bar baked in
  return `<div class="card">${src ? `<img src="${src}">` : `<div class="noimg">${name}</div>`}${bare ? `<div class="cap">${name}</div>` : ""}</div>`;
};
const html = `<!doctype html><meta charset="utf-8"><style>
  @page { size: letter; margin: 0.35in; }
  body { font-family: "Century Gothic", "Avenir Next", "Helvetica Neue", Arial, sans-serif; color:#333; margin:0; background:#fff; }
  .page { width:880px; margin:0 auto; padding:18px 0; } /* letter width minus margins at 96dpi — same canvas for PDF and PNG */
  .hdr { display:flex; border:2px solid #333; }
  .hdr .l { flex:1; padding:8px 22px; border-right:2px solid #333; }
  .hdr h1 { font-weight:300; font-size:40px; letter-spacing:1px; margin:0; color:#555; }
  .hdr h2 { font-weight:800; font-size:22px; margin:6px 0 0; }
  .hdr .k { padding:10px 14px; min-width:260px; }
  .hdr .k b { display:block; font-size:22px; margin-bottom:6px; }
  .chips { display:grid; grid-template-columns:repeat(3,1fr); gap:6px; }
  .chip { color:#fff; font-weight:800; font-size:11px; text-align:center; padding:6px 4px; }
  .grp { margin-top:6px; page-break-inside:avoid; }
  .cards { display:flex; flex-wrap:wrap; gap:8px; padding:0 4px 4px; }
  .card { width:100px; }
  .card img { width:100px; display:block; }
  .cap { font-size:8px; font-weight:700; text-align:center; margin-top:2px; }
  .noimg { width:100px; height:118px; background:#eee; color:#333; font-size:11px; font-weight:700; text-align:center; display:flex; align-items:center; justify-content:center; }
  .bar { color:#fff; font-weight:800; font-size:18px; text-align:center; padding:7px; }
</style>
<div class="page"><div class="hdr"><div class="l"><h1>${cfg.title}</h1><h2>${dayLine}</h2></div>
<div class="k"><b>KEY</b><div class="chips">${cfg.legend.map(([l, c]) => `<div class="chip" style="background:${colors[c]}">${l}</div>`).join("")}</div></div></div>
${spec.map((g) => `<div class="grp"><div class="cards">${g.members.map((n, i) => card(g.cards[i], n)).join("")}</div><div class="bar" style="background:${colors[g.color]}">${g.name}</div></div>`).join("")}
${spec.length ? "" : `<p style="margin-top:40px;font-size:18px">No ${BOARD} crew placed on the board today.</p>`}</div>`;

fs.mkdirSync(OUT_DIR, { recursive: true });
const base = path.join(OUT_DIR, `${cfg.title.replace(/\b\w+/g, (w) => w[0] + w.slice(1).toLowerCase())} ${fileDate}`);
const tmpHtml = path.join(os.tmpdir(), `crew-${BOARD}.html`);
fs.writeFileSync(tmpHtml, html);
execFileSync(CHROME, ["--headless", "--disable-gpu", "--no-pdf-header-footer", `--print-to-pdf=${base}.pdf`, `file://${tmpHtml}`], { stdio: "ignore" });
// PNG too — same page, letter proportions at 2x, cropped to content by Chrome
execFileSync(CHROME, ["--headless", "--disable-gpu", "--hide-scrollbars", "--window-size=920,1190", "--force-device-scale-factor=2", `--screenshot=${base}.png`, `file://${tmpHtml}`], { stdio: "ignore" });
fs.writeFileSync(`${base}.txt`, [
  `${cfg.title} — ${dayLine}`, `board saved ${rows[0]?.updated_at}`, "",
  ...spec.map((g) => `${g.name.padEnd(22)} ${g.color.padEnd(7)} ${g.members.join(", ")}`), "", "--- receipt ---", ...receipt, "",
].join("\n"));
console.log(`${base}.pdf + .png — ${spec.length} groups, ${spec.reduce((n, g) => n + g.members.length, 0)} people; ${receipt.filter((r) => r.startsWith("skip") || r.startsWith("miss")).length} flags (see .txt)`);
