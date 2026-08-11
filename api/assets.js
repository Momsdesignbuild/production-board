// Pulls trucks/equipment/trailers from EZOfficeInventory's asset list so
// they can be auto-added as badges instead of created by hand.
//
// Required Vercel env vars (set in the project, never in client code):
//   EZO_SUBDOMAIN   — the part before ".ezofficeinventory.com" in your account URL
//   EZO_API_TOKEN   — an API access token from EZOfficeInventory (Settings > Integrations > API)
//
// Optional env vars to control which EZO group ("Trucks", "Trailers", "Heavy
// Equipment", etc.) maps to which board category — comma-separated,
// case-insensitive EXACT match against the group name (not substring, so a
// group like "Roll Off Dumpster Trucks" doesn't silently fall into "truck"
// just because the word appears in its name). Defaults match this account's
// actual group names:
//   EZO_TRUCK_GROUPS      (default: "trucks")
//   EZO_EQUIPMENT_GROUPS  (default: "heavy equipment,small engine equipment")
//   EZO_TRAILER_GROUPS    (default: "trailers")
//   EZO_EMPLOYEE_GROUPS   (default: "employees,staff,crew")
// Add your own group names (comma-separated) if the account's groups don't
// match these defaults, or if a new group needs to be mapped in.

const SUBDOMAIN = process.env.EZO_SUBDOMAIN;
const API_TOKEN = process.env.EZO_API_TOKEN;

