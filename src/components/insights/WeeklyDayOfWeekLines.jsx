import React from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const TZ = "Pacific/Auckland";

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
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const parts = fmt.formatToParts(d).reduce((acc, cur) => {
    acc[cur.type] = cur.value;
    return acc;
  }, {});
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
function rangeCutoff(range) {
  const now = new Date();
  const d = new Date(now);
  switch (range) {
    case "12m":
      d.setUTCMonth(now.getUTCMonth() - 12);
      return d;
    case "6m":
      d.setUTCMonth(now.getUTCMonth() - 6);
      return d;
    case "3m":
      d.setUTCMonth(now.getUTCMonth() - 3);
      return d;
    case "1m":
      d.setUTCMonth(now.getUTCMonth() - 1);
      return d;
    case "all":
    default:
      d.setUTCMonth(now.getUTCMonth() - 24);
      return d;
  }
}

function DarkTooltip({ active, payload, label, weekCount, range }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload || {};
  const avg = Number(row.__avg || 0);
  const max = Number(row.__max || 0);
  const min = Number(row.__min || 0);
  const cur = Number(row.__cur || 0);

  return (
    <div
      style={{
        background: "rgba(5,6,10,0.92)",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 12,
        padding: "8px 10px",
        color: "rgba(255,255,255,0.92)",
        fontSize: 12,
        backdropFilter: "blur(8px)",
        boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
        minWidth: 180,
      }}
    >
      <div style={{ fontWeight: 950, marginBottom: 6 }}>{label}</div>
      <div style={{ display: "grid", gap: 2 }}>
        <div style={{ color: "rgba(229,231,235,0.85)" }}>This week: {cur.toFixed(1)} km</div>
        <div style={{ color: "rgba(229,231,235,0.85)" }}>Average: {avg.toFixed(1)} km</div>
        <div style={{ color: "rgba(229,231,235,0.85)" }}>Max: {max.toFixed(1)} km</div>
        <div style={{ color: "rgba(229,231,235,0.85)" }}>Min: {min.toFixed(1)} km</div>
      </div>
      <div style={{ marginTop: 6, color: "rgba(229,231,235,0.65)" }}>
        {weekCount} weeks • NZ time{range === "all" ? " (last 24 months)" : ""}
      </div>
    </div>
  );
}

export default function WeeklyDayOfWeekLines({ features = [], range = "all" }) {
  const { data, weekKeys, currentWeekKey } = React.useMemo(() => {
    if (!features?.length) return { data: [], weekKeys: [], currentWeekKey: null };

    const cutoff = rangeCutoff(range);
    const weeksMap = new Map();

    for (const f of features) {
      const iso = getStartISO(f);
      if (!iso) continue;
      const d = new Date(iso);
      if (isNaN(d)) continue;
      if (cutoff && d < cutoff) continue;

      const p = toNZParts(d);
      const wk = nzWeekKey(d);
      if (!weeksMap.has(wk)) weeksMap.set(wk, Array(7).fill(0));
      weeksMap.get(wk)[p.dowIndex] += getKm(f);
    }

    const currentWeekKey = nzWeekKey(new Date());
    if (!weeksMap.has(currentWeekKey)) weeksMap.set(currentWeekKey, Array(7).fill(0));

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

      const weeksCount = weekKeysAsc.length;
      row.__avg = weeksCount ? sum / weeksCount : 0;
      row.__min = weeksCount ? (isFinite(min) ? min : 0) : 0;
      row.__max = weeksCount ? (isFinite(max) ? max : 0) : 0;
      row.__cur = weeksMap.get(currentWeekKey)?.[i] ?? 0;
      return row;
    });

    return { data: rows, weekKeys: weekKeysAsc, currentWeekKey };
  }, [features, range]);

  if (!data.length || !weekKeys.length) {
    return (
      <div style={{ padding: 4, color: "rgba(229,231,235,0.7)", fontSize: 13 }}>
        No weekly day-of-week data for selected range.
      </div>
    );
  }

  const newestIndex = weekKeys.length - 1;

  return (
    <div style={{ width: "100%", height: 260 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
          <XAxis
            dataKey="day"
            tick={{ fill: "rgba(229,231,235,0.75)", fontSize: 12 }}
            axisLine={{ stroke: "rgba(255,255,255,0.10)" }}
            tickLine={{ stroke: "rgba(255,255,255,0.10)" }}
          />
          <YAxis
            tick={{ fill: "rgba(229,231,235,0.75)", fontSize: 12 }}
            axisLine={{ stroke: "rgba(255,255,255,0.10)" }}
            tickLine={{ stroke: "rgba(255,255,255,0.10)" }}
          />
          <Tooltip content={<DarkTooltip weekCount={weekKeys.length} range={range} />} />

          {/* Red average line */}
          <Line
            type="monotone"
            dataKey="__avg"
            name="Average"
            stroke="#f87171"
            strokeWidth={2.5}
            dot={false}
          />

          {/* One line per week (subtle) */}
          {weekKeys.map((wk, i) => (
            <Line
              key={wk}
              type="monotone"
              dataKey={wk}
              dot={false}
              strokeWidth={i === newestIndex ? 1.6 : 1}
              strokeOpacity={i === newestIndex ? 0.55 : 0.18}
              isAnimationActive={false}
            />
          ))}

          {/* Current NZ week overlay */}
          <Line
            type="monotone"
            dataKey="__cur"
            name="This week"
            stroke="#34d399"
            strokeWidth={3}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
