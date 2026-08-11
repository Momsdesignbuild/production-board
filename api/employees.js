// Pulls production-crew headshots from the company's SharePoint "Employee
// Photos" library so they show up in the badge tray automatically — same
// Microsoft Graph pattern as api/jobs.js, but a different SharePoint site
// (this one is "Mom's Design Build Employee Resources", not "PM - LANDSCAPE").
//
// Folder layout (each employee has their own subfolder containing one photo):
//   Employee Photos/Current/BUILD - LA/<Name YEAR>/<photo>
//   Employee Photos/Current/BUILD - R&C/<Name YEAR>/<photo>
//
// Required Vercel env vars (same Azure AD app registration as jobs.js):
//   MDB_TENANT_ID, MDB_CLIENT_ID, MDB_CLIENT_SECRET
//
// MDB_EMPLOYEE_SITE_ID / MDB_EMPLOYEE_DRIVE_ID aren't known yet — use the
// debug modes below (once, from a browser) to resolve them, then set them
// as env vars so normal requests skip straight to reading the folders:
//   ?debug=site                        -> resolves the SharePoint site
//   ?debug=drives&site=ID              -> lists document libraries (drives) on that site
//   ?debug=children&drive=ID&path=...  -> lists items at a path within a drive

const TENANT_ID = process.env.MDB_TENANT_ID;
const CLIENT_ID = process.env.MDB_CLIENT_ID;
const CLIENT_SECRET = process.env.MDB_CLIENT_SECRET;
const SITE_ID = process.env.MDB_EMPLOYEE_SITE_ID;
const DRIVE_ID = process.env.MDB_EMPLOYEE_DRIVE_ID;

const SITE_HOSTNAME = "mldl.sharepoint.com";
const SITE_PATH = "/sites/Mom'sDesignBuildEmployeeResources";
const BASE_FOLDER =
  "BUSINESS OFFICE/Human Resources/2 DEPARTMENT RESOURCES/5 Office Projects/Employee Photos/Current";
const CREW_FOLDERS = ["BUILD - LA", "BUILD - R&C"];

// a handful of crew photos live as a single loose file directly in a crew
// folder (a group shot) instead of the usual one-person-per-subfolder
// pattern — listed explicitly here since there's no way to tell "this loose
// file is a badge" from "this loose file is clutter" automatically.
const EXTRA_PHOTOS = [
  { crewFolder: "BUILD - LA", fileName: "RM - Julio_Ernesto_Hugo.png", label: "Julio, Ernesto & Hugo", id: "rm-julio-ernesto-hugo" },
];

// specific people outside the two BUILD crews (office/PM/shop staff) who get
// a badge individually, without pulling in everyone else from their crew
// folder — add more here (crewFolder + exact subfolder name) as needed.
const EXTRA_EMPLOYEE_FOLDERS = [
  { crewFolder: "PROJECT MANAGEMENT", folderName: "Kelly Lindell 2024" },
  { crewFolder: "SHOP & YARD", folderName: "Tony Clapp 2024" },
  { crewFolder: "COMMERCIAL", folderName: "Alex Birkenbeuel 2026" },
  { crewFolder: "PROJECT MANAGEMENT", folderName: "Jay Forbes 2024" },
  { crewFolder: "SHOP & YARD", folderName: "Max Weckman 2020" },
  { crewFolder: "SHOP & YARD", folderName: "Joe Smyth 2018" },
];

// forces a specific badge's photo instead of whatever OneDrive's folder
// happens to return — used when someone wants a different picture than
// what's on file there. Keyed by the same synthetic ezoId the badge gets
// below. Files live at the repo root under /badges and are served as
// static assets, so they don't expire like OneDrive's signed thumbnail URLs.
const PHOTO_OVERRIDES = {
  "od-extra-alex-birkenbeuel": "/badges/alex-birkenbeuel.png",
};

async function getToken() {
  const url = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    scope: "https://graph.microsoft.com/.default",
    client_secret: CLIENT_SECRET,
    grant_type: "client_credentials",
  });
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!resp.ok) throw new Error(`token failed: ${resp.status}`);
  const j = await resp.json();
  return j.access_token;
}

function encodePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function firstImage(children) {
  return (children || []).find((c) => c.file && /\.(jpe?g|png|heic|webp)$/i.test(c.name || ""));
}

// prefer a small server-generated thumbnail over the full original file —
// these are phone camera photos, often several MB each; loading 26+ of
// those at full size is what was making the tray crawl. "medium" (~176px)
// is plenty for a ~90px badge and is typically tens of KB, not megabytes.
function photoUrl(item) {
  const thumbs = item.thumbnails && item.thumbnails[0];
  if (thumbs) {
    const pick = thumbs.medium || thumbs.large || thumbs.small;
    if (pick && pick.url) return pick.url;
  }
  return item["@microsoft.graph.downloadUrl"] || null;
}

