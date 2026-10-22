// Morning refresh of BID/ACT/LEFT on both boards (runs on the MDB mini, 6:20am, after the 6:00 rollover).
//   node scripts/refresh-budgets.mjs          # dry run: prints what would change, writes nothing
//   node scripts/refresh-budgets.mjs --write  # PATCH board_state (jobs numbers only; cards/drawing untouched)
// Env from .env.sheet (SUPABASE_*, MDB_* Graph creds).
import jobsHandler from "../api/jobs.js";
import { refreshBudgets } from "../lib/budgets.js";

const WRITE = process.argv.includes("--write");
const URL_ = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

let body;
await jobsHandler({}, { setHeader() {}, status: () => ({ json: (j) => (body = j) }) });
if (!body?.jobs?.length) { console.error("tracker pull failed:", body?.error || "no jobs"); process.exit(1); }

for (const [id, name, section] of [[1, "LA", "LANDSCAPING"], [2, "R&C", "R&C"]]) {
  const [row] = await (await fetch(`${URL_}/rest/v1/board_state?id=eq.${id}&select=data`, { headers: H })).json();
  const r = refreshBudgets(row.data, body.jobs, section);
  console.log(`${name}: ${r.changed.length} changed, ${r.unmatched.length} not in tracker${r.unmatched.length ? " (" + r.unmatched.join("; ") + ")" : ""}`);
  r.changed.forEach((c) => console.log(`  ${c.name}: ${c.from} -> ${c.to}`));
  if (WRITE && r.changed.length) {
    const w = await fetch(`${URL_}/rest/v1/board_state?id=eq.${id}`, { method: "PATCH", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify({ data: r.data, updated_at: new Date().toISOString() }) });
    if (!w.ok) { console.error(`${name} write failed: ${w.status}`); process.exit(1); }
    console.log(`  ${name} written`);
  }
}
