// Which saved board a request is about: LA (default) or R&C (?board=rc).
// board_state row id + the table that holds that board's per-day history.
export function boardOf(q) {
  return q === "rc" ? { id: 2, history: "board_history_rc" } : { id: 1, history: "board_history" };
}
