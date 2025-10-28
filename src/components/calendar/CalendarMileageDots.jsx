import React from "react";
import { TZ, dayKeyFromDate } from "../../lib/streak";

// ---- Thresholds
const LONG_RUN_SECONDS = 70 * 60; // 1h10m
const WORKOUT_PACE_SPK = 240;     // < 4:00 per km
const WALK_PACE_SPK    = 540;     // >= 9:00 per km

// Slice order for consistent pies/legend
const KINDS = ["walk", "workout", "long", "jog"];

const COLORS = {
  walk:    { fill: "#93c5fd", edge: "#60a5fa", label: "Walk" },      // blue
  workout: { fill: "#f87171", edge: "#ef4444", label: "Workout" },   // red
  long:    { fill: "#f59e0b", edge: "#d97706", label: "Long" },      // amber
  jog:     { fill: "#34d399", edge: "#059669", label: "Jog" },       // green
};

// ---------- Helpers ----------
const num = (x) => (x == null || x === "" ? null : isFinite(+x) ? +x : null);

function seconds(v) {
  if (v == null) return null;
  if (typeof v === "string") {
    const asNum = num(v);
    if (asNum == null) return null;
    v = asNum;
  }
  // Treat very large values as ms
  if (v > 3_600_000) return Math.round(v / 1000);
  if (v > 100000)     return Math.round(v / 1000);
  return v;
}

/** Prefer `items` shape (runs_index.json), fallback to features.properties */
function normaliseActivities(items, features) {
  if (items && items.length) {
    return items.map((it) => ({
      id: String(it.id),
      name: it.name,
      start_date: it.start_date,
      distance_m: it.distance ?? it.distance_m ?? null,   // metres
      moving_time: it.moving_time ?? null,                 // seconds
      elapsed_time: it.elapsed_time ?? null,               // seconds
      average_speed: it.average_speed ?? null,             // m/s (already m/s in index)
      type: it.type ?? it.sport_type ?? null,
    }));
  }
  // Fallback to GeoJSON properties (may be sparse)
  return (features || []).map((f) => {
    const p = f?.properties || {};
    return {
      id: String(p.id ?? ""),
      name: p.name,
      start_date: p.start_date,
      distance_m: p.distance ?? p.distance_m ?? null,
      moving_time: p.moving_time ?? null,
      elapsed_time: p.elapsed_time ?? null,
      average_speed: p.average_speed ?? null,
      type: p.type ?? p.sport_type ?? null,
    };
  });
}

/** Compute pace in sec/km using average_speed (m/s) or moving_time / distance */
function paceSecPerKm(a) {
  if (a?.average_speed) {
    return 1000 / a.average_speed; // m/s -> s/km
  }
  if (a?.moving_time && a?.distance_m) {
    return a.moving_time / (a.distance_m / 1000);
  }
  if (a?.elapsed_time && a?.distance_m) {
    return a.elapsed_time / (a.distance_m / 1000);
  }
  return null;
}

