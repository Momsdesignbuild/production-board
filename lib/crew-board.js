// Trench Time from the production board. Pure: state in, spec + HTML out.
// Used by /api/analytics (board button) and scripts/crew-board.mjs (files).
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
export function loadCrewConfig(board = "trench") {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "crew", board + ".json"), "utf8"));
  const roster = JSON.parse(fs.readFileSync(path.join(ROOT, "crew", cfg.roster), "utf8")).crews;
  return { cfg, roster };
}

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z ]+/g, " ").trim().split(/\s+/).filter(Boolean);
function matcher(names) {
  return (label) => {
    const lt = norm(label); if (!lt.length) return null;
    const hits = names.filter((n) => { const rt = norm(n); return lt.every((t) => rt.some((r) => r === t || r.startsWith(t))); });
    if (hits.length === 1) return hits[0];
    return hits.find((n) => norm(n).join(" ") === lt.join(" ")) || null;
  };
}
const jobName = (raw, cfg, i) => cfg.jobRenames?.[raw] || raw.split(",")[0].replace(/\s+\d{4}\s*(\+|ps)?\s*$/i, "").trim() || `Row ${i + 1}`;

// shop: array of roster names the user ticked. undefined → default (pinned only).
// Hammer Time: placement comes from BuilderTrend first punches (crew_punches),
// photos come from the board's badges (carpenters live in the tray).
export function buildSpecFromPunches(punches, state, { cfg, roster }, shop) {
  const people = {}; for (const [crew, c] of Object.entries(roster)) for (const m of c.members) people[m] = { crew, lead: c.lead === m };
  const rosterName = matcher(Object.keys(people));
  const byName = {}; for (const c of state.cards || []) { if (c.category !== "employee" || !c.label) continue; const n = rosterName(c.label); if (n && !byName[n]) byName[n] = c; }
  const groups = {}, receipt = [], placed = new Set();
  for (const p of punches) {
    const name = rosterName(p.name); if (!name) continue;
    if (cfg.pinned?.[name] === "Shop") { receipt.push(`pin   ${name} punched ${p.job} — stays pinned to Shop`); continue; }
    const key = jobName(p.job, cfg, 0);
    if (/^(shop|general|mom's world|fg - shop)/i.test(p.job)) { receipt.push(`shop  ${name} punched ${p.job}`); continue; }
    (groups[key] ||= { members: [], cards: [], first: p.punched_at }).members.push(name); groups[key].cards.push(byName[name] || { label: name, photo: null });
    placed.add(name); receipt.push(`job   ${name} → ${key} @ ${String(p.punched_at).slice(11, 16)}`);
  }
  const candidates = Object.keys(people).filter((n) => !placed.has(n)).map((n) => ({ name: n, crew: people[n].crew, pinned: cfg.pinned?.[n] === "Shop", where: byName[n] ? (punches.some((p) => rosterName(p.name) === n) ? "punched shop" : "no punch") : "no badge" }));
  const shopNames = shop ?? candidates.filter((c) => c.pinned).map((c) => c.name);
  const spec = Object.entries(groups).sort((a, b) => (a[1].first < b[1].first ? -1 : 1)).map(([name, g]) => {
    const crews = g.members.map((n) => people[n].crew);
    const color = [...crews].sort((a, b) => crews.filter((x) => x === b).length - crews.filter((x) => x === a).length)[0];
    const order = g.members.map((n, k) => k).sort((a, b) => (people[g.members[b]].lead ? 1 : 0) - (people[g.members[a]].lead ? 1 : 0));
    return { name, color, members: order.map((k) => g.members[k]), cards: order.map((k) => g.cards[k]) };
  });
  const shopMembers = shopNames.filter((n) => people[n]);
  if (shopMembers.length) spec.push({ name: "Shop", color: "SHOP", members: shopMembers, cards: shopMembers.map((n) => byName[n] || { label: n, photo: null }) });
  return { spec, candidates, shop: shopNames, receipt, punches: punches.length };
}

export function buildSpec(state, { cfg, roster }, shop) {
  const people = {}; for (const [crew, c] of Object.entries(roster)) for (const m of c.members) people[m] = { crew, lead: c.lead === m };
  const rosterName = matcher(Object.keys(people));
  const cards = state.cards || [], jobs = state.jobs || [];
  const groups = {}, receipt = [], seen = new Set(), byName = {};
  for (const c of cards) {
    if (c.category !== "employee" || !c.label) continue;
    const name = rosterName(c.label); if (!name) continue;
    if (seen.has(name)) continue; seen.add(name); byName[name] = c;
    const m = /^job(\d+)/.exec(c.laneId || "");
    if (!c.inTray && m) { const i = Number(m[1]); (groups[i] ||= { members: [], cards: [] }).members.push(name); groups[i].cards.push(c); receipt.push(`job   ${name} → ${jobName(jobs[i]?.name || "", cfg, i)}`); continue; }
    if (c.laneId === "vaca" || c.laneId === "unavail") { receipt.push(`off   ${name} — ${c.laneId === "vaca" ? "vacation/sick" : "unavailable"}`); continue; }
  }
  const placed = new Set(Object.values(groups).flatMap((g) => g.members));
  // Shop candidates: anyone on the roster with a badge who isn't under a job today
  const candidates = Object.keys(people).filter((n) => byName[n] && !placed.has(n)).map((n) => ({
    name: n, crew: people[n].crew, pinned: cfg.pinned?.[n] === "Shop",
    where: byName[n].inTray ? "tray" : (byName[n].laneId === "vaca" ? "vacation" : byName[n].laneId === "unavail" ? "unavailable" : "board"),
  }));
  const shopNames = shop ?? candidates.filter((c) => c.pinned).map((c) => c.name);
  const spec = Object.keys(groups).map(Number).sort((a, b) => a - b).map((i) => {
    const g = groups[i]; const crews = g.members.map((n) => people[n].crew);
    const color = [...crews].sort((a, b) => crews.filter((x) => x === b).length - crews.filter((x) => x === a).length)[0];
    const order = g.members.map((n, k) => k).sort((a, b) => (people[g.members[b]].lead ? 1 : 0) - (people[g.members[a]].lead ? 1 : 0));
    return { name: jobName(jobs[i]?.name || "", cfg, i), color, members: order.map((k) => g.members[k]), cards: order.map((k) => g.cards[k]) };
  });
  const shopMembers = shopNames.filter((n) => byName[n]);
  if (shopMembers.length) spec.push({ name: "Shop", color: "SHOP", members: shopMembers, cards: shopMembers.map((n) => byName[n]) });
  return { spec, candidates, shop: shopNames, receipt };
}

export function dateLine(d = new Date()) { return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "America/Chicago" }).toUpperCase(); }
export function fileDate(d = new Date()) { return d.toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "numeric", timeZone: "America/Chicago" }).replace(/\//g, "."); }

// photoSrc: resolves a card's photo to something an <img> can load in the target context
export function renderHtml(spec, cfg, photoSrc = (p) => p, { fragment = false } = {}) {
  const colors = { ...cfg.colors, SHOP: "#9a9a9a" };
  const card = (c, name) => { const src = photoSrc(c.photo); const bare = src && !String(c.photo).startsWith("data:"); return `<div class="tt-card">${src ? `<img src="${src}">` : `<div class="tt-noimg">${name}</div>`}${bare ? `<div class="tt-cap">${name}</div>` : ""}</div>`; };
  const css = `
  .tt { font-family: "Century Gothic", "Avenir Next", "Helvetica Neue", Arial, sans-serif; color:#333; background:#fff; width:880px; padding:18px 0; box-sizing:content-box; line-height:1.2; }
  .tt *, .tt h1, .tt h2 { font-family: inherit; text-shadow:none; text-transform:none; flex:none; }
  .tt h1 { font-weight:300; font-size:40px; letter-spacing:1px; margin:0; color:#555; line-height:1.1; }
  .tt h2 { font-weight:700; font-size:22px; margin:6px 0 0; color:#333; line-height:1.1; letter-spacing:0; }
  .tt .tt-hdr { display:flex; border:2px solid #333; }
  .tt .tt-hdr .tt-l { flex:1; padding:8px 22px; border-right:2px solid #333; }
  .tt .tt-hdr .tt-k { padding:10px 14px; min-width:260px; }
  .tt .tt-hdr .tt-k b { display:block; font-weight:700; font-size:22px; margin-bottom:6px; }
  .tt .tt-chips { display:grid; grid-template-columns:repeat(3,1fr); gap:6px; }
  .tt .tt-chip { color:#fff; font-weight:700; font-size:11px; text-align:center; padding:6px 4px; }
  .tt .tt-grp { margin-top:6px; page-break-inside:avoid; }
  .tt .tt-cards { display:flex; flex-wrap:wrap; gap:8px; padding:0 4px 4px; }
  .tt .tt-card { width:100px; } .tt .tt-card img { width:100px; display:block; }
  .tt .tt-cap { font-size:8px; font-weight:700; text-align:center; margin-top:2px; }
  .tt .tt-noimg { width:100px; height:118px; background:#eee; color:#333; font-size:11px; font-weight:700; text-align:center; display:flex; align-items:center; justify-content:center; }
  .tt .tt-bar { color:#fff; font-weight:700; font-size:18px; text-align:center; padding:7px; }`;
  const body = `<div class="tt"><div class="tt-hdr"><div class="tt-l"><h1>${cfg.title}</h1><h2>${dateLine()}</h2></div>
<div class="tt-k"><b>KEY</b><div class="tt-chips">${cfg.legend.map(([l, c]) => `<div class="tt-chip" style="background:${colors[c]}">${l}</div>`).join("")}</div></div></div>
${spec.map((g) => `<div class="tt-grp"><div class="tt-cards">${g.members.map((n, i) => card(g.cards[i], n)).join("")}</div><div class="tt-bar" style="background:${colors[g.color]}">${g.name}</div></div>`).join("")}
${spec.length ? "" : `<p style="margin-top:40px;font-size:18px">Nobody placed under a job yet.</p>`}</div>`;
  return fragment ? `<style>${css}</style>${body}` : `<!doctype html><meta charset="utf-8"><style>@page{size:letter;margin:0.35in} body{margin:0} .tt{margin:0 auto}${css}</style>${body}`;
}