export default async function handler(req, res) {
  if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET) {
    res.status(500).json({ error: "Missing MDB_TENANT_ID / MDB_CLIENT_ID / MDB_CLIENT_SECRET" });
    return;
  }

  try {
    const token = await getToken();
    const headers = { Authorization: `Bearer ${token}` };
    const q = req.query || {};

    if (q.debug === "site") {
      const r = await fetch(`https://graph.microsoft.com/v1.0/sites/${SITE_HOSTNAME}:${SITE_PATH}`, { headers });
      res.status(200).json(await r.json());
      return;
    }

    if (q.debug === "drives") {
      const siteId = q.site || SITE_ID;
      const r = await fetch(`https://graph.microsoft.com/v1.0/sites/${siteId}/drives`, { headers });
      res.status(200).json(await r.json());
      return;
    }

    if (q.debug === "children") {
      const driveId = q.drive || DRIVE_ID;
      const path = q.path || BASE_FOLDER;
      const r = await fetch(
        `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encodePath(path)}:/children?$top=200`,
        { headers }
      );
      res.status(200).json(await r.json());
      return;
    }

    if (!SITE_ID || !DRIVE_ID) {
      res.status(500).json({
        error:
          "MDB_EMPLOYEE_SITE_ID / MDB_EMPLOYEE_DRIVE_ID aren't set yet — call ?debug=site then ?debug=drives to find them.",
      });
      return;
    }

    // fetch each employee folder's contents in parallel — sequentially
    // awaiting one Graph call per person (26+ and growing) is what was
    // pushing this past 30 seconds and risking a serverless timeout.
    let items = [];
    for (const crewFolder of CREW_FOLDERS) {
      const folderPath = `${BASE_FOLDER}/${crewFolder}`;
      const listResp = await fetch(
        `https://graph.microsoft.com/v1.0/drives/${DRIVE_ID}/root:/${encodePath(folderPath)}:/children?$top=200&$expand=thumbnails`,
        { headers }
      );
      if (!listResp.ok) continue;
      const listData = await listResp.json();
      const employeeFolders = (listData.value || []).filter((it) => it.folder);

      EXTRA_PHOTOS.filter((e) => e.crewFolder === crewFolder).forEach((extra) => {
        const fileItem = (listData.value || []).find((it) => it.file && it.name === extra.fileName);
        if (!fileItem) return;
        items.push({ ezoId: "od-static-" + extra.id, name: extra.label, category: "employee", photo: photoUrl(fileItem) });
      });

      const folderItems = await Promise.all(
        employeeFolders.map(async (folder) => {
          const childResp = await fetch(
            `https://graph.microsoft.com/v1.0/drives/${DRIVE_ID}/items/${folder.id}/children?$top=20&$expand=thumbnails`,
            { headers }
          );
          if (!childResp.ok) return null;
          const childData = await childResp.json();
          const photo = firstImage(childData.value);
          if (!photo) return null;
          // folder names look like "Pedro Jimenez 2007" — strip the trailing
          // 4-digit year (looks like a hire year, not part of the display name).
          const name = folder.name.replace(/\s+\d{4}$/, "").trim();
          return {
            // reuses the same generic external-id field the board already
            // dedups on (data-ezo-id) — "od-" prefix keeps it distinct from
            // EZOfficeInventory's numeric asset ids.
            ezoId: "od-" + folder.id,
            name: name,
            category: "employee",
            photo: photoUrl(photo),
          };
        })
      );
      items = items.concat(folderItems.filter(Boolean));
    }

    const extraItems = await Promise.all(
      EXTRA_EMPLOYEE_FOLDERS.map(async (extra) => {
        const folderPath = `${BASE_FOLDER}/${extra.crewFolder}/${extra.folderName}`;
        const childResp = await fetch(
          `https://graph.microsoft.com/v1.0/drives/${DRIVE_ID}/root:/${encodePath(folderPath)}:/children?$top=20&$expand=thumbnails`,
          { headers }
        );
        if (!childResp.ok) return null;
        const childData = await childResp.json();
        let photo = firstImage(childData.value);
        if (!photo) {
          // some folders don't have the photo directly inside — it's nested
          // one level deeper in a "_Current Promotional Photo" subfolder.
          const nested = (childData.value || []).find(
            (it) => it.folder && /current promotional photo/i.test(it.name || "")
          );
          if (nested) {
            const nestedResp = await fetch(
              `https://graph.microsoft.com/v1.0/drives/${DRIVE_ID}/items/${nested.id}/children?$top=20&$expand=thumbnails`,
              { headers }
            );
            if (nestedResp.ok) {
              const nestedData = await nestedResp.json();
              photo = firstImage(nestedData.value);
            }
          }
        }
        if (!photo) return null;
        const name = extra.folderName.replace(/\s+\d{4}$/, "").trim();
        const ezoId = "od-extra-" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        return {
          ezoId,
          name,
          category: "employee",
          photo: PHOTO_OVERRIDES[ezoId] || photoUrl(photo),
        };
      })
    );
    items = items.concat(extraItems.filter(Boolean));

    res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=3600");
    res.status(200).json({ items, fetchedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
