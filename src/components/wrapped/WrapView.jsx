import React, { useMemo } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  LineChart,
  Line,
} from "recharts";

// ---------- helpers ----------
const TZ = "Pacific/Auckland";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const monthLabel = (i) => MONTHS[i] || "";

const fmtKm = (km) => (km ?? 0).toLocaleString(undefined, { maximumFractionDigits: 1 });

const fmtPct = (pct) => {
  if (pct == null || !Number.isFinite(pct)) return "–";
  return `${pct.toFixed(1)}%`;
};

const fmtTimeHrs = (secs) => {
  const s = Math.max(0, Math.round(secs ?? 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
};

const fmtPace = (secPerKm) => {
  if (!secPerKm || !Number.isFinite(secPerKm)) return "–";
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}/km`;
};

const paceFromAvgSpeed = (avgSpeedMps) => {
  if (!avgSpeedMps || !Number.isFinite(avgSpeedMps) || avgSpeedMps <= 0) return null;
  return 1000 / avgSpeedMps;
};

const nzYearFromIso = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(+d)) return null;
  const ny = new Intl.DateTimeFormat("en-NZ", { timeZone: TZ, year: "numeric" }).format(d);
  return Number(ny);
};

const nzMonthFromIso = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(+d)) return null;
  const parts = new Intl.DateTimeFormat("en-NZ", { timeZone: TZ, month: "numeric" }).format(d);
  return Number(parts) - 1;
};

const nzDayKey = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(+d)) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
};

const weekStartKeyNZ = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(+d)) return null;

  const parts = new Intl.DateTimeFormat("en-NZ", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);

  const y = Number(parts.find((p) => p.type === "year")?.value);
  const m = Number(parts.find((p) => p.type === "month")?.value);
  const day = Number(parts.find((p) => p.type === "day")?.value);

  const utc = new Date(Date.UTC(y, m - 1, day));
  const dow = (utc.getUTCDay() + 6) % 7; // Mon=0
  utc.setUTCDate(utc.getUTCDate() - dow);
  return utc.toISOString().slice(0, 10);
};

// ---- NEW: date helpers for "days run this year / days so far" ----
const nzYmdToUtcDate = (year, month1to12, day) => new Date(Date.UTC(year, month1to12 - 1, day));

const nzTodayUtc = () => {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-NZ", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const y = Number(parts.find((p) => p.type === "year")?.value);
  const m = Number(parts.find((p) => p.type === "month")?.value);
  const d = Number(parts.find((p) => p.type === "day")?.value);

  return nzYmdToUtcDate(y, m, d);
};

const daysBetweenInclusive = (startUtc, endUtc) => {
  const ms = endUtc.getTime() - startUtc.getTime();
  return Math.floor(ms / 86400000) + 1;
};

// ---------- stats computation ----------
function computeWrapped(items = []) {
  const now = new Date();
  const currentYear = nzYearFromIso(now.toISOString());
  const lastYear = currentYear - 1;

  const runs = items
    .filter((i) => (i.type || "").toLowerCase() === "run")
    .map((i) => {
      const start = i.start_date;
      const year = nzYearFromIso(start);
      const month = nzMonthFromIso(start);
      const dayKey = nzDayKey(start);
      const weekKey = weekStartKeyNZ(start);

      const distKm = (i.distance ?? 0) / 1000;
      const movingS = i.moving_time ?? 0;
      const paceSPerKm = movingS > 0 && distKm > 0 ? movingS / distKm : paceFromAvgSpeed(i.average_speed);

      return { ...i, year, month, dayKey, weekKey, distKm, movingS, paceSPerKm };
    })
    .filter((r) => r.year != null);

  const byYear = (year) => runs.filter((r) => r.year === year);

  const summariseYear = (year) => {
    const ys = byYear(year);
    const totalKm = ys.reduce((s, r) => s + r.distKm, 0);
    const totalSeconds = ys.reduce((s, r) => s + r.movingS, 0);
    const runCount = ys.length;
    const avgRunKm = runCount ? totalKm / runCount : 0;
    const avgPaceSPerKm = totalKm > 0 ? totalSeconds / totalKm : null;

    const monthly = Array.from({ length: 12 }).map((_, m) => {
      const ms = ys.filter((r) => r.month === m);
      const km = ms.reduce((s, r) => s + r.distKm, 0);
      const seconds = ms.reduce((s, r) => s + r.movingS, 0);
      return { month: m, km, seconds, runs: ms.length };
    });

    const biggestMonth = monthly.reduce((best, cur) => (cur.km > best.km ? cur : best), {
      km: 0,
      month: null,
      runs: 0,
    });

    const mostConsistentMonth = monthly.reduce((best, cur) => (cur.runs > best.runs ? cur : best), {
      runs: 0,
      month: null,
      km: 0,
    });

    // ---- Days run + streaks (NZ calendar days) ----
    const startUtc = new Date(Date.UTC(year, 0, 1));
    const endUtc = year === currentYear ? nzTodayUtc() : new Date(Date.UTC(year, 11, 31));
    const endKey = endUtc.toISOString().slice(0, 10);

    const daysInPeriod = daysBetweenInclusive(startUtc, endUtc);

    const daySetAll = new Set(ys.map((r) => r.dayKey).filter(Boolean));
    const daySet = new Set(Array.from(daySetAll).filter((k) => k <= endKey));

    const daysRun = daySet.size;
    const daysRunPct = daysInPeriod > 0 ? (daysRun / daysInPeriod) * 100 : null;

    // longest day streak (based on filtered daySet)
    const sortedDays = Array.from(daySet).sort();
    let longestDayStreak = 0;
    let curStreak = 0;
    let prev = null;
    for (const day of sortedDays) {
      if (!prev) curStreak = 1;
      else {
        const prevD = new Date(prev);
        const next = new Date(prevD);
        next.setDate(prevD.getDate() + 1);
        curStreak = day === next.toISOString().slice(0, 10) ? curStreak + 1 : 1;
      }
      longestDayStreak = Math.max(longestDayStreak, curStreak);
      prev = day;
    }

    // runs per week + best weekly streak
    const weekCounts = ys.reduce((acc, r) => {
      if (!r.weekKey) return acc;
      // ignore weeks beyond endKey for the current year
      if (r.weekKey > endKey) return acc;
      acc[r.weekKey] = (acc[r.weekKey] || 0) + 1;
      return acc;
    }, {});

    const weekKeys = Object.keys(weekCounts).sort();
    const runsPerWeekAvg = weekKeys.length ? runCount / weekKeys.length : 0;

    let longestWeekStreak = 0;
    let curWeekStreak = 0;
    let prevWeek = null;
    for (const wk of weekKeys) {
      if (!prevWeek) curWeekStreak = 1;
      else {
        const prevW = new Date(prevWeek);
        const nextW = new Date(prevW);
        nextW.setDate(prevW.getDate() + 7);
        curWeekStreak = wk === nextW.toISOString().slice(0, 10) ? curWeekStreak + 1 : 1;
      }
      longestWeekStreak = Math.max(longestWeekStreak, curWeekStreak);
      prevWeek = wk;
    }

    return {
      year,
      totalKm,
      totalSeconds,
      runs: runCount,
      avgRunKm,
      avgPaceSPerKm,
      monthly,
      biggestMonth,
      mostConsistentMonth,
      runsPerWeekAvg,
      longestWeekStreak,
      longestDayStreak,

      // NEW
      daysRun,
      daysInPeriod,
      daysRunPct,
    };
  };

  const current = summariseYear(currentYear);
  const last = summariseYear(lastYear);

  const yoy = {
    distanceDeltaKm: current.totalKm - last.totalKm,
    distanceDeltaPct: last.totalKm > 0 ? ((current.totalKm - last.totalKm) / last.totalKm) * 100 : null,
    timeDeltaSeconds: current.totalSeconds - last.totalSeconds,
    timeDeltaPct: last.totalSeconds > 0 ? ((current.totalSeconds - last.totalSeconds) / last.totalSeconds) * 100 : null,
    runsDelta: current.runs - last.runs,
    runsDeltaPct: last.runs > 0 ? ((current.runs - last.runs) / last.runs) * 100 : null,
    avgRunKmDelta: current.avgRunKm - last.avgRunKm,
    avgRunKmDeltaPct: last.avgRunKm > 0 ? ((current.avgRunKm - last.avgRunKm) / last.avgRunKm) * 100 : null,
    avgPaceDeltaSPerKm:
      current.avgPaceSPerKm && last.avgPaceSPerKm ? current.avgPaceSPerKm - last.avgPaceSPerKm : null,
    avgPaceDeltaPct:
      current.avgPaceSPerKm && last.avgPaceSPerKm
        ? ((current.avgPaceSPerKm - last.avgPaceSPerKm) / last.avgPaceSPerKm) * 100
        : null,
  };

  return { currentYear, lastYear, current, last, yoy };
}

// ---------- styles ----------
const styles = {
  page: {
    height: "100%",
    width: "100%",
    overflowY: "auto",
    overflowX: "hidden",
    WebkitOverflowScrolling: "touch",
    background:
      "radial-gradient(1200px 600px at 15% -10%, #1d4ed8 0%, transparent 60%)," +
      "radial-gradient(1000px 600px at 110% 20%, #06b6d4 0%, transparent 55%)," +
      "radial-gradient(1000px 600px at 50% 120%, #a855f7 0%, transparent 55%)," +
      "linear-gradient(180deg, #05060a 0%, #0b1020 100%)",
    color: "#e5e7eb",
  },
  wrap: {
    maxWidth: 1100,
    margin: "0 auto",
    padding: "24px 20px 48px",
  },
  pill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 10px",
    borderRadius: 999,
    background: "rgba(255,255,255,0.08)",
    border: "1px solid rgba(255,255,255,0.12)",
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  h1: {
    fontSize: 40,
    fontWeight: 800,
    letterSpacing: -0.6,
    margin: "8px 0 2px",
    color: "#fff",
  },
  subtitle: { fontSize: 14, color: "rgba(229,231,235,0.75)" },
  grid4: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 14,
    marginTop: 18,
  },
  grid2: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: 14,
    marginTop: 14,
  },
  card: {
    position: "relative",
    padding: "16px 16px 14px",
    borderRadius: 18,
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.10)",
    boxShadow: "0 12px 30px rgba(0,0,0,0.35)",
    backdropFilter: "blur(6px)",
  },
  cardTitle: { fontSize: 13, color: "rgba(229,231,235,0.7)" },
  cardValue: {
    fontSize: 28,
    fontWeight: 800,
    marginTop: 4,
    color: "#fff",
    letterSpacing: -0.3,
  },
  cardSub: { fontSize: 12, color: "rgba(229,231,235,0.55)", marginTop: 2 },
  deltaPill: (good) => ({
    marginTop: 10,
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 8px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 700,
    background: good ? "rgba(16,185,129,0.14)" : "rgba(244,63,94,0.14)",
    color: good ? "#a7f3d0" : "#fecdd3",
    border: `1px solid ${good ? "rgba(16,185,129,0.35)" : "rgba(244,63,94,0.35)"}`,
  }),
  section: { marginTop: 26 },
  sectionHeader: {
    display: "flex",
    alignItems: "end",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 800,
    color: "#fff",
    letterSpacing: 0.3,
  },

  // OPTION A: lighter glass holder for chart sections
  panel: {
    padding: 16,
    borderRadius: 18,
    background: "rgba(255,255,255,0.10)",
    border: "1px solid rgba(255,255,255,0.16)",
    boxShadow: "0 12px 30px rgba(0,0,0,0.35)",
    backdropFilter: "blur(8px)",
  },
};

// ---------- UI atoms ----------
function StatCard({ title, value, sub, deltaText, deltaValue, positiveGood = true }) {
  const isPositive = deltaValue != null ? deltaValue >= 0 : null;
  const good = isPositive == null ? true : positiveGood ? isPositive : !isPositive;

  return (
    <div style={styles.card} className="wrapped-card">
      <div style={styles.cardTitle}>{title}</div>
      <div style={styles.cardValue}>{value}</div>
      {sub && <div style={styles.cardSub}>{sub}</div>}
      {deltaText && (
        <div style={styles.deltaPill(good)}>
          <span>{isPositive ? "▲" : "▼"}</span>
          <span>{deltaText}</span>
        </div>
      )}
    </div>
  );
}

function Section({ title, right, children }) {
  return (
    <section style={styles.section}>
      <div style={styles.sectionHeader}>
        <div style={styles.sectionTitle}>{title}</div>
        {right}
      </div>
      <div style={styles.panel}>{children}</div>
    </section>
  );
}

// ---------- main component ----------
export default function WrapView({ items = [] }) {
  const data = useMemo(() => computeWrapped(items), [items]);
  const { currentYear, lastYear, current, last, yoy } = data;

  const monthlyChart = current.monthly.map((m) => ({
    month: monthLabel(m.month),
    [currentYear]: m.km,
    [lastYear]: last.monthly[m.month]?.km ?? 0,
  }));

  return (
    <div style={styles.page}>
      {/* tiny CSS for hover glow */}
      <style>{`
        .wrapped-card { transition: transform .15s ease, box-shadow .15s ease; }
        .wrapped-card:hover { transform: translateY(-2px); box-shadow: 0 16px 40px rgba(0,0,0,0.45); }
      `}</style>

      <div style={styles.wrap}>
        {/* Header */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={styles.pill}>Running Wrapped</div>
          <div style={styles.h1}>Your {currentYear} Season</div>
          <div style={styles.subtitle}>
            Calendar year only, compared to {lastYear}. Timezone: {TZ}
          </div>
        </div>

        {/* Hero cards */}
        <div style={styles.grid4}>
          <StatCard
            title="Total distance"
            value={`${fmtKm(current.totalKm)} km`}
            sub={`${fmtKm(last.totalKm)} km last year`}
            deltaText={`${yoy.distanceDeltaKm >= 0 ? "+" : ""}${fmtKm(yoy.distanceDeltaKm)} km (${fmtPct(
              yoy.distanceDeltaPct
            )})`}
            deltaValue={yoy.distanceDeltaKm}
            positiveGood
          />
          <StatCard
            title="Total time running"
            value={fmtTimeHrs(current.totalSeconds)}
            sub={`${fmtTimeHrs(last.totalSeconds)} last year`}
            deltaText={`${yoy.timeDeltaSeconds >= 0 ? "+" : ""}${fmtTimeHrs(yoy.timeDeltaSeconds)} (${fmtPct(
              yoy.timeDeltaPct
            )})`}
            deltaValue={yoy.timeDeltaSeconds}
            positiveGood
          />
          <StatCard
            title="Number of runs"
            value={current.runs.toLocaleString()}
            sub={`${last.runs.toLocaleString()} last year`}
            deltaText={`${yoy.runsDelta >= 0 ? "+" : ""}${yoy.runsDelta} (${fmtPct(yoy.runsDeltaPct)})`}
            deltaValue={yoy.runsDelta}
            positiveGood
          />
          <StatCard
            title="Average run distance"
            value={`${fmtKm(current.avgRunKm)} km`}
            sub={`${fmtKm(last.avgRunKm)} km last year`}
            deltaText={`${yoy.avgRunKmDelta >= 0 ? "+" : ""}${fmtKm(yoy.avgRunKmDelta)} km (${fmtPct(
              yoy.avgRunKmDeltaPct
            )})`}
            deltaValue={yoy.avgRunKmDelta}
            positiveGood
          />
        </div>

        {/* Secondary cards */}
        <div style={styles.grid2}>
          <StatCard
            title="Average pace"
            value={fmtPace(current.avgPaceSPerKm)}
            sub={`${fmtPace(last.avgPaceSPerKm)} last year`}
            deltaText={
              yoy.avgPaceDeltaSPerKm != null
                ? `${yoy.avgPaceDeltaSPerKm <= 0 ? "faster" : "slower"} by ${fmtPace(
                    Math.abs(yoy.avgPaceDeltaSPerKm)
                  )} (${fmtPct(yoy.avgPaceDeltaPct)})`
                : null
            }
            deltaValue={-yoy.avgPaceDeltaSPerKm}
            positiveGood
          />
          <StatCard
            title="Runs per week"
            value={current.runsPerWeekAvg.toFixed(1)}
            sub={`${last.runsPerWeekAvg.toFixed(1)} last year`}
            deltaText={`${current.runsPerWeekAvg - last.runsPerWeekAvg >= 0 ? "+" : ""}${(
              current.runsPerWeekAvg - last.runsPerWeekAvg
            ).toFixed(1)} per week`}
            deltaValue={current.runsPerWeekAvg - last.runsPerWeekAvg}
            positiveGood
          />
        </div>

        {/* Consistency */}
        <Section title="Consistency and habits">
          <div style={styles.grid4}>
            <StatCard
              title="Best weekly streak"
              value={`${current.longestWeekStreak} weeks`}
              sub={`${last.longestWeekStreak} weeks last year`}
            />
            <StatCard
              title="Longest day streak"
              value={`${current.longestDayStreak} days`}
              sub={`${last.longestDayStreak} days last year`}
            />

            {/* NEW: Days run this year out of days so far */}
            <StatCard
              title="Days run"
              value={`${current.daysRun} / ${current.daysInPeriod} days`}
              sub={`${last.daysRun} / ${last.daysInPeriod} days last year`}
              deltaText={current.daysRunPct != null ? `${fmtPct(current.daysRunPct)} of days so far` : null}
            />

            <StatCard
              title="Most consistent month"
              value={
                current.mostConsistentMonth.month != null
                  ? `${monthLabel(current.mostConsistentMonth.month)} (${current.mostConsistentMonth.runs} runs)`
                  : "–"
              }
              sub={
                last.mostConsistentMonth.month != null ? `${monthLabel(last.mostConsistentMonth.month)} last year` : null
              }
            />
          </div>
        </Section>

        {/* Biggest month */}
        <Section title="Biggest month">
          <div style={styles.grid2}>
            <StatCard
              title={`${currentYear} biggest month`}
              value={
                current.biggestMonth.month != null
                  ? `${monthLabel(current.biggestMonth.month)} – ${fmtKm(current.biggestMonth.km)} km`
                  : "–"
              }
              sub={
                last.biggestMonth.month != null
                  ? `${lastYear} biggest month: ${monthLabel(last.biggestMonth.month)} – ${fmtKm(last.biggestMonth.km)} km`
                  : null
              }
            />
            <div style={styles.card}>
              <div style={styles.cardTitle}>Typical month this year</div>
              <div style={styles.cardValue}>{fmtKm(current.totalKm / 12)} km</div>
              <div style={styles.cardSub}>Average across months</div>
              {current.biggestMonth.month != null && (
                <div style={{ ...styles.cardSub, marginTop: 8 }}>
                  Peak was {(current.biggestMonth.km / (current.totalKm / 12)).toFixed(1)}× your average
                </div>
              )}
            </div>
          </div>
        </Section>

        {/* Charts */}
        <Section
          title="Distance by month"
          right={<div style={{ fontSize: 12, color: "rgba(229,231,235,0.6)" }}>{currentYear} vs {lastYear}</div>}
        >
          {/* Bars */}
          <div style={{ height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyChart} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                {/* Extra polish: clearer grid */}
                <CartesianGrid stroke="rgba(255,255,255,0.12)" strokeDasharray="3 3" />
                {/* Extra polish: clearer axes */}
                <XAxis
                  dataKey="month"
                  tick={{ fill: "rgba(255,255,255,0.85)", fontSize: 12 }}
                  axisLine={{ stroke: "rgba(255,255,255,0.25)" }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: "rgba(255,255,255,0.85)", fontSize: 12 }}
                  axisLine={{ stroke: "rgba(255,255,255,0.25)" }}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{
                    background: "rgba(15,23,42,0.95)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: 12,
                  }}
                  labelStyle={{ color: "white" }}
                  formatter={(val) => [`${fmtKm(val)} km`, ""]}
                />
                <Legend wrapperStyle={{ color: "white" }} />

                {/* Bars: slightly lighter so they read on the brighter panel */}
                <Bar dataKey={String(lastYear)} radius={[9, 9, 0, 0]} fill="rgba(255,255,255,0.28)" />
                <Bar dataKey={String(currentYear)} radius={[9, 9, 0, 0]} fill="rgba(255,255,255,0.60)" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Mini lines */}
          <div
            style={{
              height: 140,
              marginTop: 14,
              padding: 10,
              borderRadius: 14,
              // lightened holder to match panel
              background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.14)",
              backdropFilter: "blur(6px)",
            }}
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthlyChart}>
                <CartesianGrid stroke="rgba(255,255,255,0.10)" strokeDasharray="3 3" />
                <XAxis dataKey="month" hide />
                <YAxis hide domain={[0, "dataMax"]} />
                <Tooltip
                  contentStyle={{
                    background: "rgba(15,23,42,0.95)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: 12,
                  }}
                  labelStyle={{ color: "white" }}
                  formatter={(val, name) => [`${fmtKm(val)} km`, name]}
                />

                <Line type="monotone" dataKey={String(lastYear)} dot={false} stroke="rgba(255,255,255,0.35)" strokeWidth={2.5} />
                <Line type="monotone" dataKey={String(currentYear)} dot={false} stroke="rgba(96,165,250,0.95)" strokeWidth={3} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Section>

        <div style={{ marginTop: 18, fontSize: 11, color: "rgba(229,231,235,0.5)" }}>
          Built from runs_index.json • Calendar years in {TZ}
        </div>
      </div>
    </div>
  );
}
