// LA and R&C share one set of badges: a badge is placed on one board or sits in the (shared) tray on both.
// Run on every save of board A against the other board B. A's placements win; text cards stay per board.
const key = (c) => `${c.category || ""}|${c.label}`;
const badge = (c) => c.type !== "t";
const toTray = (c) => ({ ...c, inTray: true, x: null, y: null, laneId: null });
const placed = (d) => new Set((d.cards || []).filter((c) => badge(c) && !c.inTray).map(key));

export function reconcile(a, b) {
  const pa = placed(a), pb = placed(b);
  for (const k of pa) pb.delete(k);
  // B loses anything A placed; A's tray loses anything B has placed
  let bc = (b.cards || []).filter((c) => !(badge(c) && pa.has(key(c))));
  let ac = (a.cards || []).filter((c) => !(badge(c) && c.inTray && pb.has(key(c))));
  const bChanged = bc.length !== (b.cards || []).length, aChanged = ac.length !== (a.cards || []).length;
  // whatever is in one tray and missing from the other board joins its tray
  const bHas = new Set(bc.filter(badge).map(key)), aHas = new Set(ac.filter(badge).map(key));
  const toB = ac.filter((c) => badge(c) && c.inTray && !bHas.has(key(c))).map(toTray);
  const toA = bc.filter((c) => badge(c) && c.inTray && !aHas.has(key(c))).map(toTray);
  return {
    a: { ...a, cards: [...ac, ...toA] }, aChanged: aChanged || toA.length > 0,
    b: { ...b, cards: [...bc, ...toB] }, bChanged: bChanged || toB.length > 0,
  };
}
