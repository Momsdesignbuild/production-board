// Morning refresh of BID/ACT/LEFT: copy fresh tracker numbers onto each board job row by job name.
// formatHM mirrors index.html (the board stores "h:mm" strings).
export function formatHM(h) {
  if (h == null || isNaN(h)) return "";
  const abs = Math.abs(h);
  let whole = Math.floor(abs), mins = Math.round((abs - whole) * 60);
  if (mins === 60) { mins = 0; whole += 1; }
  return (h < 0 ? "-" : "") + whole + ":" + (mins < 10 ? "0" + mins : mins);
}

const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

// → { data, changed: [{row,name,from,to}], unmatched: [name] }. Rows with no name or no tracker match keep their numbers.
export function refreshBudgets(data, trackerJobs, section) {
  const mine = trackerJobs.filter((j) => j.section === section);
  const find = (n) => mine.find((j) => norm(j.job) === norm(n)) || trackerJobs.find((j) => norm(j.job) === norm(n));
  const changed = [], unmatched = [];
  const jobs = (data.jobs || []).map((row, i) => {
    if (!row.name || row.name === "Shop") return row;
    const t = find(row.name);
    if (!t) { unmatched.push(row.name); return row; }
    const next = { ...row, bid: formatHM(t.bid), act: formatHM(t.act), left: formatHM(t.left) };
    if (next.bid !== row.bid || next.act !== row.act || next.left !== row.left) changed.push({ row: i, name: row.name, from: [row.bid, row.act, row.left].join(" / "), to: [next.bid, next.act, next.left].join(" / ") });
    return next;
  });
  return { data: { ...data, jobs }, changed, unmatched };
}
