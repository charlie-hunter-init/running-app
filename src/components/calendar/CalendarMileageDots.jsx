import React from "react";
import { TZ, dayKeyFromDate } from "../../lib/streak";

/**
 * CalendarMileageFill
 * Circle-only monthly calendar that auto-fits to its parent (no scroll).
 *
 * Props:
 * - features: GeoJSON Feature[] (expects properties.start_date, properties.distance or distance_m)
 * - timeZone: string (default TZ)
 * - type: string (filter activity type; default "Run"; set ""/null for all)
 * - startFromLatest: boolean (default true; opens to most recent month with data)
 * - maxKmForScale: number (optional fixed scale; else uses 95th percentile)
 * - onDayClick?: (dateKey, km) => void
 * - title?: string
 * - minDotPx?: number (minimum circle diameter; default 10)
 * - labelMinPx?: number (show numeric label when dot ≥ this px; default 18)
 * - fitToContainer?: boolean (default true; computes cell size to avoid scrolling)
 */
export default function CalendarMileageFill({
  features,
  timeZone = TZ,
  type = "Run",
  startFromLatest = true,
  maxKmForScale,
  onDayClick,
  title = "Mileage calendar",
  minDotPx = 10,
  labelMinPx = 18,
  fitToContainer = true,
}) {
  // ---- Aggregate km per day ----
  const { byDayKm, latestDate } = React.useMemo(() => {
    const m = new Map();
    let latest = null;
    for (const f of features || []) {
      const p = f?.properties || {};
      if (type && p.type !== type) continue;
      const iso = p.start_date;
      const distM = p.distance_m ?? p.distance ?? null;
      if (!iso || distM == null) continue;
      const d = new Date(iso);
      const key = dayKeyFromDate(d, timeZone);
      m.set(key, (m.get(key) || 0) + distM / 1000); // store km
      if (!latest || d > latest) latest = d;
    }
    return { byDayKm: m, latestDate: latest || new Date() };
  }, [features, timeZone, type]);

  // ---- Month state ----
  const initialAnchor = React.useMemo(() => {
    const base = startFromLatest ? latestDate : new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  }, [latestDate, startFromLatest]);

  const [monthAnchor, setMonthAnchor] = React.useState(initialAnchor);
  const goPrev = () => setMonthAnchor(d => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  const goNext = () => setMonthAnchor(d => new Date(d.getFullYear(), d.getMonth() + 1, 1));
  const goToday = () => setMonthAnchor(new Date(new Date().getFullYear(), new Date().getMonth(), 1));

  // ---- Build visible month cells (Mon–Sun) ----
  const { cells, monthLabel, kmValues, weeks } = React.useMemo(() => {
    const y = monthAnchor.getFullYear();
    const m = monthAnchor.getMonth();
    const first = new Date(y, m, 1);
    const last = new Date(y, m + 1, 0);
    const monthName = first.toLocaleDateString(undefined, { year: "numeric", month: "long" });

    const weekday = (day) => (day + 6) % 7; // Monday = 0
    const lead = weekday(first.getDay());
    const totalDays = last.getDate();
    const totalCells = Math.ceil((lead + totalDays) / 7) * 7;
    const weekCount = totalCells / 7;

    const arr = [];
    const observed = [];
    for (let i = 0; i < totalCells; i++) {
      const n = i - lead + 1;
      if (n < 1 || n > totalDays) {
        arr.push({ inMonth: false });
      } else {
        const d = new Date(y, m, n);
        const key = dayKeyFromDate(d, timeZone);
        const km = byDayKm.get(key) || 0;
        if (km > 0) observed.push(km);
        arr.push({ inMonth: true, key, km });
      }
    }
    return { cells: arr, monthLabel: monthName, kmValues: observed, weeks: weekCount };
  }, [monthAnchor, byDayKm, timeZone]);

  // ---- Scale for dot size (km -> 0..1) ----
  const scaleMaxKm = React.useMemo(() => {
    if (maxKmForScale != null) return Math.max(1, maxKmForScale);
    if (!kmValues.length) return 1;
    const sorted = [...kmValues].sort((a, b) => a - b);
    const idx = Math.floor(0.95 * (sorted.length - 1)); // 95th percentile to tame outliers
    return Math.max(1, sorted[idx]);
  }, [kmValues, maxKmForScale]);

  const tForKm = (km) => (!km || km <= 0) ? 0 : Math.min(1, km / scaleMaxKm);

  const weekdayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const todayKey = dayKeyFromDate(new Date(), timeZone);

  // ---- Auto-fit sizing ----
  const containerRef = React.useRef(null);
  const headerRef = React.useRef(null);   // title + nav
  const monthRef  = React.useRef(null);   // month name
  const daysHeadRef = React.useRef(null); // weekday labels
  const legendRef = React.useRef(null);

  const GAP = 10;               // grid gap (px)
  const SIDE_PAD = 12 * 2;      // card horizontal padding
  const [cellPx, setCellPx] = React.useState(44); // default guess

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
      const availableH = Math.max(
        0,
        box.height - headerH - monthH - daysH - legendH - 8 /* small margins */
      );
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

  // ---- Render ----
  return (
    <div
      ref={containerRef}
      style={{ background: "#fff", border: "1px solid #eee", borderRadius: 8, padding: 12, height: "100%" }}
    >
      {/* Header (title + nav) */}
      <div ref={headerRef} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>{title}</h3>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button onClick={goPrev} title="Previous month" style={btnStyle}>◀</button>
          <button onClick={goToday} title="Current month" style={btnStyle}>Today</button>
          <button onClick={goNext} title="Next month" style={btnStyle}>▶</button>
        </div>
      </div>

      {/* Month name */}
      <div
        ref={monthRef}
        style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, textAlign: "center" }}
      >
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

      {/* Grid (transparent cells; only circles or "Rest") */}
      <div style={gridStyle}>
        {cells.map((c, i) => {
          if (!c.inMonth) return <div key={`x-${i}`} style={{ width: cellPx, height: cellPx }} />;

          const t = tForKm(c.km); // 0..1
          const dotSize = Math.max(minDotPx, Math.round(t * cellPx)); // fills square at t=1
          const isToday = c.key === todayKey;
          const showLabel = dotSize >= labelMinPx && c.km > 0;

          return (
            <button
              key={c.key}
              onClick={onDayClick ? () => onDayClick(c.key, c.km) : undefined}
              title={c.km > 0 ? `${c.key} · ${c.km.toFixed(1)} km` : `${c.key} · Rest`}
              style={outerCell(isToday, !!onDayClick, cellPx)}
              aria-label={c.km > 0 ? `${c.km.toFixed(1)} kilometres` : "Rest"}
            >
              {c.km > 0 ? (
                <>
                  <div
                    style={{
                      ...dotBase,
                      width: dotSize,
                      height: dotSize,
                    }}
                  />
                  {showLabel && <div style={dotLabel}>{c.km.toFixed(1)}</div>}
                </>
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
        style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "#64748b" }}
      >
        <span>Less</span>
        <div style={{ ...legendDot, width: 10, height: 10 }} />
        <div style={{ ...legendDot, width: 16, height: 16 }} />
        <div style={{ ...legendDot, width: 22, height: 22 }} />
        <span>More</span>
        <span style={{ marginLeft: "auto" }}>Scale max: {scaleMaxKm.toFixed(1)} km</span>
      </div>
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
  outline: isToday ? "2px solid #a7f3d0" : "none", // subtle highlight for today
  borderRadius: 10,
});

const dotBase = {
  position: "absolute",
  left: "50%",
  top: "50%",
  transform: "translate(-50%, -50%)",
  borderRadius: "50%",
  background: "#34d399", // green
  boxShadow: "inset 0 0 0 1px #059669",
  transition: "width 120ms ease, height 120ms ease",
};

const dotLabel = {
  position: "absolute",
  left: "50%",
  top: "50%",
  transform: "translate(-50%, -50%)",
  fontSize: 12,
  fontWeight: 700,
  color: "#0f172a",
  pointerEvents: "none",
};

const restLabel = {
  position: "absolute",
  left: "50%",
  top: "50%",
  transform: "translate(-50%, -50%)",
  fontSize: 12,
  color: "#94a3b8",
};

const legendDot = {
  borderRadius: "50%",
  background: "#34d399",
  boxShadow: "inset 0 0 0 1px #059669",
};
