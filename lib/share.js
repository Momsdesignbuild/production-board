// A badge lives on one board at a time. On save of board A, mirror A's badges into board B:
// missing ones appear in B's tray; a badge A has placed is pulled back to B's tray. Text cards are per-board.
const key = (c) => `${c.category || ""}|${c.label}`;
const toTray = (c) => ({ ...c, inTray: true, x: null, y: null, laneId: null });

export function shareBadges(src, other) {
  const mine = (src.cards || []).filter((c) => c.type !== "t");
  const cards = [...(other.cards || [])];
  let changed = 0;
  for (const c of mine) {
    const k = key(c);
    const hits = cards.map((o, i) => (o.type !== "t" && key(o) === k ? i : -1)).filter((i) => i >= 0);
    if (!hits.length) { cards.push(toTray(c)); changed++; continue; }
    if (!c.inTray) for (const i of hits) if (!cards[i].inTray) { cards[i] = toTray(cards[i]); changed++; }
  }
  return { data: { ...other, cards }, changed };
}
