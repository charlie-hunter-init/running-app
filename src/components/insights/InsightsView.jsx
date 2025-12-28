import React from "react";
import { fmtDate } from "../../lib/geo";
import WeeklyMileageChart from "./WeeklyMileageChart";
import ActivitiesTable from "./ActivitiesTable";
import ShoeTable from "./ShoeTable";
import MonthlyDistanceBars from "./MonthlyDistanceBars";
import WeeklyDayOfWeekLines from "./WeeklyDayOfWeekLines";
import StreakTimelinePanel from "./StreakTimelinePanel";

// If you put the CSS below into a dedicated file, import it here:
// import "./insights.css";

export default function InsightsView({ stats, features, filtered, weeklyRange, setWeeklyRange }) {
  const generated = stats?.generated_at ? fmtDate(stats.generated_at) : "—";
  const tz = stats?.timezone || "Pacific/Auckland";
  const ytdKm = stats?.ytd?.distance_m != null ? (stats.ytd.distance_m / 1000).toFixed(0) : "—";
  const ytdRuns = stats?.ytd?.count != null ? stats.ytd.count : "—";

  return (
    <div className="insights-page">
      <div className="insights-container">
        {/* Hero */}
        <div className="insights-hero">
          <div className="insights-hero-top">
            <div>
              <h2 className="insights-title">Insights</h2>
              <div className="insights-subtitle">
                Timezone: {tz} • Generated: {generated}
              </div>
            </div>

            {/* Weekly range control */}
            <div className="insights-control">
              <label className="insights-control-label">Weekly range</label>
              <select
                value={weeklyRange}
                onChange={(e) => setWeeklyRange(e.target.value)}
                className="insights-select"
              >
                <option value="all">All time</option>
                <option value="12m">Last 12 months</option>
                <option value="6m">Last 6 months</option>
                <option value="3m">Last 3 months</option>
                <option value="1m">Last month</option>
              </select>
            </div>
          </div>

          {/* Summary tiles */}
          <div className="insights-stats-row">
            <div className="insights-stat">
              <div className="insights-stat-k">YTD Distance</div>
              <div className="insights-stat-v">{ytdKm} km</div>
            </div>
            <div className="insights-stat">
              <div className="insights-stat-k">YTD Runs</div>
              <div className="insights-stat-v">{ytdRuns}</div>
            </div>
            <div className="insights-stat">
              <div className="insights-stat-k">Timezone</div>
              <div className="insights-stat-v insights-stat-v-small">{tz}</div>
            </div>
            <div className="insights-stat">
              <div className="insights-stat-k">Generated</div>
              <div className="insights-stat-v insights-stat-v-small">{generated}</div>
            </div>
          </div>
        </div>

        {/* Main grid */}
        <div className="insights-grid">
          {/* Left column */}
          <div className="insights-col">
            <section className="insights-card">
              <div className="insights-card-pad">
                <div className="insights-card-title-row">
                  <h3 className="insights-card-title">Weekly mileage</h3>
                  <div className="insights-card-meta">NZ time</div>
                </div>
                <WeeklyMileageChart weekly={stats?.weekly || {}} range={weeklyRange} />
              </div>
            </section>

            <section className="insights-card">
              <div className="insights-card-pad">
                <div className="insights-card-title-row">
                  <h3 className="insights-card-title">Weekly day-of-week</h3>
                  <div className="insights-card-meta">{weeklyRange === "all" ? "All time" : "Filtered"}</div>
                </div>
                <WeeklyDayOfWeekLines features={filtered} range={weeklyRange} />
              </div>
            </section>

            <section className="insights-card">
              <div className="insights-card-pad">
                <div className="insights-card-title-row">
                  <h3 className="insights-card-title">Streak timeline</h3>
                  <div className="insights-card-meta">Top streaks</div>
                </div>
                <StreakTimelinePanel features={filtered} type="Run" maxStreaks={8} />
              </div>
            </section>

            <section className="insights-card">
              <div className="insights-card-pad">
                <div className="insights-card-title-row">
                  <h3 className="insights-card-title">Monthly distance</h3>
                  <div className="insights-card-meta">{weeklyRange}</div>
                </div>
                <MonthlyDistanceBars features={filtered} range={weeklyRange} />
              </div>
            </section>

            <section className="insights-card">
              <div className="insights-card-pad">
                <div className="insights-card-title-row">
                  <h3 className="insights-card-title">Next chart</h3>
                  <div className="insights-card-meta">Placeholder</div>
                </div>
                <div className="insights-muted">
                  Drop your next component here (pace distribution, elevation by month, HR zones, etc).
                </div>
                <div style={{ height: 200 }} />
              </div>
            </section>
          </div>

          {/* Right column */}
          <div className="insights-col">
            <section className="insights-card">
              <div className="insights-card-pad">
                <div className="insights-card-title-row">
                  <h3 className="insights-card-title">Shoe totals</h3>
                  <div className="insights-card-meta">Last used</div>
                </div>
                <ShoeTable byShoe={stats?.byShoe || {}} />
              </div>
            </section>
          </div>
        </div>

        {/* Activities table */}
        <section className="insights-card" style={{ marginTop: 14 }}>
          <div className="insights-card-pad">
            <div className="insights-card-title-row">
              <h3 className="insights-card-title">Activities</h3>
              <div className="insights-card-meta">Respects filters</div>
            </div>
            <ActivitiesTable features={filtered} />
          </div>
        </section>
      </div>
    </div>
  );
}
