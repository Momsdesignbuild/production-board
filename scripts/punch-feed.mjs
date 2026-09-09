// Runs on the MDB mini: today's first BuilderTrend punch per person → crew_punches.
// launchd every 15 min 6:30–9:30 weekdays (com.momsbot.board-punch-feed).
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (.env.sheet). BT session comes from moms-bot.
import { btGetJson } from "../../moms-bot/scripts/bt-client.mjs";
const SUPABASE_URL = process.env.SUPABASE_URL || "https://lufrguiekfkhtxsgcqjo.supabase.co";
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; if (!KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing");
const date = process.argv[2] || new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const res = await btGetJson(`/api/TimeClock/List?startDate=${date}&endDate=${date}`);
const rows = (res?.data?.timeclocks || []).filter((r) => String(r.timeIn).startsWith(date) && r.name && r.jobName).sort((a, b) => (a.timeIn < b.timeIn ? -1 : 1));
const first = {};
for (const r of rows) if (!first[r.name]) first[r.name] = { date, name: r.name, job: r.jobName, punched_at: r.timeIn + "-05:00" }; // BT returns Central wall time; ponytail: -06:00 in winter — only affects the displayed minute, not the day
const body = Object.values(first);
if (!body.length) { console.log(`${date}: no punches yet`); process.exit(0); }
const up = await fetch(`${SUPABASE_URL}/rest/v1/crew_punches`, {
  method: "POST", headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
  body: JSON.stringify(body.map((p) => ({ ...p, updated_at: new Date().toISOString() }))),
});
if (!up.ok) throw new Error(`crew_punches upsert failed ${up.status}: ${(await up.text()).slice(0, 200)}`);
console.log(`${date}: ${body.length} first punches written`);
