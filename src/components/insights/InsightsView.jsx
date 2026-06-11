import React, { useMemo } from "react";
import { fmtDate } from "../../lib/geo";
import { TZ, dayKeyFromDate, addDays, dateFromKey } from "../../lib/streak";
import WeeklyMileageChart from "./WeeklyMileageChart";
import ActivitiesTable from "./ActivitiesTable";
import ShoeTable from "./ShoeTable";
import MonthlyDistanceBars from "./MonthlyDistanceBars";
import WeeklyDayOfWeekLines from "./WeeklyDayOfWeekLines";
import StreakTimelinePanel from "./StreakTimelinePanel";
import WeeklySnapshot from "./WeeklySnapshot";

export default function InsightsView({ stats, features, filtered, allItems = [], weeklyRange, setWeeklyRange }) {
  const generated = stats?.generated_at ? fmtDate(stats.generated_at) : "—";
  const tz = stats?.timezone || "Pacific/Auckland";
  const ytdKm = stats?.ytd?.distance_m != null ? (stats.ytd.distance_m / 1000).toFixed(0) : "—";
  const ytdRuns = stats?.ytd?.count != null ? stats.ytd.count : "—";

  // Current streak + days run this year — from allItems so no-map runs count
  const { currentStreak, daysRunThisYear, totalDaysThisYear } = useMemo(() => {
    const daySet = new Set();
    for (const item of allItems) {
      if (item.type !== "Run" || !item.start_date) continue;
      daySet.add(dayKeyFromDate(new Date(item.start_date), TZ));
    }
    for (const f of features || []) {
      const p = f.properties || {};
      if (p.type !== "Run" || !p.start_date) continue;
      daySet.add(dayKeyFromDate(new Date(p.start_date), TZ));
    }

    // Current streak: count back from today
    const todayKey = dayKeyFromDate(new Date(), TZ);
    let streak = 0;
    let cursor = new Date();
    while (daySet.has(dayKeyFromDate(cursor, TZ))) {
      streak++;
      cursor = addDays(cursor, -1);
    }

    // Days run this year
    const nowNZ = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric" }).format(new Date());
    const thisYear = nowNZ;
    let daysThisYear = 0;
    for (const key of daySet) {
      if (key.startsWith(thisYear)) daysThisYear++;
    }

    // Total days elapsed this year so far (in NZ time)
    const thisYearNum = parseInt(thisYear, 10);
    const startOfYearUTC = Date.UTC(thisYearNum, 0, 1);
    const todayNZStr = new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
    const [ty, tm, td] = todayNZStr.split("-").map(Number);
    const todayUTC = Date.UTC(ty, tm - 1, td);
    const elapsed = Math.floor((todayUTC - startOfYearUTC) / 86400000) + 1;

    return { currentStreak: streak, daysRunThisYear: daysThisYear, totalDaysThisYear: elapsed };
  }, [allItems, features]);

  return (
    <div className="insights-page">
      <div className="insights-container">
        {/* Hero — merged with This Week */}
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

          {/* Top stats row */}
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
              <div className="insights-stat-k">Current Streak</div>
              <div className="insights-stat-v">
                {currentStreak}
                <span style={{ fontSize: 13, fontWeight: 700, color: "rgba(229,231,235,0.6)", marginLeft: 4 }}>
                  day{currentStreak !== 1 ? "s" : ""}
                </span>
              </div>
            </div>
            <div className="insights-stat">
              <div className="insights-stat-k">Days Run This Year</div>
              <div className="insights-stat-v">
                {daysRunThisYear}
                <span style={{ fontSize: 13, fontWeight: 700, color: "rgba(229,231,235,0.6)", marginLeft: 4 }}>
                  / {totalDaysThisYear}
                </span>
              </div>
            </div>
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: "rgba(255,255,255,0.07)", margin: "14px 0" }} />

          {/* This week snapshot — inside same hero box */}
          <div className="insights-card-title-row" style={{ marginBottom: 10 }}>
            <h3 className="insights-card-title">This week</h3>
            <div className="insights-card-meta">vs same days last week · NZ time</div>
          </div>
          <WeeklySnapshot allItems={allItems} />
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
                  <h3 className="insights-card-title">Monthly distance</h3>
                  <div className="insights-card-meta">{weeklyRange === "all" ? "All time" : "Filtered"}</div>
                </div>
                <MonthlyDistanceBars features={filtered} range={weeklyRange} />
              </div>
            </section>

            <section className="insights-card">
              <div className="insights-card-pad">
                <div className="insights-card-title-row">
                  <h3 className="insights-card-title">Day of week</h3>
                  <div className="insights-card-meta">{weeklyRange === "all" ? "All time" : "Filtered"}</div>
                </div>
                <WeeklyDayOfWeekLines features={filtered} range={weeklyRange} />
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

            <section className="insights-card">
              <div className="insights-card-pad">
                <div className="insights-card-title-row">
                  <h3 className="insights-card-title">Streak timeline</h3>
                  <div className="insights-card-meta">Top 10</div>
                </div>
                <StreakTimelinePanel features={filtered} allItems={allItems} type="Run" maxStreaks={10} />
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
