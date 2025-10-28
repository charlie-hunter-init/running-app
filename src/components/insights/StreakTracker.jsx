import React from "react";
import { dayKeyFromDate, addDays, dateFromKey, TZ } from "../../lib/streak";

export default function StreakTracker({ features, timeZone = TZ, type = "Run" }) {
  // Build a set of day keys that have at least one activity of the given type
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

  // Compute current streak (ending today if active)
  const { current, currentStart, currentEnd } = React.useMemo(() => {
    const todayKey = dayKeyFromDate(new Date(), timeZone);
    let streak = 0;
    let cursor = dateFromKey(todayKey);

    while (daySet.has(dayKeyFromDate(cursor, timeZone))) {
      streak++;
      cursor = addDays(cursor, -1);
    }

    let startKey = null;
    if (streak > 0) {
      const startDate = addDays(dateFromKey(todayKey), -(streak - 1));
      startKey = dayKeyFromDate(startDate, timeZone);
    }
    return { current: streak, currentStart: startKey, currentEnd: todayKey };
  }, [daySet, timeZone]);

  // Compute all historical streaks (start, end, length)
  const allStreaks = React.useMemo(() => {
    if (daySet.size === 0) return [];
    const keys = Array.from(daySet).sort(); // ascending YYYY-MM-DD
    const have = new Set(keys);
    const streaks = [];

    for (const key of keys) {
      const prevKey = dayKeyFromDate(addDays(dateFromKey(key), -1), timeZone);
      if (have.has(prevKey)) continue; // not a start

      let len = 1;
      let start = key;
      let end = key;
      let cur = dateFromKey(key);

      while (true) {
        const next = addDays(cur, 1);
        const nextKey = dayKeyFromDate(next, timeZone);
        if (!have.has(nextKey)) break;
        len++;
        end = nextKey;
        cur = next;
      }

      streaks.push({ len, start, end });
    }

    // Sort by length desc; tie-break by more recent end date first
    streaks.sort((a, b) => (b.len - a.len) || (a.end < b.end ? 1 : -1));
    return streaks;
  }, [daySet, timeZone]);

  // Exclude the active current streak from the "other" list (if there is one)
  const topOther = React.useMemo(() => {
    const filtered = current > 0
      ? allStreaks.filter(s => !(s.start === currentStart && s.end === currentEnd))
      : allStreaks.slice();
    return {
      first: filtered[0] || null,
      second: filtered[1] || null,
      third: filtered[2] || null,
    };
  }, [allStreaks, current, currentStart, currentEnd]);

  return (
    <div style={{ background: "#fff", border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
      <h3 style={{ margin: "0 0 8px 0", fontSize: 16 }}>
        Streaks ({type} days)
      </h3>

      {/* 2×2 grid: Current | Longest(other) ; 2nd(other) | 3rd(other) */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(2, minmax(200px, 1fr))",
        gap: 12
      }}>
        {/* Current */}
        <StreakCard
          title="Current streak"
          value={`${current} day${current === 1 ? "" : "s"}`}
          subtitle={current > 0 ? `${currentStart} → ${currentEnd}` : "No run today"}
        />

        {/* Longest (other) */}
        <StreakCard
          title="Longest (other)"
          value={topOther.first ? `${topOther.first.len} day${topOther.first.len === 1 ? "" : "s"}` : "0 days"}
          subtitle={topOther.first ? `${topOther.first.start} → ${topOther.first.end}` : "—"}
        />

        {/* 2nd longest (other) */}
        <StreakCard
          title="2nd longest (other)"
          value={topOther.second ? `${topOther.second.len} day${topOther.second.len === 1 ? "" : "s"}` : "0 days"}
          subtitle={topOther.second ? `${topOther.second.start} → ${topOther.second.end}` : "—"}
        />

        {/* 3rd longest (other) */}
        <StreakCard
          title="3rd longest (other)"
          value={topOther.third ? `${topOther.third.len} day${topOther.third.len === 1 ? "" : "s"}` : "0 days"}
          subtitle={topOther.third ? `${topOther.third.start} → ${topOther.third.end}` : "—"}
        />
      </div>
    </div>
  );
}

function StreakCard({ title, value, subtitle }) {
  return (
    <div style={{ padding: 12, border: "1px solid #f1f5f9", borderRadius: 8 }}>
      <div style={{ fontSize: 12, color: "#6b7280" }}>{title}</div>
      <div style={{ fontSize: 24, fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: 12, color: "#6b7280" }}>{subtitle}</div>
    </div>
  );
}
