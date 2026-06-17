import React, { useState, useMemo, useCallback, useEffect } from "react";
import { MapContainer, TileLayer, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import ShoeOverrideEditor from "./ShoeOverrideEditor.jsx";
import { isWorkoutActivity, recalcByShoe, loadAllOverrides } from "../../lib/shoeOverrideApi.js";

// ---- helpers ----
function formatPace(secPerKm) {
  if (!secPerKm || !isFinite(secPerKm)) return "—";
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
function formatDuration(sec) {
  if (!sec) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
function formatDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" });
}
function FitBounds({ coords }) {
  const map = useMap();
  useEffect(() => {
    if (!coords || coords.length < 2) return;
    map.fitBounds(coords.map(([lng, lat]) => [lat, lng]), { padding: [30, 30] });
  }, [coords, map]);
  return null;
}

// Moving dot on map that interpolates GPS position from fractional km
function HoverDot({ coords, hoveredKm, cumDist }) {
  const map = useMap();
  const markerRef = React.useRef(null);

  useEffect(() => {
    if (!map || hoveredKm == null || !cumDist || cumDist.length < 2) {
      if (markerRef.current) { markerRef.current.remove(); markerRef.current = null; }
      return;
    }

    // Convert fractional km to meters along the route
    const targetM = hoveredKm * 1000;
    const totalM = cumDist[cumDist.length - 1];
    const clampedM = Math.max(0, Math.min(targetM, totalM));

    // Find the two coord indices that bracket this distance
    let idx = 0;
    for (let i = 1; i < cumDist.length; i++) {
      if (cumDist[i] >= clampedM) { idx = i - 1; break; }
      if (i === cumDist.length - 1) idx = i - 1;
    }

    const segLen = cumDist[idx + 1] - cumDist[idx];
    const t = segLen > 0 ? (clampedM - cumDist[idx]) / segLen : 0;

    const [lng1, lat1] = coords[idx];
    const [lng2, lat2] = coords[Math.min(idx + 1, coords.length - 1)];
    const lat = lat1 + (lat2 - lat1) * t;
    const lng = lng1 + (lng2 - lng1) * t;

    if (!markerRef.current) {
      markerRef.current = L.circleMarker([lat, lng], {
        radius: 7, color: "#3b82f6", fillColor: "#ffffff", fillOpacity: 1, weight: 3,
      }).addTo(map);
    } else {
      markerRef.current.setLatLng([lat, lng]);
    }

    return () => {};
  }, [map, coords, hoveredKm, cumDist]);

  // Cleanup on unmount
  useEffect(() => {
    return () => { if (markerRef.current) { markerRef.current.remove(); markerRef.current = null; } };
  }, []);

  return null;
}

// Zoom map to a km segment when clicked
function ZoomToKm({ segment }) {
  const map = useMap();
  useEffect(() => {
    if (!segment || segment.length < 2) return;
    const bounds = segment.map(([lng, lat]) => [lat, lng]);
    map.fitBounds(bounds, { padding: [60, 60], maxZoom: 17, animate: true });
  }, [segment, map]);
  return null;
}

// ---- SVG Line Chart ----
function LineChart({ title, splits, getValue, formatValue, color, invertY, hoveredKm, setHoveredKm, showZeroLine }) {
  const W = 600, H = 130;
  const PL = 48, PR = 16, PT = 12, PB = 24;
  const pW = W - PL - PR, pH = H - PT - PB;

  const values = splits.map(getValue);
  const valid = values.filter((v) => v != null);
  if (!valid.length) return null;

  let lo = Math.min(...valid), hi = Math.max(...valid);
  const span = hi - lo || 1;
  lo -= span * 0.08; hi += span * 0.08;
  if (showZeroLine) { lo = Math.min(lo, -span * 0.05); hi = Math.max(hi, span * 0.05); }
  const range = hi - lo || 1;

  const xPos = (i) => PL + (i / (splits.length - 1 || 1)) * pW;
  const yPos = (v) => {
    if (v == null) return PT + pH / 2;
    const n = (v - lo) / range;
    return invertY ? PT + n * pH : PT + (1 - n) * pH;
  };

  const pts = values.map((v, i) => v != null ? { x: xPos(i), y: yPos(v), i } : null).filter(Boolean);

  // Smooth catmull-rom to cubic bezier path
  function smoothPath(points) {
    if (points.length < 2) return "";
    if (points.length === 2) return `M${points[0].x},${points[0].y}L${points[1].x},${points[1].y}`;
    let d = `M${points[0].x},${points[0].y}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(i - 1, 0)];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[Math.min(i + 2, points.length - 1)];
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;
      d += `C${cp1x},${cp1y},${cp2x},${cp2y},${p2.x},${p2.y}`;
    }
    return d;
  }

  const line = smoothPath(pts);
  const area = pts.length > 1
    ? `${line}L${pts[pts.length - 1].x},${PT + pH}L${pts[0].x},${PT + pH}Z` : "";

  // Interpolate value at fractional position
  function interpValue(frac) {
    if (frac == null || pts.length < 2) return null;
    const idx = Math.floor(frac);
    const t = frac - idx;
    const v1 = values[idx];
    const v2 = values[Math.min(idx + 1, values.length - 1)];
    if (v1 == null || v2 == null) return v1 ?? v2;
    return v1 + (v2 - v1) * t;
  }

  // Mouse handler for continuous tracking
  const svgRef = React.useRef(null);
  const handleMouseMove = (e) => {
    const svg = svgRef.current;
    if (!svg) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const svgP = pt.matrixTransform(svg.getScreenCTM().inverse());
    const frac = ((svgP.x - PL) / pW) * (splits.length - 1);
    const clamped = Math.max(0, Math.min(splits.length - 1, frac));
    setHoveredKm(clamped);
  };

  const hoverX = hoveredKm != null ? xPos(hoveredKm) : null;
  const hoverVal = hoveredKm != null ? interpValue(hoveredKm) : null;
  const hoverY = hoverVal != null ? yPos(hoverVal) : null;

  return (
    <div style={s.chartCard}>
      <div style={s.chartLabel}>{title}</div>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 140, display: "block", cursor: "crosshair" }}
        onMouseMove={handleMouseMove} onMouseLeave={() => setHoveredKm(null)}>
        {/* subtle grid */}
        {[0, 0.5, 1].map((f) => (
          <line key={f} x1={PL} x2={PL + pW} y1={PT + f * pH} y2={PT + f * pH}
            stroke="rgba(255,255,255,0.04)" strokeWidth={0.5} />
        ))}
        {showZeroLine && <line x1={PL} x2={PL + pW} y1={yPos(0)} y2={yPos(0)}
          stroke="rgba(255,255,255,0.15)" strokeWidth={0.6} strokeDasharray="4,3" />}
        {/* fill */}
        {area && <path d={area} fill={color} opacity={0.08} />}
        {/* smooth line */}
        <path d={line} fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
        {/* km dots (small, static) */}
        {pts.map((p) => (
          <circle key={p.i} cx={p.x} cy={p.y} r={2} fill={color} opacity={0.5} />
        ))}
        {/* x labels */}
        {splits.map((_, i) => {
          const step = splits.length > 20 ? 5 : splits.length > 12 ? 2 : 1;
          if (i % step !== 0 && i !== splits.length - 1) return null;
          return <text key={i} x={xPos(i)} y={H - 4} textAnchor="middle" fontSize={8} fill="rgba(255,255,255,0.4)">{i + 1}</text>;
        })}
        {/* y labels */}
        {[0, 0.5, 1].map((f) => (
          <text key={f} x={PL - 6} y={PT + f * pH + 3} textAnchor="end" fontSize={8} fill="rgba(255,255,255,0.4)">
            {formatValue(invertY ? lo + f * range : hi - f * range)}
          </text>
        ))}
        {/* hover crosshair + dot + tooltip */}
        {hoverX != null && hoverVal != null && hoverY != null && (
          <g>
            <line x1={hoverX} x2={hoverX} y1={PT} y2={PT + pH}
              stroke="rgba(255,255,255,0.2)" strokeWidth={0.7} strokeDasharray="2,2" />
            <circle cx={hoverX} cy={hoverY} r={5} fill="#fff" stroke={color} strokeWidth={2} />
            <rect x={hoverX - 26} y={hoverY - 20} width={52} height={15}
              rx={3} fill="rgba(0,0,0,0.9)" stroke={color} strokeWidth={0.5} />
            <text x={hoverX} y={hoverY - 10} textAnchor="middle"
              fontSize={8.5} fontWeight={700} fill="#fff">{formatValue(hoverVal)}</text>
          </g>
        )}
      </svg>
    </div>
  );
}

// ---- SVG Icons ----
const Icons = {
  distance: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6L6 18" /><path d="M8 6h10v10" />
    </svg>
  ),
  time: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  pace: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  ),
  heart: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  ),
  flame: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 12c2-2.96 0-7-1-8 0 3.038-1.773 4.741-3 6-1.226 1.26-2 3.24-2 5a6 6 0 1 0 12 0c0-1.532-1.056-3.94-2-5-1.786 3-2.791 3-4 2z" />
    </svg>
  ),
  mountain: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3l4 8 5-5 5 15H2L8 3z" />
    </svg>
  ),
};

// ---- Stat pill ----
function Stat({ label, value, icon }) {
  return (
    <div style={s.stat}>
      <span style={s.statIcon}>{icon}</span>
      <div style={s.statValue}>{value}</div>
      <div style={s.statLabel}>{label}</div>
    </div>
  );
}

// ---- Combined Chart: pace + HR lines with elevation profile underneath ----
function CombinedChart({ splits, streams, hoveredKm, setHoveredKm, showPace, setShowPace, showHr, setShowHr }) {
  const W = 1000, H_MAIN = 200, H_ELEV = 60, GAP = 4;
  const H = H_MAIN + GAP + H_ELEV;
  const PL = 40, PR = 40, PT = 10, PB = 20;
  const pW = W - PL - PR;
  const mainH = H_MAIN - PT - 6; // plot area for lines
  const elevTop = H_MAIN + GAP;

  const hasHr = streams?.heartrate?.length > 0 || splits.some((sp) => sp.average_heartrate);

  // ---- Determine whether to use granular streams or per-km splits ----
  const useStreams = !!(streams && streams.velocity_smooth && streams.distance && streams.velocity_smooth.length > 0);
  const maxPoints = 300;

  // Downsampled stream data
  const { streamDistKm, streamPacePoints, streamHrPoints, streamElevPoints } = useMemo(() => {
    if (!useStreams) return { streamDistKm: [], streamPacePoints: [], streamHrPoints: [], streamElevPoints: [] };
    const total = streams.velocity_smooth.length;
    const step = Math.max(1, Math.floor(total / maxPoints));
    const distKm = [], paceP = [], hrP = [], elevP = [];
    for (let i = 0; i < total; i += step) {
      const vel = streams.velocity_smooth[i];
      const dist = streams.distance[i] / 1000; // km
      const pace = vel > 0.3 ? 1000 / vel : null; // sec/km, filter out near-zero (stopped)
      distKm.push(dist);
      paceP.push(pace);
      hrP.push(streams.heartrate ? (streams.heartrate[i] || null) : null);
      elevP.push(streams.altitude ? (streams.altitude[i] || 0) : 0);
    }
    return { streamDistKm: distKm, streamPacePoints: paceP, streamHrPoints: hrP, streamElevPoints: elevP };
  }, [useStreams, streams]);

  const maxDist = useStreams ? streamDistKm[streamDistKm.length - 1] || 1 : splits.length;

  // Pace values — from streams or splits
  const paceVals = useStreams ? streamPacePoints : splits.map((sp) => sp.distance && sp.moving_time ? sp.moving_time / (sp.distance / 1000) : null);
  const validPace = paceVals.filter((v) => v != null);
  // Fixed pace range: 2:30/km (150s) to 6:00/km (360s)
  let pLo = 150; // 2:30 min/km
  let pHi = 360; // 6:00 min/km
  const pRange = pHi - pLo;

  // HR values — from streams or splits
  const hrVals = useStreams ? streamHrPoints : splits.map((sp) => sp.average_heartrate || null);
  const validHr = hrVals.filter((v) => v != null);
  // Fixed HR range: 50-230 bpm
  let hLo = 50;
  let hHi = 230;
  const hRange = hHi - hLo;

  // Elevation values
  let cumElev;
  if (useStreams) {
    // Use raw altitude stream (already absolute elevation)
    cumElev = streamElevPoints;
  } else {
    const elevVals = splits.map((sp) => sp.elevation_difference ?? 0);
    cumElev = [0];
    for (let i = 0; i < elevVals.length; i++) cumElev.push(cumElev[i] + elevVals[i]);
  }
  const eLo = Math.min(...cumElev), eHi = Math.max(...cumElev);
  const eRange = eHi - eLo || 1;

  // X position: distance-based for streams, index-based for splits
  const xPos = useStreams
    ? (i) => PL + (streamDistKm[i] / maxDist) * pW
    : (i) => PL + (i / (splits.length - 1 || 1)) * pW;

  // Y positions for main chart (pace is inverted — lower pace = higher on chart)
  const paceY = (v) => v == null ? PT + mainH / 2 : PT + ((v - pLo) / pRange) * mainH;
  const hrY = (v) => v == null ? PT + mainH / 2 : PT + (1 - (v - hLo) / hRange) * mainH;

  // Elevation Y (bottom section)
  const elevY = (v) => elevTop + H_ELEV - 4 - ((v - eLo) / eRange) * (H_ELEV - 8);

  // Smooth path helper
  function smooth(points) {
    if (points.length < 2) return "";
    if (points.length === 2) return `M${points[0].x},${points[0].y}L${points[1].x},${points[1].y}`;
    let d = `M${points[0].x},${points[0].y}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(i - 1, 0)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(i + 2, points.length - 1)];
      d += `C${p1.x + (p2.x - p0.x) / 6},${p1.y + (p2.y - p0.y) / 6},${p2.x - (p3.x - p1.x) / 6},${p2.y - (p3.y - p1.y) / 6},${p2.x},${p2.y}`;
    }
    return d;
  }

  // Build point arrays for lines
  const pacePts = paceVals.map((v, i) => v != null ? { x: xPos(i), y: paceY(v) } : null).filter(Boolean);
  const hrPts = hrVals.map((v, i) => v != null ? { x: xPos(i), y: hrY(v) } : null).filter(Boolean);

  // Elevation points
  let elevPtsFixed;
  if (useStreams) {
    elevPtsFixed = cumElev.map((v, i) => ({ x: xPos(i), y: elevY(v) }));
  } else {
    elevPtsFixed = cumElev.map((v, i) => ({ x: PL + (i / (cumElev.length - 1 || 1)) * pW, y: elevY(v) }));
  }

  const paceLine = showPace ? smooth(pacePts) : "";
  const hrLine = (showHr && hasHr) ? smooth(hrPts) : "";

  // Elevation area fill
  const elevPath = elevPtsFixed.length > 1
    ? smooth(elevPtsFixed) + `L${elevPtsFixed[elevPtsFixed.length - 1].x},${elevTop + H_ELEV}L${elevPtsFixed[0].x},${elevTop + H_ELEV}Z`
    : "";

  // Interpolate for hover
  function interp(vals, frac) {
    const idx = Math.floor(frac), t = frac - idx;
    const v1 = vals[idx], v2 = vals[Math.min(idx + 1, vals.length - 1)];
    if (v1 == null || v2 == null) return v1 ?? v2;
    return v1 + (v2 - v1) * t;
  }

  const svgRef = React.useRef(null);
  const handleMouseMove = (e) => {
    const svg = svgRef.current;
    if (!svg) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const svgP = pt.matrixTransform(svg.getScreenCTM().inverse());

    if (useStreams) {
      // Map pixel x to distance in km, then report as fractional km for HoverDot
      const distFrac = (svgP.x - PL) / pW;
      const distKm = distFrac * maxDist;
      setHoveredKm(Math.max(0, Math.min(maxDist, distKm)));
    } else {
      const frac = ((svgP.x - PL) / pW) * (splits.length - 1);
      setHoveredKm(Math.max(0, Math.min(splits.length - 1, frac)));
    }
  };

  // Find hover index in stream arrays by distance
  const hoverStreamIdx = useMemo(() => {
    if (!useStreams || hoveredKm == null) return null;
    // hoveredKm is km distance when in stream mode
    // Binary search for closest index
    let lo = 0, hi = streamDistKm.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (streamDistKm[mid] < hoveredKm) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }, [useStreams, hoveredKm, streamDistKm]);

  const hoverX = hoveredKm != null
    ? useStreams
      ? PL + (hoveredKm / maxDist) * pW
      : xPos(hoveredKm)
    : null;

  // Interpolate values at hover position
  let hoverPace = null, hoverHr = null;
  if (hoveredKm != null) {
    if (useStreams && hoverStreamIdx != null) {
      hoverPace = showPace ? paceVals[hoverStreamIdx] : null;
      hoverHr = (showHr && hasHr) ? hrVals[hoverStreamIdx] : null;
    } else if (!useStreams) {
      hoverPace = showPace ? interp(paceVals, hoveredKm) : null;
      hoverHr = (showHr && hasHr) ? interp(hrVals, hoveredKm) : null;
    }
  }

  const hoverDist = hoveredKm != null ? hoveredKm.toFixed(1) : null;

  // Cumulative time up to the hovered position
  const hoverElapsedTime = useMemo(() => {
    if (hoveredKm == null) return null;
    if (useStreams && streams.time) {
      // Use actual time stream - find index closest to hoveredKm distance
      if (hoverStreamIdx != null && hoverStreamIdx < streams.time.length) {
        // hoverStreamIdx is in downsampled space, map back to original
        const total = streams.velocity_smooth.length;
        const step = Math.max(1, Math.floor(total / maxPoints));
        const origIdx = Math.min(hoverStreamIdx * step, total - 1);
        return streams.time[origIdx];
      }
      return null;
    }
    if (!splits.length) return null;
    const fullKms = Math.floor(hoveredKm);
    let total = 0;
    for (let i = 0; i < fullKms && i < splits.length; i++) {
      total += splits[i].moving_time || 0;
    }
    const frac = hoveredKm - fullKms;
    if (fullKms < splits.length) {
      total += (splits[fullKms].moving_time || 0) * frac;
    }
    return Math.round(total);
  }, [hoveredKm, splits, useStreams, streams, hoverStreamIdx]);

  // Tooltip X position as percentage
  const tooltipPct = hoveredKm != null
    ? useStreams ? (hoveredKm / maxDist) * 100 : (hoveredKm / (splits.length - 1 || 1)) * 100
    : 0;

  // X-axis km markers
  const xAxisLabels = useMemo(() => {
    if (useStreams) {
      const totalKm = Math.ceil(maxDist);
      const step = totalKm > 20 ? 5 : totalKm > 12 ? 2 : 1;
      const labels = [];
      for (let k = step; k <= totalKm; k += step) {
        labels.push({ km: k, x: PL + (k / maxDist) * pW });
      }
      return labels;
    }
    return splits.map((_, i) => {
      const step = splits.length > 20 ? 5 : splits.length > 12 ? 2 : 1;
      if (i % step !== 0 && i !== splits.length - 1) return null;
      return { km: i + 1, x: xPos(i) };
    }).filter(Boolean);
  }, [useStreams, maxDist, splits, pW, PL]);

  return (
    <div style={{ ...s.chartCard, position: "relative" }}>
      {/* Toggle buttons */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <button onClick={() => setShowPace(!showPace)}
          style={{ ...toggleStyle, borderColor: showPace ? "#3b82f6" : "rgba(255,255,255,0.1)", color: showPace ? "#3b82f6" : "rgba(255,255,255,0.4)" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: showPace ? "#3b82f6" : "rgba(255,255,255,0.2)", display: "inline-block", marginRight: 4 }} />
          Pace
        </button>
        {hasHr && (
          <button onClick={() => setShowHr(!showHr)}
            style={{ ...toggleStyle, borderColor: showHr ? "#ef4444" : "rgba(255,255,255,0.1)", color: showHr ? "#ef4444" : "rgba(255,255,255,0.4)" }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: showHr ? "#ef4444" : "rgba(255,255,255,0.2)", display: "inline-block", marginRight: 4 }} />
            Heart Rate
          </button>
        )}
      </div>

      {/* Floating tooltip */}
      {hoveredKm != null && (hoverPace != null || hoverHr != null) && (
        <div style={{
          position: "absolute",
          top: 6,
          left: `clamp(120px, calc(${tooltipPct}% + 30px), calc(100% - 180px))`,
          background: "rgba(15,17,25,0.95)",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 8,
          padding: "8px 12px",
          display: "flex",
          gap: 14,
          zIndex: 10,
          backdropFilter: "blur(8px)",
          pointerEvents: "none",
        }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 9, opacity: 0.5, color: "var(--text, #e5e7eb)" }}>Km</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text, #e5e7eb)" }}>{hoverDist}</div>
          </div>
          {hoverPace != null && showPace && (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 9, color: "#3b82f6" }}>Pace</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#3b82f6" }}>{formatPace(hoverPace)}</div>
            </div>
          )}
          {hoverHr != null && showHr && (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 9, color: "#ef4444" }}>HR</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#ef4444" }}>{Math.round(hoverHr)} bpm</div>
            </div>
          )}
          {hoverElapsedTime != null && (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 9, opacity: 0.5, color: "var(--text, #e5e7eb)" }}>Time</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text, #e5e7eb)" }}>{formatDuration(hoverElapsedTime)}</div>
            </div>
          )}
        </div>
      )}

      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 280, display: "block", cursor: "crosshair" }}
        onMouseMove={handleMouseMove} onMouseLeave={() => setHoveredKm(null)}>

        {/* grid */}
        {[0, 0.5, 1].map((f) => (
          <line key={f} x1={PL} x2={PL + pW} y1={PT + f * mainH} y2={PT + f * mainH}
            stroke="rgba(255,255,255,0.04)" strokeWidth={0.5} />
        ))}

        {/* elevation terrain fill */}
        {elevPath && <path d={elevPath} fill="rgba(16,185,129,0.15)" stroke="rgba(16,185,129,0.4)" strokeWidth={1} />}

        {/* pace line */}
        {paceLine && <path d={paceLine} fill="none" stroke="#3b82f6" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" opacity={showPace ? 1 : 0} />}

        {/* hr line */}
        {hrLine && <path d={hrLine} fill="none" stroke="#ef4444" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" opacity={showHr ? 1 : 0} />}

        {/* small dots on km points — only for splits mode */}
        {!useStreams && showPace && pacePts.map((p, i) => <circle key={`p${i}`} cx={p.x} cy={p.y} r={1.5} fill="#3b82f6" opacity={0.5} />)}
        {!useStreams && showHr && hasHr && hrPts.map((p, i) => <circle key={`h${i}`} cx={p.x} cy={p.y} r={1.5} fill="#ef4444" opacity={0.5} />)}

        {/* x-axis labels */}
        {xAxisLabels.map((lbl) => (
          <text key={lbl.km} x={lbl.x} y={H - 2} textAnchor="middle" fontSize={8} fill="rgba(255,255,255,0.4)">{lbl.km}km</text>
        ))}

        {/* pace y-axis (left) */}
        {showPace && [0, 0.5, 1].map((f) => (
          <text key={`py${f}`} x={PL - 6} y={PT + f * mainH + 3} textAnchor="end" fontSize={8} fill="rgba(59,130,246,0.6)">
            {formatPace(pLo + f * pRange)}
          </text>
        ))}

        {/* hr y-axis (right) */}
        {showHr && hasHr && [0, 0.5, 1].map((f) => (
          <text key={`hy${f}`} x={PL + pW + 6} y={PT + (1 - f) * mainH + 3} textAnchor="start" fontSize={8} fill="rgba(239,68,68,0.6)">
            {Math.round(hLo + f * hRange)}
          </text>
        ))}

        {/* hover crosshair + dots */}
        {hoverX != null && (
          <g>
            <line x1={hoverX} x2={hoverX} y1={PT} y2={elevTop + H_ELEV}
              stroke="rgba(255,255,255,0.15)" strokeWidth={0.5} />
            {hoverPace != null && showPace && (
              <circle cx={hoverX} cy={paceY(hoverPace)} r={4} fill="#3b82f6" stroke="#fff" strokeWidth={1.5} />
            )}
            {hoverHr != null && showHr && (
              <circle cx={hoverX} cy={hrY(hoverHr)} r={4} fill="#ef4444" stroke="#fff" strokeWidth={1.5} />
            )}
          </g>
        )}
      </svg>
    </div>
  );
}

