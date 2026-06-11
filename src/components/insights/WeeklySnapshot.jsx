import React, { useMemo } from "react";
import { TZ, dayKeyFromDate, addDays, dateFromKey } from "../../lib/streak";

// ─── helpers ──────────────────────────────────────────────────────────────────
function fmtKm(m) {
  const km = m / 1000;
  return km >= 10 ? km.toFixed(1) : km.toFixed(2);
}

function fmtTime(sec) {
  if (!sec) return "0 min";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m} min`;
}

function fmtDelta(val, unit = "km") {
  if (val === 0) return { text: "same as last week", color: "rgba(229,231,235,0.5)", arrow: "→" };
  const abs = Math.abs(val).toFixed(unit === "km" ? 1 : 0);
  const up = val > 0;
  return {
    text: `${up ? "+" : "−"}${abs} ${unit} vs last week`,
    color: up ? "#34d399" : "#f87171",
    arrow: up ? "↑" : "↓",
  };
}

// Get the ISO week key (YYYY-WW) for a given date in NZ time
function isoWeekKey(date, timeZone = TZ) {
  // Get the NZ local date
  const nzStr = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
  const [y, mo, d] = nzStr.split("-").map(Number);
  const local = new Date(Date.UTC(y, mo - 1, d));

  // ISO week: Monday-based, week 1 = week containing first Thursday
  const day = local.getUTCDay() || 7; // 1=Mon … 7=Sun
  const thursday = new Date(local);
  thursday.setUTCDate(local.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((thursday - yearStart) / 86400000 + 1) / 7);
  return `${thursday.getUTCFullYear()}-${String(week).padStart(2, "0")}`;
}

// Monday of the ISO week that contains `date`
function mondayOfWeek(date, timeZone = TZ) {
  const nzStr = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
  const [y, mo, d] = nzStr.split("-").map(Number);
  const local = new Date(Date.UTC(y, mo - 1, d));
  const day = local.getUTCDay() || 7;
  const monday = new Date(local);
  monday.setUTCDate(local.getUTCDate() - (day - 1));
  return monday;
}

const DOW_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ─── component ────────────────────────────────────────────────────────────────
export default function WeeklySnapshot({ allItems = [] }) {

  const { thisWeekKm, thisWeekTime, lastWeekKm, lastWeekTime, dailyKm } = useMemo(() => {
    const now = new Date();

    // What day of the week is today? 0=Mon … 6=Sun
    const monday = mondayOfWeek(now);
    const todayKey = dayKeyFromDate(now, TZ);

    // Build day keys for this week and last week
    const thisDayKeys = [];
    const lastDayKeys = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setUTCDate(monday.getUTCDate() + i);
      thisDayKeys.push(dayKeyFromDate(d, TZ));

      const ld = new Date(monday);
      ld.setUTCDate(monday.getUTCDate() + i - 7);
      lastDayKeys.push(dayKeyFromDate(ld, TZ));
    }

    // Find today's index (0=Mon … 6=Sun) so we only compare up to today
    const todayIdx = thisDayKeys.indexOf(todayKey);
    const cutoffIdx = todayIdx === -1 ? 6 : todayIdx; // days Mon..today inclusive

    // Aggregate per-day from allItems
    const thisDayMap = {}; // dayKey -> { km, timeSec }
    const lastDayMap = {};
    for (const key of thisDayKeys) thisDayMap[key] = { km: 0, timeSec: 0 };
    for (const key of lastDayKeys) lastDayMap[key] = { km: 0, timeSec: 0 };

    for (const item of allItems) {
      if (!item.start_date || item.type !== "Run") continue;
      const key = dayKeyFromDate(new Date(item.start_date), TZ);
      const distKm = typeof item.distance === "number" ? item.distance / 1000 : 0;
      const timeSec = typeof item.moving_time === "number" ? item.moving_time : 0;
      if (thisDayMap[key] !== undefined) {
        thisDayMap[key].km += distKm;
        thisDayMap[key].timeSec += timeSec;
      }
      if (lastDayMap[key] !== undefined) {
        lastDayMap[key].km += distKm;
        lastDayMap[key].timeSec += timeSec;
      }
    }

    // Sum only Mon → today for both this week and last week (same window)
    let thisWeekKm = 0, thisWeekTime = 0;
    let lastWeekKm = 0, lastWeekTime = 0;
    for (let i = 0; i <= cutoffIdx; i++) {
      thisWeekKm  += thisDayMap[thisDayKeys[i]].km;
      thisWeekTime += thisDayMap[thisDayKeys[i]].timeSec;
      lastWeekKm  += lastDayMap[lastDayKeys[i]].km;
      lastWeekTime += lastDayMap[lastDayKeys[i]].timeSec;
    }

    // Daily bars for this week (all 7 days, greyed out after today)
    const dailyKm = thisDayKeys.map((key, i) => ({
      label: DOW_LABELS[i],
      km: thisDayMap[key].km,
      isToday: key === todayKey,
      isFuture: i > cutoffIdx,
    }));

    return { thisWeekKm, thisWeekTime, lastWeekKm, lastWeekTime, dailyKm };
  }, [allItems]);

  const todayLabel = dailyKm.find(d => d.isToday)?.label ?? "today";
  const kmDelta = fmtDelta(thisWeekKm - lastWeekKm, "km");
  const timeDeltaMin = Math.round((thisWeekTime - lastWeekTime) / 60);
  const timeDelta = fmtDelta(timeDeltaMin, "min");

  const maxDailyKm = Math.max(...dailyKm.map((d) => d.km), 0.1);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1.4fr", gap: 12 }}>

      {/* This week — distance */}
      <StatBlock
        label={`Mon–${todayLabel} · km`}
        value={`${fmtKm(thisWeekKm * 1000)} km`}
        delta={kmDelta}
        sub={`Last week Mon–${todayLabel}: ${fmtKm(lastWeekKm * 1000)} km`}
        accent="#60a5fa"
      />

      {/* This week — time */}
      <StatBlock
        label={`Mon–${todayLabel} · time`}
        value={fmtTime(thisWeekTime)}
        delta={timeDelta}
        sub={`Last week Mon–${todayLabel}: ${fmtTime(lastWeekTime)}`}
        accent="#a78bfa"
      />

      {/* Daily breakdown Mon–Sun */}
      <div style={card}>
        <div style={cardLabel}>This week · daily km</div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 52, marginTop: 8 }}>
          {dailyKm.map((d) => {
            const pct = maxDailyKm > 0 ? d.km / maxDailyKm : 0;
            const isToday = d.isToday;
            return (
              <div
                key={d.label}
                style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}
                title={`${d.label}: ${d.km.toFixed(2)} km`}
              >
                <div
                  style={{
                    width: "100%",
                    height: Math.max(pct * 44, d.km > 0 ? 3 : 0),
                    borderRadius: 4,
                    background: d.isFuture
                      ? "rgba(255,255,255,0.05)"
                      : isToday
                      ? "linear-gradient(180deg, #a78bfa, #6366f1)"
                      : d.km > 0
                      ? "rgba(96,165,250,0.7)"
                      : "rgba(255,255,255,0.06)",
                    transition: "height .3s ease",
                    opacity: d.isFuture ? 0.3 : 1,
                  }}
                />
                <div style={{
                  fontSize: 10,
                  fontWeight: isToday ? 900 : 600,
                  color: d.isFuture ? "rgba(229,231,235,0.25)" : isToday ? "#a78bfa" : "rgba(229,231,235,0.55)",
                }}>
                  {d.label}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 8, fontSize: 11, color: "rgba(229,231,235,0.45)" }}>
          Mon → Sun · NZ time
        </div>
      </div>

    </div>
  );
}

function StatBlock({ label, value, delta, sub, accent }) {
  return (
    <div style={{ ...card, borderTopColor: accent }}>
      <div style={cardLabel}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 950, color: "#fff", lineHeight: 1.1, marginTop: 6 }}>
        {value}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 6 }}>
        <span style={{ fontSize: 16, lineHeight: 1, color: delta.color }}>{delta.arrow}</span>
        <span style={{ fontSize: 12, color: delta.color, fontWeight: 700 }}>{delta.text}</span>
      </div>
      <div style={{ marginTop: 4, fontSize: 11, color: "rgba(229,231,235,0.40)" }}>{sub}</div>
    </div>
  );
}

const card = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.09)",
  borderTop: "2px solid rgba(96,165,250,0.6)",
  borderRadius: 14,
  padding: "12px 14px",
};

const cardLabel = {
  fontSize: 11,
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: "0.07em",
  color: "rgba(229,231,235,0.55)",
};
