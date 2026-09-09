import { todayStr } from "../lib/today.js";
// "How long has this dumpster been on job X?" — answered properly this
// time. Each card now carries a laneId captured client-side (see
// computeLaneId() in index.html), telling us exactly which job's slot a
// badge is sitting in (a job's general lane, or its dumpster/sign/camera
// cutout) — not just raw x/y pixels. This scans board_history day by day
// and, for every badge, finds the most recent date its laneId changed.
// Days since that date is how long it's been sitting on that job.
// Badges not currently in any tracked lane (floating on the open board,
// or sitting in a general equipment/truck/tray pool) are left out — there's
// no "job" to report a duration against for those.

const SUPABASE_URL = process.env.SUPABASE_URL || "https://lufrguiekfkhtxsgcqjo.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const CUTOUT_LABELS = { dumpster: "Dumpster slot", sign: "Sign slot", camera: "Camera slot" };
const POOL_LABELS = {
  unavail: "Unavailable pool", vaca: "Vacation pool", trucks: "Trucks pool",
  equipment: "Equipment pool", trailers: "Trailers pool", dumpster: "Dumpster pool",
  signs: "Signs pool", camera: "Camera pool",
};

function daysBetween(a, b) {
  const ms = new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z");
  return Math.round(ms / (24 * 60 * 60 * 1000));
}

function laneLabel(laneId, jobs) {
  const jobMatch = /^job(\d+)(?:-(dumpster|sign|camera))?$/.exec(laneId);
  if (jobMatch) {
    const idx = parseInt(jobMatch[1], 10);
    const jobName = (jobs && jobs[idx] && jobs[idx].name) || "(unnamed job)";
    const slot = jobMatch[2] ? " — " + CUTOUT_LABELS[jobMatch[2]] : " — general lane";
    return jobName + slot;
  }
  return POOL_LABELS[laneId] || laneId;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }
  if (!SERVICE_KEY) {
    res.status(500).json({ error: "server isn't configured (SUPABASE_SERVICE_ROLE_KEY)" });
    return;
  }

  try {
    const [historyResp, liveResp] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/board_history?select=date,data&order=date.asc`, {
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      }),
      fetch(`${SUPABASE_URL}/rest/v1/board_state?id=eq.1&select=data`, {
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      }),
    ]);
    if (!historyResp.ok) throw new Error(`board_history read failed: ${historyResp.status}`);
    if (!liveResp.ok) throw new Error(`board_state read failed: ${liveResp.status}`);

    const historyRows = await historyResp.json();
    const liveRows = await liveResp.json();
    const today = todayStr();
    const liveData = liveRows[0]?.data;

    // only past + today are "what actually happened" — board_history can
    // hold future plans too, which would corrupt the duration math.
    const days = historyRows.filter((r) => r.date <= today && r.date !== today);
    if (liveData) days.push({ date: today, data: liveData });
    days.sort((a, b) => (a.date < b.date ? -1 : 1));

    if (days.length === 0) {
      res.status(200).json({ items: [], daysTracked: 0 });
      return;
    }

    const lastLane = {}; // ezoId -> { date, laneId, key }
    const lastSeen = {}; // ezoId -> latest card (for label/category)

    // A lane is a row on the board; a JOB is whatever name sits in that row
    // (typed or picked from the tracker — both are just text). If the name
    // in the row changes, the badge is on a new job even though it never
    // moved, so the counter must restart. Key = lane + normalized job name.
    const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const laneKey = (laneId, jobs) => {
      const m = /^job(\d+)/.exec(laneId);
      return m ? laneId + "|" + norm(jobs[Number(m[1])]?.name) : laneId;
    };

    for (const day of days) {
      const cards = (day.data && day.data.cards) || [];
      const jobs = (day.data && day.data.jobs) || [];
      for (const card of cards) {
        if (!card.ezoId || !card.laneId) continue;
        const key = laneKey(card.laneId, jobs);
        const prev = lastLane[card.ezoId];
        if (!prev || prev.key !== key) {
          lastLane[card.ezoId] = { date: day.date, laneId: card.laneId, key };
        }
        lastSeen[card.ezoId] = card;
      }
    }

    const latestDate = days[days.length - 1].date;
    const latestJobs = (liveData && liveData.jobs) || [];

    // only report items CURRENTLY in a lane — an item that moved off a lane
    // at some point in history but isn't sitting in one today has no
    // current "how long has it been here" to report.
    const items = Object.keys(lastLane)
      .filter((ezoId) => lastSeen[ezoId] && lastSeen[ezoId].laneId)
      .map((ezoId) => {
        const card = lastSeen[ezoId];
        const since = lastLane[ezoId].date;
        return {
          ezoId,
          label: card.label || null,
          category: card.category || null,
          laneId: card.laneId,
          laneLabel: laneLabel(card.laneId, latestJobs),
          sinceDate: since,
          daysInPlace: daysBetween(since, latestDate),
        };
      });
    items.sort((a, b) => b.daysInPlace - a.daysInPlace);

    res.status(200).json({
      items,
      daysTracked: days.length,
      earliestDate: days[0].date,
      latestDate,
      rollup: {
        over7d: items.filter((i) => i.daysInPlace >= 7).length,
        over30d: items.filter((i) => i.daysInPlace >= 30).length,
        over90d: items.filter((i) => i.daysInPlace >= 90).length,
      },
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
}