// ---- SVG helpers for pie arcs (angles in degrees)
function polarToCartesian(cx, cy, r, angleDeg) {
  const a = (angleDeg - 90) * (Math.PI / 180); // start at 12 o'clock
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}
function arcPath(cx, cy, r, startDeg, endDeg) {
  const start = polarToCartesian(cx, cy, r, startDeg);
  const end   = polarToCartesian(cx, cy, r, endDeg);
  const largeArc = endDeg - startDeg <= 180 ? 0 : 1;
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y} Z`;
}

/**
 * CalendarMileageFill
 * Uses indexData.items (preferred) to ensure consistent classification with Activities/RecentRuns.
 */
export default function CalendarMileageFill({
  items = [],            // <-- pass indexData?.items here
  features,              // fallback only
  timeZone = TZ,
  startFromLatest = true,
  maxKmForScale,
  onDayClick,
  title = "Mileage calendar",
  minDotPx = 10,
  labelMinPx = 18,
  fitToContainer = true,
}) {
  // Build unified activity list
  const activities = React.useMemo(
    () => normaliseActivities(items, features),
    [items, features]
  );

  // Aggregate per-day using same rules as RecentRunsList
  const { byDay, latestDate } = React.useMemo(() => {
    const m = new Map(); // key -> { totalKm, walk, workout, long, jog }
    let latest = null;

    for (const a of activities) {
      if (!a?.start_date) continue;

      const d = new Date(a.start_date);
      const key = dayKeyFromDate(d, timeZone);
      if (!latest || d > latest) latest = d;

      const distM = num(a.distance_m);
      if (distM == null || distM <= 0) continue;

      const km = distM / 1000;
      const moving = seconds(a.moving_time ?? a.elapsed_time ?? null);

      const secPerKm = paceSecPerKm(a);

      // Classify: walk (pace ≥ 9:00) > workout (< 4:00) > long (≥ 70 min) > jog
      let kind = "jog";
      if (secPerKm != null && secPerKm >= WALK_PACE_SPK)       kind = "walk";
      else if (secPerKm != null && secPerKm < WORKOUT_PACE_SPK) kind = "workout";
      else if ((moving ?? 0) >= LONG_RUN_SECONDS)               kind = "long";

      const cur = m.get(key) || { totalKm: 0, walk: 0, workout: 0, long: 0, jog: 0 };
      cur.totalKm += km;
      cur[kind]   += km;
      m.set(key, cur);
    }

    return { byDay: m, latestDate: latest || new Date() };
  }, [activities, timeZone]);

  // Month model
  const initialAnchor = React.useMemo(() => {
    const base = startFromLatest ? latestDate : new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  }, [latestDate, startFromLatest]);

  const [monthAnchor, setMonthAnchor] = React.useState(initialAnchor);
  const goPrev  = () => setMonthAnchor(d => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  const goNext  = () => setMonthAnchor(d => new Date(d.getFullYear(), d.getMonth() + 1, 1));
  const goToday = () => setMonthAnchor(new Date(new Date().getFullYear(), new Date().getMonth(), 1));

  // Build visible grid (Mon–Sun)
  const { cells, monthLabel, kmTotalsForScale, weeks } = React.useMemo(() => {
    const y = monthAnchor.getFullYear();
    const m = monthAnchor.getMonth();
    const first = new Date(y, m, 1);
    const last  = new Date(y, m + 1, 0);
    const monthName = first.toLocaleDateString(undefined, { year: "numeric", month: "long" });

    const weekday = (day) => (day + 6) % 7; // Monday=0
    const lead = weekday(first.getDay());
    const totalDays  = last.getDate();
    const totalCells = Math.ceil((lead + totalDays) / 7) * 7;
    const weekCount  = totalCells / 7;

    const arr = [];
    const totals = [];

    for (let i = 0; i < totalCells; i++) {
      const n = i - lead + 1;
      if (n < 1 || n > totalDays) {
        arr.push({ inMonth: false });
      } else {
        const d = new Date(y, m, n);
        const key = dayKeyFromDate(d, timeZone);
        const rec = byDay.get(key) || { totalKm: 0, walk: 0, workout: 0, long: 0, jog: 0 };
        if (rec.totalKm > 0) totals.push(rec.totalKm);

        const slices = [];
        KINDS.forEach((k) => {
          if (rec[k] > 0) slices.push({ kind: k, km: rec[k] });
        });

        arr.push({ inMonth: true, key, totalKm: rec.totalKm, slices });
      }
    }
    return { cells: arr, monthLabel: monthName, kmTotalsForScale: totals, weeks: weekCount };
  }, [monthAnchor, byDay, timeZone]);

  // Dot size scale by total km/day
  const scaleMaxKm = React.useMemo(() => {
    if (maxKmForScale != null) return Math.max(1, maxKmForScale);
    if (!kmTotalsForScale.length) return 1;
    const sorted = [...kmTotalsForScale].sort((a, b) => a - b);
    const idx = Math.floor(0.95 * (sorted.length - 1)); // 95th percentile
    return Math.max(1, sorted[idx]);
  }, [kmTotalsForScale, maxKmForScale]);

  const sizeFactor = (km) => (!km || km <= 0) ? 0 : Math.min(1, km / scaleMaxKm);

  // Auto-fit sizing (no scrolling)
  const containerRef = React.useRef(null);
  const headerRef = React.useRef(null);
  const monthRef  = React.useRef(null);
  const daysHeadRef = React.useRef(null);
  const legendRef = React.useRef(null);

  const GAP = 10;
  const SIDE_PAD = 12 * 2;
  const [cellPx, setCellPx] = React.useState(44);

  React.useLayoutEffect(() => {
    if (!fitToContainer) return;
    const el = containerRef.current;
    if (!el) return;

    const ro = new ResizeObserver(() => {
      const box = el.getBoundingClientRect();
      const headerH = headerRef.current?.offsetHeight ?? 0;
      const monthH  = monthRef.current?.offsetHeight  ?? 0;
      const daysH   = daysHeadRef.current?.offsetHeight ?? 0;
      const legendH = legendRef.current?.offsetHeight ?? 0;

      const verticalGaps = GAP * (weeks - 1);
      const availableH = Math.max(0, box.height - headerH - monthH - daysH - legendH - 8);
      const perRowH = (availableH - verticalGaps) / weeks;

      const availableW = Math.max(0, box.width - SIDE_PAD);
      const horizontalGaps = GAP * (7 - 1);
      const perColW = (availableW - horizontalGaps) / 7;

      const size = Math.floor(Math.max(18, Math.min(perRowH, perColW)));
      setCellPx(size);
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, [fitToContainer, weeks]);

  const gridStyle = fitToContainer
    ? {
        display: "grid",
        gridTemplateColumns: `repeat(7, ${cellPx}px)`,
        gridTemplateRows: `repeat(${weeks}, ${cellPx}px)`,
        gap: GAP,
        justifyContent: "center",
        alignContent: "start",
      }
    : {
        display: "grid",
        gridTemplateColumns: "repeat(7, 1fr)",
        gap: GAP,
      };

  const weekdayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const todayKey = dayKeyFromDate(new Date(), timeZone);

  // ---- Render
  return (
    <div
      ref={containerRef}
      style={{ background: "#fff", border: "1px solid #eee", borderRadius: 8, padding: 12, height: "100%" }}
    >
      {/* Header */}
      <div ref={headerRef} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>{title}</h3>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button onClick={goPrev} title="Previous month" style={btnStyle}>◀</button>
          <button onClick={goToday} title="Current month" style={btnStyle}>Today</button>
          <button onClick={goNext} title="Next month" style={btnStyle}>▶</button>
        </div>
      </div>

      {/* Month name */}
      <div ref={monthRef} style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, textAlign: "center" }}>
        {monthLabel}
      </div>

      {/* Weekday header */}
      <div
        ref={daysHeadRef}
        style={{
          display: "grid",
          gridTemplateColumns: fitToContainer ? `repeat(7, ${cellPx}px)` : "repeat(7, 1fr)",
          gap: GAP,
          marginBottom: 6,
          fontSize: 11,
          color: "#64748b",
          textAlign: "center",
          justifyContent: "center",
        }}
      >
        {weekdayLabels.map(w => <div key={w}>{w}</div>)}
      </div>

      {/* Grid */}
      <div style={gridStyle}>
        {cells.map((c, i) => {
          if (!c.inMonth) return <div key={`x-${i}`} style={{ width: cellPx, height: cellPx }} />;

          const t = sizeFactor(c.totalKm);
          const dotSize = Math.max(minDotPx, Math.round(t * cellPx));
          const r = dotSize / 2;
          const cx = r, cy = r;

          const isToday = c.key === todayKey;
          const showLabel = dotSize >= labelMinPx && c.totalKm > 0;

          const oneSlice = c.slices.length === 1 ? c.slices[0] : null;
          const edgeCol = oneSlice ? COLORS[oneSlice.kind].edge : "#94a3b8";

          return (
            <button
              key={c.key}
              onClick={onDayClick ? () => onDayClick(c.key, c.totalKm, c.slices) : undefined}
              title={c.totalKm > 0 ? `${c.key} · ${c.totalKm.toFixed(1)} km` : `${c.key} · Rest`}
              style={outerCell(isToday, !!onDayClick, cellPx)}
              aria-label={c.totalKm > 0 ? `${c.totalKm.toFixed(1)} kilometres` : "Rest"}
            >
              {c.totalKm > 0 ? (
                <svg width={dotSize} height={dotSize} viewBox={`0 0 ${dotSize} ${dotSize}`} style={svgCentred}>
                  {/* subtle background for contrast */}
                  <circle cx={cx} cy={cy} r={r} fill="#ffffff" opacity="0.9" />

                  {oneSlice ? (
                    // FULL CIRCLE for single-activity days
                    <circle cx={cx} cy={cy} r={r} fill={COLORS[oneSlice.kind].fill} />
                  ) : (
                    // PIE SLICES for multi-activity days
                    (() => {
                      let acc = 0;
                      const total = c.slices.reduce((a, s) => a + s.km, 0) || 1;
                      return c.slices.map((s, idx) => {
                        const frac = s.km / total;
                        if (frac <= 0) return null;
                        const startDeg = acc * 360;
                        const endDeg = (acc + frac) * 360;
                        acc += frac;
                        return (
                          <path
                            key={idx}
                            d={arcPath(cx, cy, r, startDeg, endDeg)}
                            fill={COLORS[s.kind].fill}
                          />
                        );
                      });
                    })()
                  )}

                  {/* edge ring */}
                  <circle cx={cx} cy={cy} r={r - 0.5} fill="none" stroke={edgeCol} strokeWidth="1" />

                  {showLabel && (
                    <text
                      x={cx}
                      y={cy}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={Math.max(10, Math.round(dotSize * 0.32))}
                      fontWeight="700"
                      fill="#0f172a"
                    >
                      {c.totalKm.toFixed(1)}
                    </text>
                  )}
                </svg>
              ) : (
                <div style={restLabel}>Rest</div>
              )}
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div
        ref={legendRef}
        style={{
          marginTop: 8,
          display: "grid",
          gridTemplateColumns: "repeat(4, auto) 1fr",
          alignItems: "center",
          gap: 10,
          fontSize: 11,
          color: "#475569"
        }}
      >
        <LegendItem color={COLORS.walk.fill}    edge={COLORS.walk.edge} label={COLORS.walk.label} />
        <LegendItem color={COLORS.workout.fill} edge={COLORS.workout.edge} label={COLORS.workout.label} />
        <LegendItem color={COLORS.long.fill}    edge={COLORS.long.edge} label={COLORS.long.label} />
        <LegendItem color={COLORS.jog.fill}     edge={COLORS.jog.edge} label={COLORS.jog.label} />
        <div style={{ textAlign: "right", color: "#64748b" }}>Scale max: {scaleMaxKm.toFixed(1)} km</div>
      </div>
    </div>
  );
}

function LegendItem({ color, edge, label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{
        width: 12, height: 12, borderRadius: "50%",
        background: color, boxShadow: `inset 0 0 0 1px ${edge}`
      }} />
      <span>{label}</span>
    </div>
  );
}

const btnStyle = {
  padding: "4px 8px",
  border: "1px solid #e5e7eb",
  borderRadius: 6,
  background: "#fff",
  cursor: "pointer",
  fontSize: 12,
};

const outerCell = (isToday, clickable, cellPx) => ({
  position: "relative",
  width: cellPx,
  height: cellPx,
  background: "transparent",
  border: "none",
  padding: 0,
  cursor: clickable ? "pointer" : "default",
  outline: isToday ? "2px solid #a7f3d0" : "none",
  borderRadius: 10,
});

const svgCentred = {
  position: "absolute",
  left: "50%",
  top: "50%",
  transform: "translate(-50%, -50%)",
  display: "block",
};

const restLabel = {
  position: "absolute",
  left: "50%",
  top: "50%",
  transform: "translate(-50%, -50%)",
  fontSize: 12,
  color: "#94a3b8",
};
