// Day rollover (runs inside GET /api/board-history?date=today): if a plan was saved for today (board_history[today]) and the
// live board hasn't been touched yet today, the plan becomes the live board.
// Idempotent — once board_state is saved today, history[today] mirrors it.
import { todayStr } from "./today.js";

export async function promotePlan(SUPABASE_URL, SERVICE_KEY) {
  const H = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
  const today = todayStr();
  const [liveResp, planResp] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/board_state?id=eq.1&select=updated_at`, { headers: H }),
    fetch(`${SUPABASE_URL}/rest/v1/board_history?date=eq.${today}&select=data`, { headers: H }),
  ]);
  if (!liveResp.ok) throw new Error(`board_state read failed: ${liveResp.status}`);
  if (!planResp.ok) throw new Error(`board_history read failed: ${planResp.status}`);
  const live = (await liveResp.json())[0];
  const plan = (await planResp.json())[0];
  if (!plan) return { promoted: false, reason: "no plan for today" };
  if (live && todayStr(new Date(live.updated_at)) >= today) return { promoted: false, reason: "live board already saved today" };

  const resp = await fetch(`${SUPABASE_URL}/rest/v1/board_state?id=eq.1`, {
    method: "PATCH",
    headers: { ...H, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ data: plan.data, updated_at: new Date().toISOString() }),
  });
  if (!resp.ok) throw new Error(`board_state write failed: ${resp.status}`);
  return { promoted: true, date: today };
}
