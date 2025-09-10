export const INSIGHTS_TZ = "Pacific/Auckland";

export function isoWeekStartDate(weekYear, weekNumber) {
  const jan4 = new Date(Date.UTC(weekYear, 0, 4));
  const day = jan4.getUTCDay() || 7;
  const mondayWeek1 = new Date(jan4);
  mondayWeek1.setUTCDate(jan4.getUTCDate() - (day - 1));
  const result = new Date(mondayWeek1);
  result.setUTCDate(mondayWeek1.getUTCDate() + (weekNumber - 1) * 7);
  return result;
}

export function weeklyToArray(weeklyObj) {
  const rows = Object.entries(weeklyObj || {}).map(([wk, v]) => {
    const [yStr, wStr] = wk.split("-");
    const y = Number(yStr);
    const w = Number(wStr);
    const startDate = isoWeekStartDate(y, w);
    return { weekKey: wk, startDate, distance_km: (v.distance_m || 0) / 1000, count: v.count || 0 };
  });
  rows.sort((a, b) => a.startDate - b.startDate);
  return rows;
}

export function dayKeyLocal(dateISO, tz = INSIGHTS_TZ) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(dateISO));
}

export function monthKeyLocal(dateISO, tz = INSIGHTS_TZ) {
  const d = new Date(dateISO);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit" }).formatToParts(d);
  const y = parts.find(p => p.type === "year").value;
  const m = parts.find(p => p.type === "month").value;
  return `${y}-${m}`;
}

export function monthStartUTC(y, m0) { return new Date(Date.UTC(y, m0, 1)); }

export function cutoffFromRange(range) {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m0 = now.getUTCMonth();
  let cy = y, cm0 = m0;

  switch (range) {
    case "12m": cm0 = m0 - 12; break; // fixed: was -8
    case "6m":  cm0 = m0 - 6;  break;
    case "3m":  cm0 = m0 - 3;  break;
    case "1m":  cm0 = m0 - 1;  break;
    case "all":
    default: return null;
  }
  while (cm0 < 0) { cm0 += 12; cy -= 1; }
  return monthStartUTC(cy, cm0);
}

