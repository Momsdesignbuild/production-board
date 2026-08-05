// Live read of the "Job Hours Tracker_2026.xlsx" -> "Weekly Job Tracking" sheet
// via Microsoft Graph's Excel API. Returns jobs currently in "Build" status,
// tagged by section (LANDSCAPING / R&C) exactly as they appear in the sheet.
//
// Credentials come from Vercel project env vars, never from client code:
//   MDB_TENANT_ID, MDB_CLIENT_ID, MDB_CLIENT_SECRET, MDB_DRIVE_ID

const DRIVE_ID = process.env.MDB_DRIVE_ID;
const FILE_PATH = "/PM - LANDSCAPE/2 DEPARTMENT RESOURCES/Tracker - Job Hours/Job Hours Tracker_2026.xlsx";
const SHEET_NAME = "Weekly Job Tracking";

async function getToken() {
  const url = `https://login.microsoftonline.com/${process.env.MDB_TENANT_ID}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: process.env.MDB_CLIENT_ID,
    scope: "https://graph.microsoft.com/.default",
    client_secret: process.env.MDB_CLIENT_SECRET,
    grant_type: "client_credentials",
  });
  const resp = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  if (!resp.ok) throw new Error(`token failed: ${resp.status}`);
  const j = await resp.json();
  return j.access_token;
}

export default async function handler(req, res) {
  try {
    const token = await getToken();
    const headers = { Authorization: `Bearer ${token}` };
    const encodedPath = FILE_PATH.split("/").map(encodeURIComponent).join("/");

    const itemResp = await fetch(`https://graph.microsoft.com/v1.0/drives/${DRIVE_ID}/root:${encodedPath}`, { headers });
    if (!itemResp.ok) throw new Error(`item lookup failed: ${itemResp.status}`);
    const item = await itemResp.json();

    const wsResp = await fetch(`https://graph.microsoft.com/v1.0/drives/${DRIVE_ID}/items/${item.id}/workbook/worksheets`, { headers });
    if (!wsResp.ok) throw new Error(`worksheets failed: ${wsResp.status}`);
    const ws = await wsResp.json();
    const sheet = ws.value.find((w) => w.name === SHEET_NAME);
    if (!sheet) throw new Error(`sheet "${SHEET_NAME}" not found`);

    const rangeResp = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${DRIVE_ID}/items/${item.id}/workbook/worksheets/${sheet.id}/usedRange(valuesOnly=true)`,
      { headers }
    );
    if (!rangeResp.ok) throw new Error(`range failed: ${rangeResp.status}`);
    const range = await rangeResp.json();
    const vals = range.values || [];

    // Column layout (row index 1 = header row):
    // A=STATUS  B=DESIGNER  C=PM  D=CREW  E=JOB  F=%LEFT  G=BID  H=ACTUAL  I=BALANCE
    let currentSection = null;
    const jobs = [];
    for (let i = 2; i < vals.length; i++) {
      const row = vals[i];
      const colA = (row[0] || "").toString().trim();
      if (colA === "LANDSCAPING" || colA === "R&C") {
        currentSection = colA;
        continue;
      }
      if (colA === "Build") {
        const job = (row[4] || "").toString().trim();
        if (!job) continue;
        jobs.push({
          section: currentSection,
          job: job,
          bid: typeof row[6] === "number" ? row[6] : null,
          act: typeof row[7] === "number" ? row[7] : null,
          left: typeof row[8] === "number" ? row[8] : null,
        });
      }
    }

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
    res.status(200).json({ jobs, fetchedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
