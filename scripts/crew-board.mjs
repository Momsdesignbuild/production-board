// Trench Time → PDF + PNG + receipt on disk. Same engine as the board's button.
//   node scripts/crew-board.mjs --board trench --out ~/Desktop [--shop "Joe Smyth,Chris Moller"]
import fs from "node:fs"; import path from "node:path"; import os from "node:os"; import { execFileSync } from "node:child_process";
import { buildSpec, loadCrewConfig, renderHtml, dateLine, fileDate } from "../lib/crew-board.js";
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT_DIR = arg("--out", path.join(os.homedir(), "Desktop")).replace(/^~/, os.homedir());
const shopArg = arg("--shop", null); const shop = shopArg === null ? undefined : shopArg.split(",").map((s) => s.trim()).filter(Boolean);
const crew = loadCrewConfig(arg("--board", "trench"));
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; if (!KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing");
const SUPABASE_URL = process.env.SUPABASE_URL || "https://lufrguiekfkhtxsgcqjo.supabase.co";
const rows = await fetch(`${SUPABASE_URL}/rest/v1/board_state?id=eq.1&select=data,updated_at`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } }).then((r) => r.json());
const { spec, receipt, candidates } = buildSpec(rows[0]?.data || {}, crew, shop);
const photoSrc = (p) => { if (typeof p !== "string" || !p) return null; if (/^(data:image|https?:)/.test(p)) return p; const f = path.join(ROOT, p.replace(/^\//, "")); return fs.existsSync(f) ? `data:image/${f.endsWith(".png") ? "png" : "jpeg"};base64,${fs.readFileSync(f).toString("base64")}` : null; };
const html = renderHtml(spec, crew.cfg, photoSrc);
fs.mkdirSync(OUT_DIR, { recursive: true });
const base = path.join(OUT_DIR, `${crew.cfg.title.replace(/\b\w+/g, (w) => w[0] + w.slice(1).toLowerCase())} ${fileDate()}`);
const tmp = path.join(os.tmpdir(), "crew-board.html"); fs.writeFileSync(tmp, html);
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
execFileSync(CHROME, ["--headless", "--disable-gpu", "--no-pdf-header-footer", `--print-to-pdf=${base}.pdf`, `file://${tmp}`], { stdio: "ignore" });
execFileSync(CHROME, ["--headless", "--disable-gpu", "--hide-scrollbars", "--window-size=920,1190", "--force-device-scale-factor=2", `--screenshot=${base}.png`, `file://${tmp}`], { stdio: "ignore" });
fs.writeFileSync(`${base}.txt`, [`${crew.cfg.title} — ${dateLine()}`, `board saved ${rows[0]?.updated_at}`, "", ...spec.map((g) => `${g.name.padEnd(22)} ${g.color.padEnd(7)} ${g.members.join(", ")}`), "", "shop candidates: " + candidates.map((c) => `${c.name} (${c.where}${c.pinned ? ", pinned" : ""})`).join("; "), "", "--- receipt ---", ...receipt, ""].join("\n"));
console.log(`${base}.pdf + .png — ${spec.length} groups, ${spec.reduce((n, g) => n + g.members.length, 0)} people`);