function groupList(envVal, fallback) {
  return (envVal || fallback).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

function categorize(groupName) {
  const name = (groupName || "").toLowerCase().trim();
  const trucks = groupList(process.env.EZO_TRUCK_GROUPS, "trucks");
  const equipment = groupList(process.env.EZO_EQUIPMENT_GROUPS, "heavy equipment,small engine equipment");
  const trailers = groupList(process.env.EZO_TRAILER_GROUPS, "trailers");
  const employees = groupList(process.env.EZO_EMPLOYEE_GROUPS, "employees,staff,crew");
  if (trailers.includes(name)) return "trailer";
  if (equipment.includes(name)) return "equipment";
  if (trucks.includes(name)) return "truck";
  if (employees.includes(name)) return "employee";
  return null;
}

export default async function handler(req, res) {
  if (!SUBDOMAIN || !API_TOKEN) {
    res.status(500).json({
      error:
        "EZOfficeInventory isn't configured yet — set EZO_SUBDOMAIN and EZO_API_TOKEN in the Vercel project's environment variables.",
    });
    return;
  }

  try {
    const base = `https://${SUBDOMAIN}.ezofficeinventory.com`;
    const headers = { Authorization: `Bearer ${API_TOKEN}` };

    // asset objects only carry a numeric group_id, so fetch the group list
    // once and build an id -> name map, then filter to just the groups that
    // map to a board category (trucks/equipment/trailers) — no need to page
    // through the ~600 total assets belonging to irrelevant groups.
    const groupsResp = await fetch(`${base}/api/v2/groups.api`, { headers });
    if (!groupsResp.ok) throw new Error(`groups request failed: ${groupsResp.status}`);
    const groupsData = await groupsResp.json();
    const groupCategory = {};
    (groupsData.groups || []).forEach((g) => {
      const cat = categorize(g.name);
      if (cat) groupCategory[g.id] = cat;
    });

    if (req.query && req.query.debug === "page") {
      const page = req.query.page || "1";
      const r = await fetch(`${base}/api/v2/assets.api?page=${page}`, { headers });
      const body = await r.json();
      res.status(200).json({
        httpStatus: r.status,
        metadata: body.metadata,
        count: (body.assets || []).length,
        ids: (body.assets || []).map((a) => a.id),
      });
      return;
    }

    if (req.query && req.query.debug) {
      res.status(200).json({
        groups: (groupsData.groups || []).map((g) => ({ id: g.id, name: g.name, mappedCategory: groupCategory[g.id] || null })),
      });
      return;
    }

    if (req.query && req.query.id) {
      const r = await fetch(`${base}/api/v2/assets/${req.query.id}.api`, { headers });
      const body = await r.json();
      res.status(200).json({ status: r.status, body });
      return;
    }

    // one-off lookup: find where a specific asset (by name substring) actually
    // lives right now, regardless of whether its group maps to a category —
    // useful when a badge on the board has an ezoId that's stopped showing up
    // in the normal pull, to see what group/status it moved to.
    if (req.query && req.query.search) {
      const groupNameById = {};
      (groupsData.groups || []).forEach((g) => { groupNameById[g.id] = g.name; });
      const needle = req.query.search.toLowerCase();
      const page1Resp = await fetch(`${base}/api/v2/assets.api?page=1`, { headers });
      const page1Data = await page1Resp.json();
      const totalPages = (page1Data.metadata && page1Data.metadata.total_pages) || 1;
      let all = page1Data.assets || [];
      if (totalPages > 1) {
        const rest = await Promise.all(
          Array.from({ length: totalPages - 1 }, (_, i) => i + 2).map(async (page) => {
            const resp = await fetch(`${base}/api/v2/assets.api?page=${page}`, { headers });
            if (!resp.ok) return [];
            const data = await resp.json();
            return data.assets || [];
          })
        );
        all = all.concat(...rest);
      }
      const matches = all
        .filter((a) => (a.name || "").toLowerCase().includes(needle))
        .map((a) => ({ id: a.id, name: a.name, group_id: a.group_id, group_name: groupNameById[a.group_id] || null, status: a.status }));
      res.status(200).json({ matches, totalScanned: all.length });
      return;
    }

    const extractItems = (assets) =>
      (assets || [])
        .map((a) => {
          let category = groupCategory[a.group_id];
          if (!category) return null;
          const name = a.name || a.identifier || `Asset ${a.id}`;
          // roll-off dumpsters live in the same EZOfficeInventory "Trucks"
          // group as actual trucks (that's how the account is organized) and
          // stay filed under the same "Trucks" filter as real trucks — just
          // with a more useful name.
          let displayName = name;
          if (category === "truck" && /dumpster/i.test(name)) {
            // the physical units have a size-code painted on the side (e.g.
            // "20-2", "10-3") — EZOfficeInventory tracks that in
            // product_model_number. Units without one (nothing painted on
            // them yet) just keep the generic "Roll Off Dumpster" name.
            if (a.product_model_number) displayName = a.product_model_number;
          }
          // EZOfficeInventory returns the literal string "/images/no-image.jpg"
          // (a relative path into ITS OWN app, not ours) for assets that have
          // no photo uploaded — passed through as-is, the board tried to load
          // that path off our own domain, which 404s and renders as a flat
          // gray box. Treat it the same as no photo at all.
          const photo = a.display_image && !/no-image\.jpg$/i.test(a.display_image) ? a.display_image : null;
          return { ezoId: a.id, name: displayName, category, photo };
        })
        .filter(Boolean);

    // fetches a page with retries — EZOfficeInventory rate-limits bursts of
    // concurrent requests (occasional 429/5xx), and silently treating a
    // failed page as "empty" was quietly dropping whole pages worth of
    // assets from every sync, differently each time. Failing loudly (after
    // retrying) beats silently returning incomplete data.
    async function fetchPage(page, attempt) {
      attempt = attempt || 1;
      const resp = await fetch(`${base}/api/v2/assets.api?page=${page}`, { headers });
      if (resp.ok) return resp.json();
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 400 * attempt));
        return fetchPage(page, attempt + 1);
      }
      throw new Error(`page ${page} failed after ${attempt} attempts: ${resp.status}`);
    }

    // runs the page fetches with bounded concurrency instead of firing all
    // of them at once — the all-at-once burst is exactly what was triggering
    // EZOfficeInventory's rate limiting in the first place.
    async function fetchPagesThrottled(pages, concurrency) {
      const results = new Array(pages.length);
      let next = 0;
      async function worker() {
        while (next < pages.length) {
          const i = next++;
          results[i] = await fetchPage(pages[i]);
        }
      }
      await Promise.all(Array.from({ length: Math.min(concurrency, pages.length) }, worker));
      return results;
    }

    const page1Data = await fetchPage(1);
    const totalPages = (page1Data.metadata && page1Data.metadata.total_pages) || 1;

    let items = extractItems(page1Data.assets);

    if (totalPages > 1) {
      const restPages = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
      const pageResults = await fetchPagesThrottled(restPages, 5);
      pageResults.forEach((data) => {
        items = items.concat(extractItems(data.assets));
      });
    }

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    res.status(200).json({ items, fetchedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
