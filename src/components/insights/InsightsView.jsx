import React from "react";
import { fmtDate } from "../../lib/geo";
import WeeklyMileageChart from "./WeeklyMileageChart";
import ActivitiesTable from "./ActivitiesTable";
import ShoeTable from "./ShoeTable";
import StreakTracker from "./StreakTracker";
import MonthlyDistanceBars from "./MonthlyDistanceBars";

export default function InsightsView({ stats, features, filtered, weeklyRange, setWeeklyRange }) {
  return (
    <div style={{ height: "100%", overflow: "auto", padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <label style={{ fontSize: 14 }}>Weekly range</label>
        <select value={weeklyRange} onChange={(e) => setWeeklyRange(e.target.value)} style={{ border: "1px solid #e5e7eb", borderRadius: 6, padding: "4px 8px", fontSize: 14 }}>
          <option value="all">All time</option>
          <option value="12m">Last 12 months</option>
          <option value="6m">Last 6 months</option>
          <option value="3m">Last 3 months</option>
          <option value="1m">Last month</option>
        </select>
      </div>

      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 12 }}>
          <div style={{ background: "#fff", border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
            <div style={{ fontSize: 12, color: "#6b7280" }}>YTD Distance</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{(stats.ytd.distance_m / 1000).toFixed(0)} km</div>
          </div>
          <div style={{ background: "#fff", border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
            <div style={{ fontSize: 12, color: "#6b7280" }}>YTD Runs</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{stats.ytd.count}</div>
          </div>
          <div style={{ background: "#fff", border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
            <div style={{ fontSize: 12, color: "#6b7280" }}>Timezone</div>
            <div style={{ fontSize: 16 }}>{stats.timezone}</div>
          </div>
          <div style={{ background: "#fff", border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
            <div style={{ fontSize: 12, color: "#6b7280" }}>Generated</div>
            <div style={{ fontSize: 16 }}>{fmtDate(stats.generated_at)}</div>
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16, marginBottom: 16 }}>
        <WeeklyMileageChart weekly={stats?.weekly || {}} range={weeklyRange} />
        <ShoeTable byShoe={stats?.byShoe || {}} />
        <MonthlyDistanceBars features={filtered} range={weeklyRange} />
        <StreakTracker features={features} />
      </div>

      <ActivitiesTable features={filtered} />
    </div>
  );
}

