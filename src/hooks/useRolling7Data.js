import { dayKeyLocal } from "../lib/time";

export default function useRolling7Data(features) {
  const dailyMap = new Map();
  for (const f of features || []) {
    const p = f.properties || {};
    if (!p.start_date) continue;
    const key = dayKeyLocal(p.start_date);
    const km = (p.distance_m || 0) / 1000;
    dailyMap.set(key, (dailyMap.get(key) || 0) + km);
  }

  const keys = Array.from(dailyMap.keys()).sort();
  if (keys.length === 0) return [];

  const first = new Date(keys[0] + "T00:00:00Z");
  const last  = new Date(keys[keys.length - 1] + "T00:00:00Z");
  const allDays = [];
  for (let d = new Date(first); d <= last; d.setUTCDate(d.getUTCDate() + 1)) {
    const k = d.toISOString().slice(0,10);
    const localKey = dayKeyLocal(k);
    if (!allDays.length || allDays[allDays.length-1].day !== localKey) {
      allDays.push({ day: localKey, km: dailyMap.get(localKey) || 0 });
    }
  }

  const out = [];
  let windowSum = 0;
  const q = [];
  for (const row of allDays) {
    q.push(row.km);
    windowSum += row.km;
    if (q.length > 7) windowSum -= q.shift();
    out.push({ day: row.day, km7: windowSum });
  }
  return out;
}

