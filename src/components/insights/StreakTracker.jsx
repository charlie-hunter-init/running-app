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

  const allStreaks = React.useMemo(() => {
    if (daySet.size === 0) return [];
    const keys = Array.from(daySet).sort();
    const have = new Set(keys);
    const streaks = [];

    for (const key of keys) {
      const prevKey = dayKeyFromDate(addDays(dateFromKey(key), -1), timeZone);
      if (have.has(prevKey)) continue;

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

    streaks.sort((a, b) => (b.len - a.len) || (a.end < b.end ? 1 : -1));
    return streaks;
  }, [daySet, timeZone]);

  const topOther = React.useMemo(() => {
    const filtered =
      current > 0
        ? allStreaks.filter((s) => !(s.start === currentStart && s.end === currentEnd))
        : allStreaks.slice();

    return {
      first: filtered[0] || null,
      second: filtered[1] || null,
      third: filtered[2] || null,
    };
  }, [allStreaks, current, currentStart, currentEnd]);

  return (
    <div style={styles.panel}>
      <div style={styles.headerRow}>
        <div>
          <div style={styles.kicker}>Streaks</div>
          <div style={styles.title}>{type} days</div>
        </div>
        <div style={styles.miniNote}>
          Current counts only if you’ve done a {type.toLowerCase()} today (NZ time)
        </div>
      </div>

      <div style={styles.grid}>
        <StreakCard
          title="Current"
          value={`${current} day${current === 1 ? "" : "s"}`}
          subtitle={current > 0 ? `${currentStart} → ${currentEnd}` : "No streak active"}
          tone="current"
        />
        <StreakCard
          title="Longest (other)"
          value={topOther.first ? `${topOther.first.len} days` : "0 days"}
          subtitle={topOther.first ? `${topOther.first.start} → ${topOther.first.end}` : "—"}
        />
        <StreakCard
          title="2nd (other)"
          value={topOther.second ? `${topOther.second.len} days` : "0 days"}
          subtitle={topOther.second ? `${topOther.second.start} → ${topOther.second.end}` : "—"}
        />
        <StreakCard
          title="3rd (other)"
          value={topOther.third ? `${topOther.third.len} days` : "0 days"}
          subtitle={topOther.third ? `${topOther.third.start} → ${topOther.third.end}` : "—"}
        />
      </div>
    </div>
  );
}

function StreakCard({ title, value, subtitle, tone }) {
  const isCurrent = tone === "current";
  return (
    <div
      style={{
        ...styles.card,
        borderColor: isCurrent ? "rgba(99,102,241,0.35)" : "rgba(255,255,255,0.08)",
        background: isCurrent ? "rgba(99,102,241,0.10)" : "rgba(255,255,255,0.03)",
      }}
    >
      <div style={styles.cardTitle}>{title}</div>
      <div style={styles.cardValue}>{value}</div>
      <div style={styles.cardSub}>{subtitle}</div>
    </div>
  );
}

const styles = {
  panel: {
    width: "100%",
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.03)",
    padding: 14,
  },
  headerRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "flex-end",
    marginBottom: 12,
  },
  kicker: {
    fontSize: 12,
    letterSpacing: "0.10em",
    textTransform: "uppercase",
    color: "rgba(229,231,235,0.70)",
    fontWeight: 900,
  },
  title: {
    fontSize: 16,
    fontWeight: 950,
    color: "rgba(255,255,255,0.92)",
  },
  miniNote: {
    fontSize: 12,
    color: "rgba(229,231,235,0.65)",
    textAlign: "right",
    maxWidth: 360,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(220px, 1fr))",
    gap: 12,
  },
  card: {
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.08)",
    padding: 12,
  },
  cardTitle: {
    fontSize: 12,
    color: "rgba(229,231,235,0.75)",
    fontWeight: 900,
    marginBottom: 6,
  },
  cardValue: {
    fontSize: 22,
    fontWeight: 950,
    color: "rgba(255,255,255,0.92)",
    lineHeight: 1.1,
    marginBottom: 4,
  },
  cardSub: {
    fontSize: 12,
    color: "rgba(229,231,235,0.70)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
};
