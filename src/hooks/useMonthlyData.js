import { monthKeyLocal, monthStartUTC, cutoffFromRange } from "../lib/time";

export default function useMonthlyData(features, range = "all") {
  const map = new Map();
  for (const f of features || []) {
    const p = f.properties || {};
    if (!p.start_date) continue;
    const key = monthKeyLocal(p.start_date);
    const km = (p.distance_m || 0) / 1000;
    map.set(key, (map.get(key) || 0) + km);
  }

  let rows = Array.from(map.entries()).map(([month, km]) => {
    const [yy, mm] = month.split("-").map(Number);
    const start = monthStartUTC(yy, mm - 1);
    return { month, start, km: +km.toFixed(1) };
  });

  const cutoff = cutoffFromRange(range);
  if (cutoff) rows = rows.filter(r => r.start >= cutoff);

  rows.sort((a, b) => a.start - b.start);
  return rows;
}