const toggleStyle = {
  padding: "4px 10px", borderRadius: 5, fontSize: 10, fontWeight: 600,
  border: "1px solid rgba(255,255,255,0.1)", background: "transparent",
  cursor: "pointer", display: "flex", alignItems: "center",
};

// ---- Memoized run list to avoid re-renders on hover ----
const RunList = React.memo(function RunList({ items, selectedId, onSelect }) {
  return (
    <>
      {items.map((it) => {
        const id = String(it.id), active = id === selectedId;
        const paceStr = it.average_speed ? formatPace(1000 / it.average_speed) : "";
        return (
          <button key={id} onClick={() => onSelect(it.id)}
            style={{ ...s.runBtn, ...(active ? s.runBtnActive : {}) }}>
            <div style={s.runBtnName}>{it.name || "Run"}</div>
            <div style={s.runBtnSub}>
              {formatDate(it.start_date)} · {(it.distance / 1000).toFixed(1)}km · {paceStr}
            </div>
          </button>
        );
      })}
    </>
  );
});

const MAP_TILES = {
  dark: { url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", label: "Dark", lineColor: "#ffffff" },
  light: { url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", label: "Light", lineColor: "#1e40af" },
  satellite: { url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", label: "Satellite", lineColor: "#ffffff" },
};

// ---- main ----
export default function BreakDownView({ items, idToFeature, stats, setStats }) {
  const [selectedId, setSelectedId] = useState(null);
  const [splitsData, setSplitsData] = useState(null);
  const [splitsLoading, setSplitsLoading] = useState(false);
  const [hoveredKm, setHoveredKm] = useState(null);

  // Throttle hoveredKm updates to one per animation frame
  const rafRef = React.useRef(null);
  const setHoveredKmThrottled = useCallback((val) => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => setHoveredKm(val));
  }, []);
  const [searchText, setSearchText] = useState("");
  const [filter, setFilter] = useState("all");
  const [mapStyle, setMapStyle] = useState("dark");
  const [showPace, setShowPace] = useState(true);
  const [showHr, setShowHr] = useState(true);

  const runList = useMemo(() =>
    (items || []).filter((it) => it.has_map && it.distance > 500 && it.type === "Run").slice(0, 2000),
  [items]);

  // Derive unique shoe list from all items for the override dropdown
  const shoeList = useMemo(() => {
    const seen = new Map();
    for (const it of (items || [])) {
      const name = it.shoe_name || it.gear_name;
      if (name && !seen.has(name)) {
        seen.set(name, { name, gearId: it.gear_id || null });
      }
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [items]);

  const filteredRunList = useMemo(() => {
    let list = runList;
    // Apply category filter
    if (filter === "long") {
      list = list.filter((it) => it.distance >= 18000);
    } else if (filter === "workout") {
      list = list.filter((it) => {
        // Include WO-named activities or fast pace activities
        const isWO = it.name && (it.name.includes("WO") || it.name.includes("Workout") || it.name.includes("Session"));
        if (isWO) return true;
        const secPerKm = it.average_speed ? 1000 / it.average_speed : null;
        return secPerKm != null && secPerKm < 250; // faster than 4:10/km
      });
    }
    // Apply search text
    if (searchText.trim()) {
      const q = searchText.toLowerCase();
      list = list.filter((it) =>
        (it.name || "").toLowerCase().includes(q) || (it.start_date || "").includes(q)
      );
    }
    return list;
  }, [runList, searchText, filter]);

  const selectedItem = useMemo(() => runList.find((it) => String(it.id) === selectedId) || null, [runList, selectedId]);
  const selectedFeature = useMemo(() => selectedId ? idToFeature?.get(selectedId) || null : null, [selectedId, idToFeature]);

  const coords = useMemo(() => {
    const g = selectedFeature?.geometry;
    if (!g) return [];
    return g.type === "LineString" ? g.coordinates : g.type === "MultiLineString" ? g.coordinates.flat() : [];
  }, [selectedFeature]);

  const loadSplits = useCallback(async (id) => {
    setSplitsLoading(true); setSplitsData(null);
    try {
      const res = await fetch(`/splits/${id}.json`);
      if (!res.ok) throw new Error();
      setSplitsData(await res.json());
    } catch { setSplitsData(null); }
    finally { setSplitsLoading(false); }
  }, []);

  const handleSelect = useCallback((id) => {
    const key = String(id);
    setSelectedId(key); setHoveredKm(null); setClickedKm(null); loadSplits(key);
  }, [loadSplits]);

  // After an override is saved/deleted, recalculate byShoe and update stats
  const handleOverrideChange = useCallback(async () => {
    try {
      const allOverrides = await loadAllOverrides();
      const newByShoe = recalcByShoe(items || [], allOverrides);
      setStats((prev) => prev ? { ...prev, byShoe: newByShoe } : prev);
    } catch (err) {
      console.error("Failed to recalculate shoe stats:", err);
    }
  }, [items, setStats]);

  const splits = splitsData?.splits || [];
  const [clickedKm, setClickedKm] = useState(null);

  // Compute cumulative distance along the route
  const cumDist = useMemo(() => {
    if (!coords.length) return [];
    const cum = [0];
    for (let i = 1; i < coords.length; i++) {
      const [x1, y1] = coords[i - 1], [x2, y2] = coords[i];
      const R = 6371000, dLat = (y2 - y1) * Math.PI / 180, dLng = (x2 - x1) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(y1 * Math.PI / 180) * Math.cos(y2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
      cum.push(cum[i - 1] + R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
    }
    return cum;
  }, [coords]);

  // Km segment coords for clicked km highlight
  const kmSegments = useMemo(() => {
    if (!coords.length || !cumDist.length || !splits.length) return [];
    const totalM = cumDist[cumDist.length - 1];
    const segs = [];
    for (let k = 0; k < splits.length; k++) {
      const from = k * 1000, to = Math.min((k + 1) * 1000, totalM);
      segs.push(coords.filter((_, i) => cumDist[i] >= from && cumDist[i] <= to));
    }
    return segs;
  }, [coords, cumDist, splits]);

  const avgPace = selectedItem ? selectedItem.moving_time / (selectedItem.distance / 1000) : null;

  return (
    <div style={s.container}>
      {/* sidebar */}
      <div style={s.sidebar}>
        <div style={s.sidebarHead}>
          <div style={s.sidebarTitle}>Break Down</div>
          <input type="text" placeholder="Search..." value={searchText}
            onChange={(e) => setSearchText(e.target.value)} style={s.search} />
          <div style={{ display: "flex", gap: 4, marginTop: 8 }}>
            {[
              { id: "all", label: "All" },
              { id: "long", label: "Long (18km+)" },
              { id: "workout", label: "Workout" },
            ].map((f) => (
              <button key={f.id} onClick={() => setFilter(f.id)}
                style={{
                  flex: 1, padding: "5px 0", borderRadius: 5, fontSize: 10, fontWeight: 600,
                  border: "1px solid " + (filter === f.id ? "rgba(59,130,246,0.5)" : "rgba(255,255,255,0.08)"),
                  background: filter === f.id ? "rgba(59,130,246,0.15)" : "rgba(255,255,255,0.03)",
                  color: filter === f.id ? "#93c5fd" : "var(--text, #e5e7eb)",
                  cursor: "pointer",
                }}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <div style={s.sidebarScroll}>
          <RunList items={filteredRunList} selectedId={selectedId} onSelect={handleSelect} />
        </div>
      </div>

      {/* main panel */}
      <div style={s.main}>
        {!selectedId && (
          <div style={s.empty}><span style={{ opacity: 0.5 }}>Select a run to view its breakdown</span></div>
        )}
        {selectedId && selectedItem && (
          <div style={s.scroll}>
            {/* header + stats in one row */}
            <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
              <div style={{ flex: "0 0 auto" }}>
                <h2 style={s.title}>{selectedItem.name || "Run"}</h2>
                <div style={s.subtitle}>{formatDate(selectedItem.start_date)}</div>
              </div>
              <div style={s.statsRow}>
                <Stat icon={Icons.distance} label="Distance" value={`${(selectedItem.distance / 1000).toFixed(2)} km`} />
                <Stat icon={Icons.time} label="Time" value={formatDuration(selectedItem.moving_time)} />
                <Stat icon={Icons.pace} label="Pace" value={avgPace ? `${formatPace(avgPace)}/km` : "—"} />
                {splitsData?.average_heartrate && (
                  <Stat icon={Icons.heart} label="Avg HR" value={`${Math.round(splitsData.average_heartrate)} bpm`} />
                )}
                {splitsData?.calories && (
                  <Stat icon={Icons.flame} label="Calories" value={splitsData.calories} />
                )}
                {selectedItem.total_elevation_gain != null && (
                  <Stat icon={Icons.mountain} label="Elevation" value={`${Math.round(selectedItem.total_elevation_gain)}m`} />
                )}
              </div>
            </div>

            {/* shoe override editor for workout activities */}
            {isWorkoutActivity(selectedItem.name) && (
              <ShoeOverrideEditor
                key={selectedId}
                activityId={selectedId}
                activityName={selectedItem.name}
                totalDistanceM={selectedItem.distance}
                stravaShoe={selectedItem.shoe_name ? { name: selectedItem.shoe_name, gearId: selectedItem.gear_id || null } : null}
                shoeList={shoeList}
                onOverrideChange={handleOverrideChange}
              />
            )}

            {/* map + splits side by side */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              {/* map */}
              {coords.length > 1 && (
                <div style={{ ...s.mapBox, height: 380, aspectRatio: "1", position: "relative" }}>
                  {/* map style toggle */}
                  <div style={{ position: "absolute", top: 10, right: 10, zIndex: 1000, display: "flex", gap: 3 }}>
                    {Object.entries(MAP_TILES).map(([key, tile]) => (
                      <button key={key} onClick={() => setMapStyle(key)}
                        style={{
                          padding: "4px 8px", borderRadius: 4, fontSize: 9, fontWeight: 600,
                          border: "1px solid " + (mapStyle === key ? "rgba(59,130,246,0.6)" : "rgba(0,0,0,0.3)"),
                          background: mapStyle === key ? "rgba(59,130,246,0.3)" : "rgba(0,0,0,0.6)",
                          color: "#fff", cursor: "pointer", backdropFilter: "blur(4px)",
                        }}>
                        {tile.label}
                      </button>
                    ))}
                  </div>
                  <MapContainer center={[coords[0][1], coords[0][0]]} zoom={14}
                    style={{ width: "100%", height: "100%", borderRadius: 12 }}
                    scrollWheelZoom={true} zoomControl={false}>
                    <TileLayer key={mapStyle} url={MAP_TILES[mapStyle].url} attribution="" />
                    <FitBounds coords={coords} />
                    <Polyline positions={coords.map(([x, y]) => [y, x])} pathOptions={{ color: MAP_TILES[mapStyle].lineColor, weight: 3, opacity: 1 }} />
                    {clickedKm != null && kmSegments[clickedKm] && (
                      <>
                        <Polyline positions={kmSegments[clickedKm].map(([x, y]) => [y, x])}
                          pathOptions={{ color: "#3b82f6", weight: 6, opacity: 1 }} />
                        <ZoomToKm segment={kmSegments[clickedKm]} />
                      </>
                    )}
                    {hoveredKm !== null && <HoverDot coords={coords} hoveredKm={hoveredKm} cumDist={cumDist} />}
                  </MapContainer>
                </div>
              )}

              {/* splits table */}
              {!splitsLoading && splits.length > 0 && (
                <div style={{ ...s.tableCard, maxHeight: 380, overflowY: "auto" }}>
                  <div style={s.tableTitle}>Splits</div>
                  <table style={s.table}>
                    <thead><tr>
                      <th style={s.th}>Km</th><th style={s.th}>Time</th><th style={s.th}>Pace</th>
                      <th style={s.th}>HR</th><th style={s.th}>Elev</th>
                    </tr></thead>
                    <tbody>
                      {splits.map((sp, i) => {
                        const pace = sp.distance && sp.moving_time ? sp.moving_time / (sp.distance / 1000) : null;
                        return (
                          <tr key={i} onMouseEnter={() => setHoveredKmThrottled(i)} onMouseLeave={() => setHoveredKm(null)}
                            onClick={() => setClickedKm(clickedKm === i ? null : i)}
                            style={{
                              background: clickedKm === i ? "rgba(59,130,246,0.2)" : hoveredKm != null && Math.round(hoveredKm) === i ? "rgba(59,130,246,0.1)" : "transparent",
                              cursor: "pointer",
                              fontWeight: clickedKm === i ? 700 : 400,
                            }}>
                            <td style={s.td}>{sp.split || i + 1}</td>
                            <td style={s.td}>{formatDuration(sp.moving_time)}</td>
                            <td style={{ ...s.td, fontWeight: 600 }}>{pace ? formatPace(pace) : "—"}</td>
                            <td style={s.td}>{sp.average_heartrate ? Math.round(sp.average_heartrate) : "—"}</td>
                            <td style={s.td}>{sp.elevation_difference != null ? `${sp.elevation_difference >= 0 ? "+" : ""}${Math.round(sp.elevation_difference)}m` : "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* combined chart */}
            {splitsLoading && <div style={s.loadingText}>Loading...</div>}
            {!splitsLoading && splits.length > 0 && (
              <CombinedChart splits={splits} streams={splitsData?.streams} hoveredKm={hoveredKm} setHoveredKm={setHoveredKmThrottled}
                showPace={showPace} setShowPace={setShowPace}
                showHr={showHr} setShowHr={setShowHr} />
            )}

            {/* best efforts */}
            {splitsData?.best_efforts?.length > 0 && (
              <div style={s.tableCard}>
                <div style={s.tableTitle}>Best Efforts</div>
                <table style={s.table}>
                  <thead><tr>
                    <th style={s.th}>Segment</th><th style={s.th}>Time</th><th style={s.th}>Pace</th><th style={s.th}>PR</th>
                  </tr></thead>
                  <tbody>
                    {splitsData.best_efforts.map((ef, i) => {
                      const pace = ef.distance && ef.moving_time ? ef.moving_time / (ef.distance / 1000) : null;
                      return (
                        <tr key={i}>
                          <td style={s.td}>{ef.name || "—"}</td>
                          <td style={s.td}>{formatDuration(ef.moving_time || ef.elapsed_time)}</td>
                          <td style={{ ...s.td, fontWeight: 600 }}>{pace ? formatPace(pace) : "—"}</td>
                          <td style={s.td}>{ef.pr_rank === 1 ? "🥇" : ef.pr_rank === 2 ? "🥈" : ef.pr_rank === 3 ? "🥉" : ""}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {!splitsLoading && !splits.length && (
              <div style={s.loadingText}>No split data available for this run.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---- styles ----
const s = {
  container: { display: "grid", gridTemplateColumns: "280px 1fr", height: "100%", overflow: "hidden", background: "var(--bg, #0a0c14)" },
  // sidebar
  sidebar: { display: "flex", flexDirection: "column", background: "var(--card-bg, rgba(15,18,30,0.98))", borderRight: "1px solid var(--border, rgba(255,255,255,0.08))", minHeight: 0 },
  sidebarHead: { padding: "16px 14px 12px", borderBottom: "1px solid var(--border, rgba(255,255,255,0.06))" },
  sidebarTitle: { fontSize: 15, fontWeight: 800, color: "var(--text, #f1f5f9)", marginBottom: 10 },
  search: { width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border, rgba(255,255,255,0.1))", background: "var(--input-bg, rgba(255,255,255,0.05))", color: "var(--text, #f1f5f9)", fontSize: 12, outline: "none", boxSizing: "border-box" },
  sidebarScroll: { flex: 1, overflowY: "auto", padding: "8px 10px", display: "flex", flexDirection: "column", gap: 3 },
  runBtn: { display: "block", width: "100%", textAlign: "left", padding: "10px 12px", borderRadius: 8, border: "1px solid transparent", cursor: "pointer", color: "var(--text, #f1f5f9)", background: "transparent", transition: "all 0.12s" },
  runBtnActive: { background: "rgba(59,130,246,0.1)", borderColor: "rgba(59,130,246,0.35)" },
  runBtnName: { fontWeight: 700, fontSize: 12.5, marginBottom: 2 },
  runBtnSub: { fontSize: 10.5, opacity: 0.5 },
  // main
  main: { display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden", background: "var(--bg, #0a0c14)" },
  empty: { display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text, #f1f5f9)", fontSize: 15 },
  scroll: { flex: 1, overflowY: "auto", padding: "24px 32px 48px", display: "flex", flexDirection: "column", gap: 18 },
  // header
  header: { marginBottom: 0 },
  title: { margin: 0, fontSize: 20, fontWeight: 800, color: "var(--text, #e5e7eb)" },
  subtitle: { fontSize: 12, opacity: 0.5, marginTop: 2, color: "var(--text, #e5e7eb)" },
  // stats
  statsRow: { display: "flex", gap: 10, flexWrap: "wrap", flex: 1 },
  stat: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "rgba(30,35,55,0.7)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "14px 18px", minWidth: 80 },
  statIcon: { color: "rgba(148,163,184,0.9)", marginBottom: 4, display: "flex" },
  statValue: { fontSize: 16, fontWeight: 800, color: "var(--text, #f1f5f9)", textAlign: "center" },
  statLabel: { fontSize: 9, opacity: 0.5, color: "var(--text, #f1f5f9)", marginTop: 2, textAlign: "center" },
  // map
  mapBox: { width: "100%", height: 240, borderRadius: 12, overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)" },
  // charts
  chartCard: { background: "rgba(15,18,30,0.9)", borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", padding: "12px 12px 6px" },
  chartLabel: { fontSize: 11, fontWeight: 700, opacity: 0.7, marginBottom: 4, color: "var(--text, #f1f5f9)" },
  // table
  tableCard: { background: "rgba(15,18,30,0.9)", borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", padding: "14px 16px", overflowX: "auto" },
  tableTitle: { fontSize: 12, fontWeight: 700, opacity: 0.7, marginBottom: 8, color: "var(--text, #f1f5f9)" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 11.5, color: "var(--text, #f1f5f9)" },
  th: { padding: "7px 10px", textAlign: "left", fontWeight: 600, fontSize: 10, opacity: 0.5, borderBottom: "1px solid rgba(255,255,255,0.08)" },
  td: { padding: "8px 10px", borderTop: "1px solid rgba(255,255,255,0.05)" },
  loadingText: { padding: 24, textAlign: "center", opacity: 0.4, fontSize: 13, color: "var(--text, #f1f5f9)" },
};
