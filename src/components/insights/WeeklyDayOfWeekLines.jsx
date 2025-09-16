import React from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const TZ = "Pacific/Auckland";

// -- Helpers ----------------------------------------------------------
function getStartISO(f) {
  const p = f?.properties || f;
  return p?.start_local || p?.start_date_local || p?.start_date || p?.start || p?.date || null;
}
function getKm(f) {
  const p = f?.properties || f;
  const m = p?.distance_m ?? p?.distance ?? f?.distance_m ?? f?.distance ?? 0;
  return m / 1000;
}
function toNZParts(d) {
  const fmt = new Intl.DateTimeFormat("en-NZ", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
  });
  const parts = fmt.formatToParts(d).reduce((acc, cur) => { acc[cur.type] = cur.value; return acc; }, {});
  const idx = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[parts.weekday];
  return { year: +parts.year, month: +parts.month, day: +parts.day, dowIndex: idx };
}
function fromNZParts({ year, month, day }) {
  return new Date(Date.UTC(year, month - 1, day));
}
function nzWeekKey(d) {
  const p = toNZParts(d);
  const nzMid = fromNZParts(p);
  const monday = new Date(nzMid.getTime() - p.dowIndex * 86400000);
  const y = monday.getUTCFullYear();
  const m = String(monday.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(monday.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
// NOTE: "all" => last 24 months (not truly unlimited)
function rangeCutoff(range) {
  const now = new Date(); const d = new Date(now);
  switch (range) {
    case "12m": d.setUTCMonth(now.getUTCMonth() - 12); return d;
    case "6m":  d.setUTCMonth(now.getUTCMonth() - 6);  return d;
    case "3m":  d.setUTCMonth(now.getUTCMonth() - 3);  return d;
    case "1m":  d.setUTCMonth(now.getUTCMonth() - 1);  return d;
    case "all": // cap to last 24 months
    default:    d.setUTCMonth(now.getUTCMonth() - 24); return d;
  }
}

// -- Component --------------------------------------------------------
export default function WeeklyDayOfWeekLines({ features = [], range = "all" }) {
  const { data, weekKeys, currentWeekKey } = React.useMemo(() => {
    if (!features?.length) return { data: [], weekKeys: [], currentWeekKey: null };

    const cutoff = rangeCutoff(range);
    const weeksMap = new Map(); // weekKey -> [Mon..Sun] km totals

    for (const f of features) {
      const iso = getStartISO(f);
      if (!iso) continue;
      const d = new Date(iso);
      if (isNaN(d)) continue;
      if (cutoff && d < cutoff) continue;

      const p = toNZParts(d);
      const wk = nzWeekKey(d);
      if (!weeksMap.has(wk)) weeksMap.set(wk, Array(7).fill(0));
      const arr = weeksMap.get(wk);
      arr[p.dowIndex] += getKm(f);
    }

    // Ensure the current NZ week is present even if there are no activities yet.
    const currentWeekKey = nzWeekKey(new Date());
    if (!weeksMap.has(currentWeekKey)) {
      weeksMap.set(currentWeekKey, Array(7).fill(0));
    }

    const weekKeysAsc = Array.from(weeksMap.keys()).sort();

    const rows = DOW.map((label, i) => {
      const row = { day: label };
      let sum = 0;
      let min = Infinity;
      let max = -Infinity;
      for (const wk of weekKeysAsc) {
        const v = weeksMap.get(wk)[i] ?? 0;
        row[wk] = v;
        sum += v;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      // Stats across visible weeks (includes zeros)
      const weeksCount = weekKeysAsc.length;
      row.__avg = weeksCount ? sum / weeksCount : 0;
      row.__min = weeksCount ? (isFinite(min) ? min : 0) : 0;
      row.__max = weeksCount ? (isFinite(max) ? max : 0) : 0;

      // New: value for the current NZ week on this day
      row.__cur = weeksMap.get(currentWeekKey)?.[i] ?? 0;

      return row;
    });

    return { data: rows, weekKeys: weekKeysAsc, currentWeekKey };
  }, [features, range]);

  if (!data.length || !weekKeys.length) {
    return <div style={{ padding: 8, color: "#666" }}>No weekly day-of-week data for selected range.</div>;
  }

  const newestIndex = weekKeys.length - 1;

  // Tooltip: include "This week" value for the hovered day
  const AvgTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    const row = payload[0]?.payload || {};
    const avg = Number(row.__avg || 0);
    const max = Number(row.__max || 0);
    const min = Number(row.__min || 0);
    const cur = Number(row.__cur || 0);
    return (
      <div style={{ background: "#fff", border: "1px solid #eee", borderRadius: 8, padding: "8px 10px" }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
        <div>This week: {cur.toFixed(1)} km</div>
        <div>Average: {avg.toFixed(1)} km</div>
        <div>Max: {max.toFixed(1)} km</div>
        <div>Min: {min.toFixed(1)} km</div>
        <div style={{ fontSize: 12, color: "#6b7280" }}>{weekKeys.length} weeks</div>
      </div>
    );
  };

  return (
    <div style={{ width: "100%", height: 260, background: "#fff", border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>Weekly Day-of-Week (km)</h3>
        <div style={{ fontSize: 12, color: "#6b7280" }}>
          {weekKeys.length} weeks • NZ time {range === "all" ? "(last 24 months)" : ""}
        </div>
      </div>
      <ResponsiveContainer>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="day" />
          <YAxis />
          <Tooltip content={<AvgTooltip />} />

          {/* Red average line */}
          <Line
            type="monotone"
            dataKey="__avg"
            name="Average"
            stroke="#ef4444"
            strokeWidth={2}
            dot={false}
          />

          {/* One line per week (kept as-is) */}
          {weekKeys.map((wk, i) => (
            <Line
              key={wk}
              type="monotone"
              dataKey={wk}
              dot={false}
              strokeWidth={i === newestIndex ? 2 : 1}
              strokeOpacity={i === newestIndex ? 1 : 0.5}
            />
          ))}

          {/* New: explicit green overlay for the current NZ week */}
          <Line
            type="monotone"
            dataKey="__cur"
            name="This week"
            stroke="#10b981"      // emerald-500
            strokeWidth={3}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
