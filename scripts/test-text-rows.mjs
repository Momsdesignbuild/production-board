import assert from "node:assert";
import { buildSpec, loadCrewConfig } from "../lib/crew-board.js";
const crew = loadCrewConfig("trench");
const [a, b] = Object.values(crew.roster).flatMap((c) => c.members);
const badge = (l, lane) => ({ category: "employee", label: l, laneId: lane, inTray: false });
const txt = (l, lane) => ({ type: "t", label: l, laneId: lane, inTray: false });
// text names a row with no picked job
let r = buildSpec({ jobs: [{ name: "" }, { name: "" }], cards: [badge(a, "job1"), txt("Warranty - Smith, call Jim", "job1")] }, crew);
assert.equal(r.spec[0].name, "Warranty - Smith, call Jim");
// a picked job beats text on the same row
r = buildSpec({ jobs: [{ name: "Jahnz Interior Basement 2026" }], cards: [badge(a, "job0"), txt("ignore me", "job0")] }, crew);
assert.equal(r.spec[0].name, "Jahnz Interior Basement");
// text elsewhere (no lane) does nothing; empty row still falls back to Row N
r = buildSpec({ jobs: [{ name: "" }], cards: [badge(a, "job0"), txt("floating", null), { ...txt("in tray", "job0"), inTray: true }] }, crew);
assert.equal(r.spec[0].name, "Row 1");
// text dropped on the name square has no laneId but a rowIdx
r = buildSpec({ jobs: [{ name: "" }, { name: "" }], cards: [badge(a, "job1"), { type: "t", label: "FG Work Order", laneId: null, rowIdx: 1, inTray: false }] }, crew);
assert.equal(r.spec[0].name, "FG Work Order");
console.log("text rows test OK");
