import React from "react";
import { dayKeyFromDate, addDays, dateFromKey, TZ } from "../../lib/streak";

/**
 * StreakTimelinePanel
 * Visualises streaks as horizontal proportional blocks.
 *
 * Props:
 * - features: GeoJSON Feature[] (expects properties.start_date and properties.type)
 * - timeZone: string (defaults to TZ)
 * - type: string (activity type to include, default "Run")
 * - maxStreaks: number (how many rows to show, default 8)
 * - title: string (optional heading override)
 */
export default function StreakTimelinePanel({
  features,
  timeZone = TZ,
  type = "Run",
  maxStreaks = 8,
  title = "Streak timeline",
}) {
  // Build a set of day keys with at least one activity of the given type
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

  // Extract all streaks: [{ start, end, len }]
  const streaks = React.useMemo(() => {
    if (daySet.size === 0) return [];
    const keys = Array.from(daySet).sort(); // ascending "YYYY-MM-DD"
    const have = new Set(keys);
    const out = [];

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
        len++; end = nextKey; cur = next;
      }
      out.push({ start, end, len });
    }

    // Order: length desc, then more recent end first
    out.sort((a, b) => (b.len - a.len) || (a.end < b.end ? 1 : -1));
    return out;
  }, [daySet, timeZone]);

  const top = streaks.slice(0, maxStreaks);
  const maxLen = top.length ? Math.max(...top.map(s => s.len)) : 1;

  return (
    <div style={{ background: "#fff", border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
      <h3 style={{ margin: "0 0 8px 0", fontSize: 16 }}>{title}</h3>

      {top.length === 0 ? (
        <div style={{ fontSize: 12, color: "#6b7280" }}>No streak data available.</div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {top.map((s, i) => {
            // Proportional width with a floor so very short streaks are still visible
            const proportion = s.len / maxLen;
            const px = Math.max(8, Math.round(proportion * 220)); // fits nicely in your left column
            return (
              <div key={`${s.start}-${s.end}-${i}`} style={{ display: "grid", gridTemplateColumns: "190px 1fr", alignItems: "center", gap: 8 }}>
                <div style={{ fontSize: 12, color: "#64748b", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {s.start} → {s.end}
                </div>
                <div style={{ position: "relative", height: 16, background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 9999 }}>
                  <div
                    title={`${s.len} day${s.len === 1 ? "" : "s"}`}
                    style={{
                      width: px,
                      height: "100%",
                      background: "#dbeafe",
                      border: "1px solid #bfdbfe",
                      borderRadius: 9999,
                    }}
                  />
                  <span style={{ position: "absolute", right: 8, top: -1, fontSize: 12, color: "#0f172a" }}>
                    {s.len}d
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
