import React from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { weeklyToArray } from "../../lib/time";

function DarkTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const v = payload[0]?.value;

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
      }}
    >
      <div style={{ fontWeight: 900, marginBottom: 4 }}>{label}</div>
      <div style={{ color: "rgba(229,231,235,0.85)" }}>
        {typeof v === "number" ? v.toFixed(1) : v} km
      </div>
    </div>
  );
}

export default function WeeklyMileageChart({ weekly, range }) {
  const all = React.useMemo(() => weeklyToArray(weekly), [weekly]);

  const filtered = React.useMemo(() => {
    if (!all.length) return [];
    const now = new Date();
    let cutoff = null;

    switch (range) {
      case "12m":
        cutoff = new Date(now);
        cutoff.setUTCMonth(now.getUTCMonth() - 12);
        break;
      case "6m":
        cutoff = new Date(now);
        cutoff.setUTCMonth(now.getUTCMonth() - 6);
        break;
      case "3m":
        cutoff = new Date(now);
        cutoff.setUTCMonth(now.getUTCMonth() - 3);
        break;
      case "1m":
        cutoff = new Date(now);
        cutoff.setUTCMonth(now.getUTCMonth() - 1);
        break;
      case "all":
      default:
        return all;
    }
    return all.filter((r) => r.startDate >= cutoff);
  }, [all, range]);

  if (!filtered.length) {
    return (
      <div style={{ padding: 4, color: "rgba(229,231,235,0.7)", fontSize: 13 }}>
        No weekly data for selected range.
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: 280 }}>
      <ResponsiveContainer>
        <AreaChart data={filtered} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
          <XAxis
            dataKey="weekKey"
            tick={{ fill: "rgba(229,231,235,0.75)", fontSize: 12 }}
            axisLine={{ stroke: "rgba(255,255,255,0.10)" }}
            tickLine={{ stroke: "rgba(255,255,255,0.10)" }}
            minTickGap={24}
          />
          <YAxis
            tick={{ fill: "rgba(229,231,235,0.75)", fontSize: 12 }}
            axisLine={{ stroke: "rgba(255,255,255,0.10)" }}
            tickLine={{ stroke: "rgba(255,255,255,0.10)" }}
          />
          <Tooltip content={<DarkTooltip />} />
          <Area
            type="monotone"
            dataKey="distance_km"
            name="Km"
            stroke="#60a5fa"
            fill="#60a5fa"
            fillOpacity={0.16}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
