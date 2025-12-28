import React from "react";
import { dayKeyFromDate, addDays, dateFromKey, TZ } from "../../lib/streak";

export default function StreakTimelinePanel({
  features,
  timeZone = TZ,
  type = "Run",
  maxStreaks = 8,
  title = "Streak timeline",
}) {
  // Build per-day totals (distance in metres)
  const { dayKeys, dayStats } = React.useMemo(() => {
    const stats = new Map();

    for (const f of features || []) {
      const p = f.properties || {};
      if (type && p.type !== type) continue;
      if (!p.start_date) continue;

      const d = new Date(p.start_date);
      const key = dayKeyFromDate(d, timeZone);

      const dist =
        typeof p.distance_m === "number"
          ? p.distance_m
          : typeof p.distance === "number"
          ? p.distance
          : 0;

      if (!stats.has(key)) stats.set(key, { totalM: 0 });
      stats.get(key).totalM += dist;
    }

    return { dayKeys: [...stats.keys()], dayStats: stats };
  }, [features, timeZone, type]);

  // Compute streaks with distance stats
  const streaks = React.useMemo(() => {
    if (dayKeys.length === 0) return [];

    const keys = [...dayKeys].sort();
    const have = new Set(keys);
    const out = [];

    for (const key of keys) {
      const prevKey = dayKeyFromDate(addDays(dateFromKey(key), -1), timeZone);
      if (have.has(prevKey)) continue; // not a start

      let curDate = dateFromKey(key);
      let end = key;
      let len = 1;

      const day0 = dayStats.get(key) || { totalM: 0 };
      let total = day0.totalM;
      let min = day0.totalM;
      let max = day0.totalM;

      while (true) {
        const next = addDays(curDate, 1);
        const nextKey = dayKeyFromDate(next, timeZone);
        if (!have.has(nextKey)) break;

        const ds = dayStats.get(nextKey) || { totalM: 0 };
        total += ds.totalM;
        if (ds.totalM < min) min = ds.totalM;
        if (ds.totalM > max) max = ds.totalM;

        len++;
        end = nextKey;
        curDate = next;
      }

      out.push({
        start: key,
        end,
        len,
        minM: min,
        maxM: max,
        avgM: len ? total / len : 0,
        totalM: total,
      });
    }

    // Sort: longest first, then more recent end first
    out.sort((a, b) => (b.len - a.len) || (a.end < b.end ? 1 : -1));
    return out;
  }, [dayKeys, dayStats, timeZone]);

  const top = streaks.slice(0, maxStreaks);

  // Recency map: endDate -> rank (0 = newest)
  const sortedByEnd = [...top].sort((a, b) => (a.end > b.end ? -1 : 1));
  const latestEnd = sortedByEnd[0]?.end || null;
  const rankByEnd = new Map();
  sortedByEnd.forEach((s, idx) => rankByEnd.set(s.end, idx));

  // Palette for non-current streaks, from newest → oldest
  const palette = [
    { bg: "#e0f2fe", text: "#0f172a", border: "#bfdbfe" }, // light blue
    { bg: "#e5e7eb", text: "#111827", border: "#cbd5e1" }, // light grey
    { bg: "#f1f5f9", text: "#111827", border: "#e2e8f0" }, // very light slate
    { bg: "#f8fafc", text: "#111827", border: "#e5e7eb" }, // almost white
  ];

  const fmtKm = (m) => (m / 1000).toFixed(1);

  // Simple fade-in animation
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div
      style={{
        background: "#ffffff",
        border: "1px solid #e2e8f0",
        borderRadius: 12,
        padding: 16,
      }}
    >
      <h3
        style={{
          margin: "0 0 12px 0",
          textAlign: "center",
          fontSize: 18,
          fontWeight: 700,
          color: "#0f172a",
        }}
      >
        {title}
      </h3>

      {top.map((s, idx) => {
        const isCurrent = s.end === latestEnd;
        const rank = rankByEnd.get(s.end) ?? idx;
        const paletteIdx = Math.min(rank, palette.length - 1);
        const pal = palette[paletteIdx];

        const totalKm = fmtKm(s.totalM);
        const label = `${s.start} → ${s.end} : total ${totalKm} km • min ${fmtKm(
          s.minM
        )} km • max ${fmtKm(s.maxM)} km • avg ${fmtKm(s.avgM)} km • ${s.len}d`;

        const baseStyle = {
          padding: "9px 14px",
          borderRadius: 999,
          marginBottom: 8,
          fontSize: 13,
          fontWeight: 500,
          display: "flex",
          alignItems: "center",
          gap: 10,
          opacity: mounted ? 1 : 0,
          transform: mounted ? "translateY(0px)" : "translateY(6px)",
          transition: "opacity 0.35s ease-out, transform 0.35s ease-out",
          transitionDelay: `${idx * 40}ms`,
          boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
        };

        const rowStyle = isCurrent
          ? {
              ...baseStyle,
              background:
                "linear-gradient(90deg, #1d4ed8 0%, #6366f1 50%, #0ea5e9 100%)",
              color: "#e5e7eb",
              border: "1px solid rgba(129,140,248,0.9)",
            }
          : {
              ...baseStyle,
              background: pal.bg,
              color: pal.text,
              border: `1px solid ${pal.border}`,
            };

        return (
          <div key={`${s.start}-${s.end}-${idx}`} style={rowStyle}>
            {isCurrent && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "2px 8px",
                  borderRadius: 999,
                  fontSize: 10,
                  fontWeight: 800,
                  textTransform: "uppercase",
                  letterSpacing: 0.8,
                  background: "rgba(15,23,42,0.24)",
                  color: "#f9fafb",
                  flexShrink: 0,
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "999px",
                    background: "#22c55e",
                    boxShadow: "0 0 0 3px rgba(34,197,94,0.35)",
                  }}
                />
                Current
              </span>
            )}

            <span>{label}</span>
          </div>
        );
      })}
    </div>
  );
}
