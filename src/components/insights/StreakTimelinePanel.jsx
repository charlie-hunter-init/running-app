import React from "react";
import { dayKeyFromDate, addDays, dateFromKey, TZ } from "../../lib/streak";

export default function StreakTimelinePanel({
  features,
  allItems = [],
  timeZone = TZ,
  type = "Run",
  maxStreaks = 10,
  title = "Streak timeline",
}) {
  // Build per-day totals — using allItems as primary source so no-map runs
  // (treadmill, manually logged) are included. Fall back to features for distance
  // if an item has no distance field.
  const { dayKeys, dayStats } = React.useMemo(() => {
    const stats = new Map();

    // First pass: index items (includes has_map:false runs)
    for (const item of allItems) {
      if (type && item.type !== type) continue;
      if (!item.start_date) continue;
      const key = dayKeyFromDate(new Date(item.start_date), timeZone);
      const dist = typeof item.distance === "number" ? item.distance : 0;
      if (!stats.has(key)) stats.set(key, { totalM: 0 });
      stats.get(key).totalM += dist;
    }

    // Second pass: geojson features — add any days/distance not already covered
    // (handles edge case where geojson has richer distance data)
    for (const f of features || []) {
      const p = f.properties || {};
      if (type && p.type !== type) continue;
      if (!p.start_date) continue;
      const key = dayKeyFromDate(new Date(p.start_date), timeZone);
      // Only add if not already captured by allItems
      if (!stats.has(key)) {
        const dist =
          typeof p.distance_m === "number"
            ? p.distance_m
            : typeof p.distance === "number"
            ? p.distance
            : 0;
        stats.set(key, { totalM: dist });
      }
    }

    return { dayKeys: [...stats.keys()], dayStats: stats };
  }, [allItems, features, timeZone, type]);

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

  // Identify current streak — the one whose end date is today or yesterday (still active)
  const todayKey = dayKeyFromDate(new Date(), timeZone);
  const yesterdayKey = dayKeyFromDate(addDays(new Date(), -1), timeZone);
  const currentStreak = streaks.find(
    (s) => s.end === todayKey || s.end === yesterdayKey
  ) || null;

  // If current streak exists but isn't already in top 10, pin it at the bottom
  const currentInTop = currentStreak
    ? top.some((s) => s.start === currentStreak.start && s.end === currentStreak.end)
    : true;
  const pinnedCurrent = !currentInTop ? currentStreak : null;

  // Recency map: endDate -> rank (0 = newest)
  const sortedByEnd = [...top].sort((a, b) => (a.end > b.end ? -1 : 1));
  const rankByEnd = new Map();
  sortedByEnd.forEach((s, idx) => rankByEnd.set(s.end, idx));

  // Palette for non-current streaks — dark theme consistent
  const palette = [
    { bg: "rgba(99,102,241,0.12)",  text: "rgba(229,231,235,0.92)", border: "rgba(99,102,241,0.30)"  },
    { bg: "rgba(14,165,233,0.10)",  text: "rgba(229,231,235,0.88)", border: "rgba(14,165,233,0.25)"  },
    { bg: "rgba(52,211,153,0.09)",  text: "rgba(229,231,235,0.85)", border: "rgba(52,211,153,0.22)"  },
    { bg: "rgba(255,255,255,0.05)", text: "rgba(229,231,235,0.80)", border: "rgba(255,255,255,0.10)" },
  ];

  const fmtKm = (m) => (m / 1000).toFixed(1);

  // Simple fade-in animation
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div style={{ borderRadius: 12, padding: 0 }}>
      <div style={{ marginBottom: 12 }}>
        {top.length === 0 && (
          <div style={{ fontSize: 13, color: "rgba(229,231,235,0.55)" }}>No streaks yet.</div>
        )}
      </div>

      {top.map((s, idx) => {
        const isCurrent =
          currentStreak != null &&
          s.start === currentStreak.start &&
          s.end === currentStreak.end;
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
            {isCurrent && <CurrentBadge />}
            <span style={{ marginRight: "auto" }}>
              <strong>#{idx + 1}</strong> {label}
            </span>
          </div>
        );
      })}

      {/* Pinned current streak — shown only when it didn't make the top 10 */}
      {pinnedCurrent && (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              margin: "12px 0 8px",
            }}
          >
            <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.10)" }} />
            <span style={{ fontSize: 11, color: "rgba(229,231,235,0.5)", fontWeight: 700, whiteSpace: "nowrap" }}>
              YOUR CURRENT STREAK
            </span>
            <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.10)" }} />
          </div>
          <div
            style={{
              padding: "9px 14px",
              borderRadius: 999,
              fontSize: 13,
              fontWeight: 500,
              display: "flex",
              alignItems: "center",
              gap: 10,
              background: "linear-gradient(90deg, #1d4ed8 0%, #6366f1 50%, #0ea5e9 100%)",
              color: "#e5e7eb",
              border: "1px solid rgba(129,140,248,0.9)",
              boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
              opacity: mounted ? 1 : 0,
              transform: mounted ? "translateY(0px)" : "translateY(6px)",
              transition: "opacity 0.35s ease-out, transform 0.35s ease-out",
              transitionDelay: `${(top.length + 1) * 40}ms`,
            }}
          >
            <CurrentBadge />
            <span>
              {`${pinnedCurrent.start} → ${pinnedCurrent.end} : total ${fmtKm(pinnedCurrent.totalM)} km • min ${fmtKm(pinnedCurrent.minM)} km • max ${fmtKm(pinnedCurrent.maxM)} km • avg ${fmtKm(pinnedCurrent.avgM)} km • ${pinnedCurrent.len}d`}
            </span>
            <span
              style={{
                marginLeft: "auto",
                fontSize: 11,
                color: "rgba(229,231,235,0.7)",
                whiteSpace: "nowrap",
              }}
            >
              #{streaks.findIndex((s) => s.start === pinnedCurrent.start && s.end === pinnedCurrent.end) + 1} all-time
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function CurrentBadge() {
  return (
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
          borderRadius: "50%",
          background: "#22c55e",
          boxShadow: "0 0 0 3px rgba(34,197,94,0.35)",
        }}
      />
      Current
    </span>
  );
}
