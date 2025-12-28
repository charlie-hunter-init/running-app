import React from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import useMonthlyData from "../../hooks/useMonthlyData";

function DarkTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const km = payload[0]?.value;
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
        {typeof km === "number" ? km.toFixed(1) : km} km
      </div>
    </div>
  );
}

export default function MonthlyDistanceBars({ features, range = "all" }) {
  const data = React.useMemo(() => useMonthlyData(features, range), [features, range]);

  if (!data.length) {
    return (
      <div style={{ padding: 4, color: "rgba(229,231,235,0.7)", fontSize: 13 }}>
        No monthly data for selected range.
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: 260 }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
          <XAxis
            dataKey="month"
            tick={{ fill: "rgba(229,231,235,0.75)", fontSize: 12 }}
            axisLine={{ stroke: "rgba(255,255,255,0.10)" }}
            tickLine={{ stroke: "rgba(255,255,255,0.10)" }}
          />
          <YAxis
            tick={{ fill: "rgba(229,231,235,0.75)", fontSize: 12 }}
            axisLine={{ stroke: "rgba(255,255,255,0.10)" }}
            tickLine={{ stroke: "rgba(255,255,255,0.10)" }}
          />
          <Tooltip content={<DarkTooltip />} />
          <Bar
            dataKey="km"
            name="Km"
            radius={[10, 10, 6, 6]}
            // no fixed colour here — recharts default is fine, but you can add later if you want
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
