import React from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { weeklyToArray } from "../../lib/time";

export default function WeeklyMileageChart({ weekly, range }) {
  const all = React.useMemo(() => weeklyToArray(weekly), [weekly]);

  const filtered = React.useMemo(() => {
    if (!all.length) return [];
    const now = new Date();
    let cutoff = null;

    switch (range) {
      case "12m": cutoff = new Date(now); cutoff.setUTCMonth(now.getUTCMonth() - 12); break;
      case "6m":  cutoff = new Date(now); cutoff.setUTCMonth(now.getUTCMonth() - 6);  break;
      case "3m":  cutoff = new Date(now); cutoff.setUTCMonth(now.getUTCMonth() - 3);  break;
      case "1m":  cutoff = new Date(now); cutoff.setUTCMonth(now.getUTCMonth() - 1);  break;
      case "all":
      default: return all;
    }
    return all.filter(r => r.startDate >= cutoff);
  }, [all, range]);

  if (!filtered.length) return <div style={{ padding: 8, color: "#666" }}>No weekly data for selected range.</div>;
  return (
    <div style={{ width: "100%", height: 280, background: "#fff", border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>Weekly Mileage (km)</h3>
      </div>
      <ResponsiveContainer>
        <AreaChart data={filtered}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="weekKey" />
          <YAxis />
          <Tooltip />
          <Area type="monotone" dataKey="distance_km" name="Km" fillOpacity={0.2} stroke="#2563eb" fill="#93c5fd" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

