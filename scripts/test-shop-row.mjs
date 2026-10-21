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
