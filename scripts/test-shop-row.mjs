import assert from "node:assert";
import { buildSpec, loadCrewConfig } from "../lib/crew-board.js";
const crew = loadCrewConfig("trench");
const names = Object.values(crew.roster).flatMap((c) => c.members);
const [a, b, c] = names; // three real roster people
const card = (label, laneId) => ({ category: "employee", label, laneId, inTray: false });
const state = { jobs: [{ name: "Adey 2026" }, {}, {}, {}, {}, {}, {}, { name: "" }], cards: [card(a, "job0"), card(b, "job7"), card(c, "vaca")], shopRows: [7] };
const { spec, shop } = buildSpec(state, crew, undefined);
assert.deepEqual(shop, [b], "default Shop = whoever sits in the shop row");
assert.deepEqual(spec.map((g) => g.name), ["Adey", "Shop"]);
assert.deepEqual(spec[1].members, [b]);
// no flag → old behaviour: row 7 is an ordinary (unnamed) job group
const old = buildSpec({ ...state, shopRows: undefined }, crew, undefined);
assert.ok(old.spec.some((g) => g.members.includes(b) && g.name !== "Shop"));
console.log("shop-row test OK");

// Hammer Time = R&C board's saved badges (same builder, hammer roster)
const ham = loadCrewConfig("hammer");
const hs = { jobs: [{ name: "Bailey R&C 2026" }, {}, {}, {}, {}, {}, {}, {}], cards: [card("Kegan Matchan", "job0"), card("Justin Joos", "job0"), card("Corey Landgraff", "job7")], shopRows: [7] };
const h = buildSpec(hs, ham, undefined);
assert.deepEqual(h.spec.map((g) => g.name), ["Bailey R&C", "Shop"]);
assert.deepEqual(h.spec[1].members, ["Corey Landgraff"]);
console.log("hammer-from-board test OK");

// board routing: LA is the default, ?board=rc is its own state row + history table
import { boardOf } from "../lib/boards.js";
assert.deepEqual(boardOf(undefined), { id: 1, history: "board_history" });
assert.deepEqual(boardOf("rc"), { id: 2, history: "board_history_rc" });
console.log("board routing test OK");

// a job-row employee badge that isn't on the roster is reported, not dropped silently
const pagh = { jobs: [{ name: "Pagh, Kelly & Adam 2026" }], cards: [card("Julio, Ernesto & Hugo", "job0"), card("ben", "job0"), card("Some Stranger", "job0"), card(a, "job0")], shopRows: [] };
const withGroup = buildSpec(pagh, crew, undefined);
assert.deepEqual(withGroup.spec[0].members.slice().sort(), [a, "Julio, Ernesto & Hugo"].sort(), "group badge counts as a member");
assert.deepEqual(withGroup.dropped, ["Some Stranger (Pagh)"], "unknown reported once; ignore-list badge is not");
console.log("dropped-badge test OK");

// morning budget refresh: match by name, section-first, keep unmatched, never touch Shop/blank
import { refreshBudgets, formatHM } from "../lib/budgets.js";
assert.equal(formatHM(-569.5), "-569:30");
const rb = refreshBudgets(
  { cards: [1], jobs: [{ name: "Jahnz  Interior Basement", bid: "1:00", act: "2:00", left: "3:00" }, { name: "Gone", bid: "9:00", act: "", left: "" }, { name: "Shop" }, {}] },
  [{ section: "LANDSCAPING", job: "Jahnz Interior Basement", bid: 1, act: 1, left: 0 }, { section: "R&C", job: "jahnz interior basement", bid: 795, act: 1364.5, left: -569.5 }],
  "R&C");
assert.deepEqual([rb.data.jobs[0].bid, rb.data.jobs[0].act, rb.data.jobs[0].left], ["795:00", "1364:30", "-569:30"]);
assert.deepEqual(rb.unmatched, ["Gone"]);
assert.equal(rb.data.jobs[1].bid, "9:00");
assert.deepEqual(rb.data.cards, [1]);
console.log("budget refresh test OK");

// every endpoint that calls boardOf must import it (a missing import 500d every save 10/21-22)
import fs from "node:fs";
for (const f of fs.readdirSync("api").filter((x) => x.endsWith(".js"))) {
  const src = fs.readFileSync("api/" + f, "utf8");
  if (/boardOf\(/.test(src)) assert.match(src, /import \{[^}]*boardOf[^}]*\} from/, f + " uses boardOf without importing it");
}
console.log("boardOf import test OK");

// one badge, one board
import { shareBadges } from "../lib/share.js";
const bc = (label, inTray, laneId) => ({ type: "p", category: "employee", label, inTray, laneId: inTray ? null : laneId, x: inTray ? null : "1px", y: inTray ? null : "1px" });
const shared = shareBadges({ cards: [bc("Kegan", false, "job0"), bc("Justin", true), { type: "t", label: "note" }] }, { cards: [bc("Kegan", false, "job2"), { type: "t", label: "other note" }] });
assert.equal(shared.data.cards[0].inTray, true, "placed on A -> tray on B");
assert.ok(shared.data.cards.some((c) => c.label === "Justin" && c.inTray), "missing badge appears in B's tray");
assert.ok(!shared.data.cards.some((c) => c.label === "note"), "text cards stay per board");
assert.equal(shareBadges({ cards: [bc("Kegan", true)] }, { cards: [bc("Kegan", false, "job2")] }).changed, 0, "A's tray never evicts B");
console.log("share badges test OK");
