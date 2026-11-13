// Runs on the MDB mini every 5 min (launchd com.momsbot.board-punch-log): BuilderTrend time clock -> crew_log, for people on the Trench / Hammer rosters.
// Feeds the board's Logs popup. Upserts by BT shift id, so a clock-out later just updates the same row.
// Separate from the board and the cards: roster files give names + which crew, nothing is read from or written to board_state.
//   node scripts/punch-log.mjs [--force]      (outside 5:00-19:00 Central it exits unless --force)
import fs from "node:fs"; import path from "node:path";
import { btGetJson } from "../../moms-bot/scripts/bt-client.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SUPABASE_URL = process.env.SUPABASE_URL || "https://lufrguiekfkhtxsgcqjo.supabase.co";
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; if (!KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing (run via punch-log.sh)");
const hour = Number(new Date().toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "America/Chicago" }));
if (!process.argv.includes("--force") && (hour < 5 || hour >= 19)) { console.log(`hour ${hour}: outside 5-19, skipping`); process.exit(0); }

const toks = (s) => String(s || "").toLowerCase().replace(/[^a-z ]+/g, " ").split(/\s+/).filter(Boolean);
// roster name ~ BuilderTrend name when every token of the shorter is in the longer ("Jose Navarro Alba" ~ "Jose Guadalupe Navarro Alba")
const same = (a, b) => { const x = toks(a), y = toks(b); const [s, l] = x.length <= y.length ? [x, y] : [y, x]; return s.length >= 2 && s.every((t) => l.includes(t)); };
const rosterOf = (f) => Object.values(JSON.parse(fs.readFileSync(path.join(ROOT, "crew", f), "utf8")).crews).flatMap((c) => c.members);
const crews = { trench: rosterOf("crew-map.json"), hammer: rosterOf("hammer-map.json") };

const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const rows = (await btGetJson(`/api/TimeClock/List?startDate=${today}&endDate=${today}`))?.data?.timeclocks || []; // BT returns its latest ~2 weeks whatever the range (verified 2026-11-13)
const out = [];
for (const r of rows) {
  if (!r.name || !r.jobName || !r.timeIn || !r.id) continue;
  for (const [crew, names] of Object.entries(crews)) {
    const n = names.find((m) => same(m, r.name)); if (!n) continue;
    out.push({ id: r.id, crew, name: n, job: r.jobName, date: String(r.timeIn).slice(0, 10), time_in: r.timeIn, time_out: r.timeOut || null, updated_at: new Date().toISOString() });
    break;
  }
}
if (!out.length) { console.log("no roster punches"); process.exit(0); }
const up = await fetch(`${SUPABASE_URL}/rest/v1/crew_log?on_conflict=id`, { method: "POST", headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(out) });
if (!up.ok) throw new Error(`crew_log upsert failed ${up.status}: ${(await up.text()).slice(0, 200)}`);
console.log(`${new Date().toISOString()} ${out.length} shifts upserted (${out.filter((o) => o.crew === "trench").length} trench, ${out.filter((o) => o.crew === "hammer").length} hammer)`);
