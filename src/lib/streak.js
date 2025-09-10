export const TZ = "Pacific/Auckland";

export function dayKeyFromDate(d, timeZone = TZ) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
export function addDays(date, delta) { const d = new Date(date); d.setUTCDate(d.getUTCDate() + delta); return d; }
export function dateFromKey(key) { const [y, m, d] = key.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); }

