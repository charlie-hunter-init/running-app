import React from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import useMonthlyData from "../../hooks/useMonthlyData";

export default function MonthlyDistanceBars({ features, range = "all" }) {
  const data = React.useMemo(() => useMonthlyData(features, range), [features, range]);
  if (!data.length) return <div style={{ padding: 8, color: "#666" }}>No monthly data for selected range.</div>;
  return (
    <div style={{ width: "100%", height: 260, background: "#fff", border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
      <h3 style={{ margin: "0 0 8px 0", fontSize: 16 }}>Monthly Distance (km)</h3>
      <ResponsiveContainer>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="month" />
          <YAxis />
          <Tooltip />
          <Bar dataKey="km" name="Km" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

