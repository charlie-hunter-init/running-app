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
      {/* Controls */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <label style={{ fontSize: 14 }}>Weekly range</label>
        <select
          value={weeklyRange}
          onChange={(e) => setWeeklyRange(e.target.value)}
          style={{ border: "1px solid #e5e7eb", borderRadius: 6, padding: "4px 8px", fontSize: 14 }}
        >
          <option value="all">All time</option>
          <option value="12m">Last 12 months</option>
          <option value="6m">Last 6 months</option>
          <option value="3m">Last 3 months</option>
          <option value="1m">Last month</option>
        </select>
      </div>

      {/* Summary tiles */}
      {stats && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 12,
            marginBottom: 12,
          }}
        >
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

      {/* Charts & tables layout */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16, marginBottom: 16 }}>
        {/* Left column: Weekly over Monthly (stacked) */}
        <div style={{ display: "grid", gap: 16 }}>
          <WeeklyMileageChart weekly={stats?.weekly || {}} range={weeklyRange} />
          <MonthlyDistanceBars features={filtered} range={weeklyRange} />
        </div>

        {/* Right column: Shoes over Streaks (stacked) */}
        <div style={{ display: "grid", gap: 16 }}>
          <ShoeTable byShoe={stats?.byShoe || {}} />
          <StreakTracker features={features} />
        </div>
      </div>

      {/* Activities table (respects current filters) */}
      <ActivitiesTable features={filtered} />
    </div>
  );
}
