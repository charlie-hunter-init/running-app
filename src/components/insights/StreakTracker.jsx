import React from "react";
import { dayKeyFromDate, addDays, dateFromKey, TZ } from "../../lib/streak";

export default function StreakTracker({ features, timeZone = TZ, type = "Run" }) {
  const daySet = React.useMemo(() => {
    const s = new Set();
    for (const f of features || []) {
      const p = f.properties || {};
      if (type && p.type !== type) continue;
      if (!p.start_date) continue;
      const d = new Date(p.start_date);
      s.add(dayKeyFromDate(d, timeZone));
    }
    return s;
  }, [features, timeZone, type]);

  const { current, currentEndsOn } = React.useMemo(() => {
    const todayKey = dayKeyFromDate(new Date(), timeZone);
    let streak = 0;
    let cursor = dateFromKey(todayKey);
    while (daySet.has(dayKeyFromDate(cursor, timeZone))) {
      streak++;
      cursor = addDays(cursor, -1);
    }
    return { current: streak, currentEndsOn: todayKey };
  }, [daySet, timeZone]);

  const { longest, longestStart, longestEnd } = React.useMemo(() => {
    if (daySet.size === 0) return { longest: 0, longestStart: null, longestEnd: null };
    const keys = Array.from(daySet).sort();
    const have = new Set(keys);

    let bestLen = 0, bestStart = null, bestEnd = null;

    for (const key of keys) {
      const prevKey = dayKeyFromDate(addDays(dateFromKey(key), -1), timeZone);
      if (have.has(prevKey)) continue;

      let len = 1, start = key, end = key, cur = dateFromKey(key);
      while (true) {
        const next = addDays(cur, 1);
        const nextKey = dayKeyFromDate(next, timeZone);
        if (!have.has(nextKey)) break;
        len++; end = nextKey; cur = next;
      }

      if (len > bestLen) { bestLen = len; bestStart = start; bestEnd = end; }
    }

    return { longest: bestLen, longestStart: bestStart, longestEnd: bestEnd };
  }, [daySet, timeZone]);

  return (
    <div style={{ background: "#fff", border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
      <h3 style={{ margin: "0 0 8px 0", fontSize: 16 }}>Streaks (Run days)</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
        <div style={{ padding: 12, border: "1px solid #f1f5f9", borderRadius: 8 }}>
          <div style={{ fontSize: 12, color: "#6b7280" }}>Current streak</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{current} day{current === 1 ? "" : "s"}</div>
          <div style={{ fontSize: 12, color: "#6b7280" }}>
            {current > 0 ? `Active through ${currentEndsOn}` : "No run today"}
          </div>
        </div>
        <div style={{ padding: 12, border: "1px solid #f1f5f9", borderRadius: 8 }}>
          <div style={{ fontSize: 12, color: "#6b7280" }}>Longest streak</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{longest} day{longest === 1 ? "" : "s"}</div>
          <div style={{ fontSize: 12, color: "#6b7280" }}>
            {longest ? `${longestStart} → ${longestEnd}` : "—"}
          </div>
        </div>
      </div>
    </div>
  );
}

