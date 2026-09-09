// "Today" for the board is the shop's day in Minneapolis, not the Vercel
// server's UTC day — otherwise from 7pm CDT the server thinks it's tomorrow.
export const TZ = "America/Chicago";
export function todayStr(d = new Date()) {
  return d.toLocaleDateString("en-CA", { timeZone: TZ }); // YYYY-MM-DD
}
