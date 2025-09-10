import React, { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, GeoJSON, useMap, LayersControl } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.heat";

import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, BarChart, Bar } from "recharts";

// ---------- helpers ----------
function flattenLineCoords(feature) {
  if (!feature || feature.type !== "Feature") return [];
  const geom = feature.geometry;
  if (!geom) return [];
  if (geom.type === "LineString") return geom.coordinates;
  if (geom.type === "MultiLineString") return geom.coordinates.flat();
  return [];
}
function computeBoundsFromFeatures(features) {
  const bounds = L.latLngBounds([]);
  for (const f of features) {
    const lonlat = flattenLineCoords(f);
    for (const [lon, lat] of lonlat) bounds.extend([lat, lon]);
  }
  return bounds.isValid() ? bounds : null;
}
function yearsFromFeatures(features) {
  const set = new Set();
  for (const f of features) {
    const y =
      f.properties?.year ||
      (f.properties?.start_date
        ? new Date(f.properties.start_date).getUTCFullYear().toString()
        : null);
    if (y) set.add(y);
  }
  return [...set].sort();
}
function shoesFromFeatures(features) {
  const set = new Set();
  for (const f of features) {
    const s = f.properties?.shoe_name || f.properties?.gear_name || f.properties?.gear_id;
    if (s) set.add(s);
  }
  return [...set].sort();
}
function typesFromFeatures(features) {
  const set = new Set();
  for (const f of features) {
    const t = f.properties?.type;
    if (t) set.add(t);
  }
  return [...set].sort();
}
// Convert LineStrings to heat points [[lat, lon, weight], ...]
function linesToHeatPoints(features, sampleEvery = 1) {
  const pts = [];
  for (const f of features) {
    const coords = flattenLineCoords(f);
    for (let i = 0; i < coords.length; i += sampleEvery) {
      const [lon, lat] = coords[i];
      if (Number.isFinite(lat) && Number.isFinite(lon)) pts.push([lat, lon, 0.8]);
    }
  }
  return pts;
}
function km(m) { return (m / 1000).toFixed(1); }
function fmtDate(iso) { return (iso || "").slice(0, 10); }

// --- ISO week helpers (so we can date-filter weekly data) ---
function isoWeekStartDate(weekYear, weekNumber) {
  // ISO: week 1 is the week with Jan 4; start is Monday
  const jan4 = new Date(Date.UTC(weekYear, 0, 4));
  const day = jan4.getUTCDay() || 7; // 1..7 (Mon..Sun)
  const mondayWeek1 = new Date(jan4);
  mondayWeek1.setUTCDate(jan4.getUTCDate() - (day - 1));
  const result = new Date(mondayWeek1);
  result.setUTCDate(mondayWeek1.getUTCDate() + (weekNumber - 1) * 7);
  return result; // UTC date for the Monday of that ISO week
}

function weeklyToArray(weeklyObj) {
  const rows = Object.entries(weeklyObj || {}).map(([wk, v]) => {
    const [yStr, wStr] = wk.split("-");
    const y = Number(yStr);
    const w = Number(wStr);
    const startDate = isoWeekStartDate(y, w); // Date (UTC)
    return {
      weekKey: wk,
      startDate, // for filtering/sorting
      distance_km: (v.distance_m || 0) / 1000,
      count: v.count || 0,
    };
  });
  rows.sort((a, b) => a.startDate - b.startDate);
  return rows;
}
// --- date helpers for daily/monthly binning (Pacific/Auckland) ---
const INSIGHTS_TZ = "Pacific/Auckland";

function dayKeyLocal(dateISO, tz = INSIGHTS_TZ) {
  // "YYYY-MM-DD" in the given timezone
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(dateISO));
}

function monthKeyLocal(dateISO, tz = INSIGHTS_TZ) {
  // "YYYY-MM" in the given timezone
  const d = new Date(dateISO);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit",
  }).formatToParts(d);
  const y = parts.find(p => p.type === "year").value;
  const m = parts.find(p => p.type === "month").value;
  return `${y}-${m}`;
}





// ---------- heat layer ----------
function HeatmapLayer({ points, radius = 8, blur = 12, maxZoom = 18, gradient }) {
  const map = useMap();
  const layerRef = useRef(null);

  useEffect(() => {
    if (!map) return;
    const ready = (map._loaded ?? true) && map.getSize && map.getSize().y > 0 && map.getSize().x > 0;
    if (!ready) return;

    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }
    if (points && points.length) {
      layerRef.current = L.heatLayer(points, { radius, blur, maxZoom, gradient });
      layerRef.current.addTo(map);
    }
    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [map, points, radius, blur, maxZoom, gradient]);

  return null;
}

function FitToBounds({ features }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    map.whenReady(() => {
      const b = computeBoundsFromFeatures(features);
      if (b) map.fitBounds(b, { padding: [40, 40] });
    });
  }, [features, map]);
  return null;
}

function MapInvalidateOnReady() {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    map.whenReady(() => {
      setTimeout(() => map.invalidateSize(), 0);
    });
  }, [map]);
  return null;
}

// ---------- Insights components ----------
function WeeklyMileageChart({ weekly, range }) {
  // compute cutoff by range (in days)
  const all = React.useMemo(() => weeklyToArray(weekly), [weekly]);

  const filtered = React.useMemo(() => {
    if (!all.length) return [];
    const now = new Date(); // UTC ok for relative ranges
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

function ActivitiesTable({ features }) {
  const rows = React.useMemo(() => {
    return (features || []).map((f) => {
      const p = f.properties || {};
      return {
        id: p.id,
        date: fmtDate(p.start_date),
        name: p.name || "(untitled)",
        type: p.type || "-",
        km: km(p.distance_m || 0),
        shoe: p.shoe_name || p.gear_name || p.gear_id || "-",
      };
    }).sort((a, b) => (a.date < b.date ? 1 : -1)); // newest first
  }, [features]);

  return (
    <div style={{ background: "#fff", border: "1px solid #eee", borderRadius: 8, overflow: "hidden" }}>
      <div style={{ padding: "8px 12px", borderBottom: "1px solid #eee", fontWeight: 600 }}>Activities</div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: 8 }}>Date</th>
              <th style={{ textAlign: "left", padding: 8 }}>Name</th>
              <th style={{ textAlign: "left", padding: 8 }}>Type</th>
              <th style={{ textAlign: "right", padding: 8 }}>Distance (km)</th>
              <th style={{ textAlign: "left", padding: 8 }}>Shoe</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={{ padding: 8, borderTop: "1px solid #f1f5f9" }}>{r.date}</td>
                <td style={{ padding: 8, borderTop: "1px solid #f1f5f9" }}>{r.name}</td>
                <td style={{ padding: 8, borderTop: "1px solid #f1f5f9" }}>{r.type}</td>
                <td style={{ padding: 8, borderTop: "1px solid #f1f5f9", textAlign: "right" }}>{r.km}</td>
                <td style={{ padding: 8, borderTop: "1px solid #f1f5f9" }}>{r.shoe}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ShoeTable({ byShoe }) {
  const rows = React.useMemo(() => {
    // Sort by last_date DESC; undefined last_date at the end
    const arr = Object.entries(byShoe || {}).map(([shoe, v]) => ({
      shoe,
      km: (v.distance_m / 1000).toFixed(1),
      runs: v.count || 0,
      last: v.last_date ? new Date(v.last_date) : null,
      lastStr: v.last_date ? fmtDate(v.last_date) : "-",
    }));
    arr.sort((a, b) => {
      if (a.last && b.last) return b.last - a.last;     // most recent first
      if (a.last && !b.last) return -1;
      if (!a.last && b.last) return 1;
      return 0;
    });
    return arr;
  }, [byShoe]);

  return (
    <div style={{ background: "#fff", border: "1px solid #eee", borderRadius: 8, overflow: "hidden" }}>
      <div style={{ padding: "8px 12px", borderBottom: "1px solid #eee", fontWeight: 600 }}>Shoe Totals (last used)</div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: 8 }}>Shoe</th>
              <th style={{ textAlign: "right", padding: 8 }}>Km</th>
              <th style={{ textAlign: "right", padding: 8 }}>Runs</th>
              <th style={{ textAlign: "left", padding: 8 }}>Last used</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.shoe}>
                <td style={{ padding: 8, borderTop: "1px solid #f1f5f9" }}>{r.shoe}</td>
                <td style={{ padding: 8, borderTop: "1px solid #f1f5f9", textAlign: "right" }}>{r.km}</td>
                <td style={{ padding: 8, borderTop: "1px solid #f1f5f9", textAlign: "right" }}>{r.runs}</td>
                <td style={{ padding: 8, borderTop: "1px solid #f1f5f9" }}>{r.lastStr}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}


// --- Streak helpers/components ---
const TZ = "Pacific/Auckland";

// "YYYY-MM-DD" in a given IANA timezone
function dayKeyFromDate(d, timeZone = TZ) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}
function addDays(date, delta) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + delta);
  return d;
}
function dateFromKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function StreakTracker({ features, timeZone = TZ, type = "Run" }) {
  const daySet = React.useMemo(() => {
    const s = new Set();
    for (const f of features || []) {
      const p = f.properties || {};
      if (type && p.type !== type) continue;
      if (!p.start_date) continue;
      const d = new Date(p.start_date);
      s.add(dayKeyFromDate(d, timeZone));
    }
    return s;
  }, [features, timeZone, type]);

  // Count from *today* backwards
  const { current, currentEndsOn } = React.useMemo(() => {
    const todayKey = dayKeyFromDate(new Date(), timeZone);
    let streak = 0;
    let cursor = dateFromKey(todayKey);
    while (daySet.has(dayKeyFromDate(cursor, timeZone))) {
      streak++;
      cursor = addDays(cursor, -1);
    }
    return { current: streak, currentEndsOn: todayKey };
  }, [daySet, timeZone]);

  // Longest streak across the whole dataset
  const { longest, longestStart, longestEnd } = React.useMemo(() => {
    if (daySet.size === 0) return { longest: 0, longestStart: null, longestEnd: null };
    const keys = Array.from(daySet).sort(); // "YYYY-MM-DD" lexicographic = chronological
    const have = new Set(keys);

    let bestLen = 0, bestStart = null, bestEnd = null;

    for (const key of keys) {
      const prevKey = dayKeyFromDate(addDays(dateFromKey(key), -1), TZ);
      if (have.has(prevKey)) continue; // not a sequence start

      let len = 1, start = key, end = key, cur = dateFromKey(key);
      while (true) {
        const next = addDays(cur, 1);
        const nextKey = dayKeyFromDate(next, TZ);
        if (!have.has(nextKey)) break;
        len++; end = nextKey; cur = next;
      }

      if (len > bestLen) { bestLen = len; bestStart = start; bestEnd = end; }
    }

    return { longest: bestLen, longestStart: bestStart, longestEnd: bestEnd };
  }, [daySet]);

  return (
    <div style={{ background: "#fff", border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
      <h3 style={{ margin: "0 0 8px 0", fontSize: 16 }}>Streaks (Run days)</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
        <div style={{ padding: 12, border: "1px solid #f1f5f9", borderRadius: 8 }}>
          <div style={{ fontSize: 12, color: "#6b7280" }}>Current streak</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{current} day{current === 1 ? "" : "s"}</div>
          <div style={{ fontSize: 12, color: "#6b7280" }}>
            {current > 0 ? `Active through ${currentEndsOn}` : "No run today"}
          </div>
        </div>
        <div style={{ padding: 12, border: "1px solid #f1f5f9", borderRadius: 8 }}>
          <div style={{ fontSize: 12, color: "#6b7280" }}>Longest streak</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{longest} day{longest === 1 ? "" : "s"}</div>
          <div style={{ fontSize: 12, color: "#6b7280" }}>
            {longest ? `${longestStart} → ${longestEnd}` : "—"}
          </div>
        </div>
      </div>
    </div>
  );
}




// Build daily km, then compute a 7-day trailing sum
function useRolling7Data(features) {
  // 1) daily totals
  const dailyMap = new Map(); // key "YYYY-MM-DD" -> km
  for (const f of features || []) {
    const p = f.properties || {};
    if (!p.start_date) continue;
    const key = dayKeyLocal(p.start_date);
    const km = (p.distance_m || 0) / 1000;
    dailyMap.set(key, (dailyMap.get(key) || 0) + km);
  }

  // 2) sort days continuous (fill missing days as 0 to keep the rolling window correct)
  const keys = Array.from(dailyMap.keys()).sort();
  if (keys.length === 0) return [];

  const first = new Date(keys[0] + "T00:00:00Z");
  const last  = new Date(keys[keys.length - 1] + "T00:00:00Z");
  const allDays = [];
  for (let d = new Date(first); d <= last; d.setUTCDate(d.getUTCDate() + 1)) {
    const k = d.toISOString().slice(0,10);
    // k is UTC; convert to local key by making a Date and re-keying:
    const localKey = dayKeyLocal(k);
    // ensure unique progression (some timezones may shift the label; it's fine for display)
    if (!allDays.length || allDays[allDays.length-1].day !== localKey) {
      allDays.push({ day: localKey, km: dailyMap.get(localKey) || 0 });
    }
  }

  // 3) rolling sum (previous 6 days + today)
  const out = [];
  let windowSum = 0;
  const q = []; // queue of last up-to-7 values
  for (const row of allDays) {
    q.push(row.km);
    windowSum += row.km;
    if (q.length > 7) windowSum -= q.shift();
    out.push({ day: row.day, km7: windowSum });
  }
  return out;
}

function Rolling7Chart({ features }) {
  const data = React.useMemo(() => useRolling7Data(features), [features]);
  if (!data.length) return <div style={{ padding: 8, color: "#666" }}>No data yet.</div>;
  return (
    <div style={{ width: "100%", height: 260, background: "#fff", border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
      <h3 style={{ margin: "0 0 8px 0", fontSize: 16 }}>Rolling 7-Day Distance (km)</h3>
      <ResponsiveContainer>
        <AreaChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="day" />
          <YAxis />
          <Tooltip />
          <Area type="monotone" dataKey="km7" name="Km (7-day)" fillOpacity={0.2} stroke="#16a34a" fill="#bbf7d0" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}


// helper: first day of month (UTC)
function monthStartUTC(y, m0) {
  return new Date(Date.UTC(y, m0, 1));
}

function cutoffFromRange(range) {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m0 = now.getUTCMonth(); // 0..11
  let cy = y, cm0 = m0;

  switch (range) {
    case "12m": cm0 = m0 - 8; break;
    case "6m":  cm0 = m0 - 6;  break;
    case "3m":  cm0 = m0 - 3;  break;
    case "1m":  cm0 = m0 - 1;  break;
    case "all":
    default: return null;
  }
  // normalize year/month
  while (cm0 < 0) { cm0 += 12; cy -= 12; }
  return monthStartUTC(cy, cm0);
}

function useMonthlyData(features, range = "all") {
  const map = new Map(); // "YYYY-MM" -> km
  for (const f of features || []) {
    const p = f.properties || {};
    if (!p.start_date) continue;
    const key = monthKeyLocal(p.start_date); // "YYYY-MM" in your local TZ
    const km = (p.distance_m || 0) / 1000;
    map.set(key, (map.get(key) || 0) + km);
  }

  // to rows with a comparable Date for filtering
  let rows = Array.from(map.entries()).map(([month, km]) => {
    const [yy, mm] = month.split("-").map(Number);
    const start = monthStartUTC(yy, mm - 1); // first day of month
    return { month, start, km: +km.toFixed(1) };
  });

  // filter by range (if not "all")
  const cutoff = cutoffFromRange(range);
  if (cutoff) rows = rows.filter(r => r.start >= cutoff);

  // sort ascending by month
  rows.sort((a, b) => a.start - b.start);
  return rows;
}

function MonthlyDistanceBars({ features, range = "all" }) {
  const data = React.useMemo(() => useMonthlyData(features, range), [features, range]);
  if (!data.length) return <div style={{ padding: 8, color: "#666" }}>No monthly data for selected range.</div>;
  return (
    <div style={{ width: "100%", height: 260, background: "#fff", border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
      <h3 style={{ margin: "0 0 8px 0", fontSize: 16 }}>Monthly Distance (km)</h3>
      <ResponsiveContainer>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="month" />
          <YAxis />
          <Tooltip />
          <Bar dataKey="km" name="Km" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}






// ---------- app ----------
export default function StravaHeatmapApp() {
  const [tab, setTab] = useState("map"); // "map" | "insights"

  const [geojson, setGeojson] = useState(null);
  const [stats, setStats] = useState(null);

  const [showLines, setShowLines] = useState(true); // lines ON by default
  const [radius, setRadius] = useState(8);
  const [blur, setBlur] = useState(12);
  const [year, setYear] = useState("All");
  const [type, setType] = useState("All");
  const [shoe, setShoe] = useState("All");

  // Weekly chart range for Insights
  const [weeklyRange, setWeeklyRange] = useState("all"); // "all" | "12m" | "6m" | "3m" | "1m"

  // Heatmap palette + gradients
  const [palette, setPalette] = useState("Grayscale");
  const gradients = useMemo(
    () => ({
      "Red→Orange→Yellow": { 0.0: "#ff0000", 0.5: "#ff7f00", 1.0: "#ffff00" },
      "Yellow→Orange→Red": { 0.0: "#ffff00", 0.5: "#ff7f00", 1.0: "#ff0000" },
      "Blue→Lime→Red": { 0.4: "blue", 0.65: "lime", 1.0: "red" },
      "Purple→Pink→Yellow": { 0.0: "#6b21a8", 0.5: "#ec4899", 1.0: "#fde047" },
      Grayscale: { 0.4: "#444", 0.65: "#888", 1.0: "#ccc" },
    }),
    []
  );
  const gradient = gradients[palette];

  // Line colour selector
  const lineColors = useMemo(
    () => ({
      "Dark Blue": "#0b3d91",
      Green: "#16a34a",
      Red: "#ff4d4f",
      Black: "#000000",
      White: "#ffffff"
    }),
    []
  );
  const [lineColorName, setLineColorName] = useState("White");
  const lineColor = lineColors[lineColorName];

  // Load default data
  useEffect(() => {
    fetch("/runs.geojson").then((r) => (r.ok ? r.json() : null)).then((j) => j && setGeojson(j)).catch(() => {});
    fetch("/stats.json").then((r) => (r.ok ? r.json() : null)).then((s) => s && setStats(s)).catch(() => {});
  }, []);

  const features = geojson?.features || [];
  const yearOptions = useMemo(() => ["All", ...yearsFromFeatures(features)], [features]);
  const shoeOptions = useMemo(() => ["All", ...shoesFromFeatures(features)], [features]);
  const typeOptions = useMemo(() => ["All", ...typesFromFeatures(features)], [features]);

  const filtered = useMemo(() => {
    return features.filter((f) => {
      const p = f.properties || {};
      const y = p.year || (p.start_date ? new Date(p.start_date).getUTCFullYear().toString() : null);
      const t = p.type || null;
      const s = p.shoe_name || p.gear_name || p.gear_id || null;
      if (year !== "All" && y !== year) return false;
      if (type !== "All" && t !== type) return false;
      if (shoe !== "All" && s !== shoe) return false;
      return true;
    });
  }, [features, year, type, shoe]);

  const heatPoints = useMemo(() => linesToHeatPoints(filtered, 1), [filtered]);

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        setGeojson(data);
        setYear("All");
        setType("All");
        setShoe("All");
      } catch (err) {
        alert("Invalid GeoJSON file");
      }
    };
    reader.readAsText(file);
  }

  // ---------- UI ----------
  return (
    <div style={{ height: "100vh", display: "grid", gridTemplateRows: "auto 1fr", background: "#f8fafc" }}>
      {/* Header */}
      <div style={{ width: "100%", borderBottom: "1px solid #e5e7eb", background: "#fff", padding: "12px 16px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, marginRight: "auto" }}>Strava Global Heatmap</h1>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 8, marginRight: 16 }}>
          <button onClick={() => setTab("map")} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #e5e7eb", background: tab === "map" ? "#eef2ff" : "#fff" }}>Map</button>
          <button onClick={() => setTab("insights")} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #e5e7eb", background: tab === "insights" ? "#eef2ff" : "#fff" }}>Insights</button>
        </div>
        {/* Filters */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ fontSize: 14 }}>Year</label>
          <select value={year} onChange={(e) => setYear(e.target.value)} style={{ border: "1px solid #e5e7eb", borderRadius: 6, padding: "4px 8px", fontSize: 14 }}>
            {yearOptions.map((y) => (<option key={y} value={y}>{y}</option>))}
          </select>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ fontSize: 14 }}>Type</label>
          <select value={type} onChange={(e) => setType(e.target.value)} style={{ border: "1px solid #e5e7eb", borderRadius: 6, padding: "4px 8px", fontSize: 14 }}>
            {typeOptions.map((t) => (<option key={t} value={t}>{t}</option>))}
          </select>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ fontSize: 14 }}>Shoe</label>
          <select value={shoe} onChange={(e) => setShoe(e.target.value)} style={{ border: "1px solid #e5e7eb", borderRadius: 6, padding: "4px 8px", fontSize: 14, maxWidth: 220 }}>
            {shoeOptions.map((s) => (<option key={s} value={s}>{s}</option>))}
          </select>
        </div>

        {/* Heatmap controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ fontSize: 14 }}>Radius</label>
          <input type="range" min={4} max={30} value={radius} onChange={(e) => setRadius(Number(e.target.value))} />
          <span style={{ fontSize: 14, width: 24, textAlign: "center" }}>{radius}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ fontSize: 14 }}>Blur</label>
          <input type="range" min={4} max={40} value={blur} onChange={(e) => setBlur(Number(e.target.value))} />
          <span style={{ fontSize: 14, width: 24, textAlign: "center" }}>{blur}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ fontSize: 14 }}>Palette</label>
          <select value={palette} onChange={(e) => setPalette(e.target.value)} style={{ border: "1px solid #e5e7eb", borderRadius: 6, padding: "4px 8px", fontSize: 14 }}>
            {Object.keys(gradients).map((k) => (<option key={k} value={k}>{k}</option>))}
          </select>
        </div>
        {/* Line colour picker */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ fontSize: 14 }}>Line colour</label>
          <select value={lineColorName} onChange={(e) => setLineColorName(e.target.value)} style={{ border: "1px solid #e5e7eb", borderRadius: 6, padding: "4px 8px", fontSize: 14 }}>
            {Object.keys(lineColors).map((k) => (<option key={k} value={k}>{k}</option>))}
          </select>
        </div>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14 }}>
          <input type="checkbox" checked={showLines} onChange={(e) => setShowLines(e.target.checked)} />
          Show lines
        </label>
      </div>

      {/* Body */}
      <div style={{ width: "100%", height: "100%", overflow: "hidden" }}>
        {tab === "map" ? (
          // -------- MAP TAB --------
          <MapContainer style={{ width: "100%", height: "100%" }} center={[20, 0]} zoom={2} minZoom={2} worldCopyJump>
            <MapInvalidateOnReady />

            {/* Basemap switcher (Esri satellite default) */}
            <LayersControl position="topright">
              <LayersControl.BaseLayer name="OSM Standard">
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" />
              </LayersControl.BaseLayer>

              <LayersControl.BaseLayer checked name="Esri World Imagery (Satellite)">
                <TileLayer
                  url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                  attribution="Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community"
                />
              </LayersControl.BaseLayer>

              <LayersControl.BaseLayer name="Carto Positron (Light)">
                <TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors &copy; CARTO" />
              </LayersControl.BaseLayer>

              <LayersControl.BaseLayer name="Carto Dark Matter">
                <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors &copy; CARTO" />
              </LayersControl.BaseLayer>

              <LayersControl.BaseLayer name="OSM Humanitarian">
                <TileLayer url="https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors, Humanitarian OpenStreetMap Team" />
              </LayersControl.BaseLayer>
            </LayersControl>

            {/* Heatmap */}
            <HeatmapLayer points={heatPoints} radius={radius} blur={blur} gradient={gradient} />

            {/* Lines */}
            {showLines && filtered.length > 0 && (
              <GeoJSON key={`lines-${filtered.length}`} data={{ type: "FeatureCollection", features: filtered }} style={{ color: lineColor, weight: 1, opacity: 0.6 }} />
            )}

            <FitToBounds features={filtered} />
          </MapContainer>
        ) : (
          // -------- INSIGHTS TAB --------
          <div style={{ height: "100%", overflow: "auto", padding: 16 }}>
            {/* Range filter for weekly chart */}
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

            {/* Top summary tiles */}
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
              <MonthlyDistanceBars features={filtered} range={weeklyRange}/>
              <StreakTracker features={features} />
              
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
             
              
            </div>

            {/* Activities table respects current map filters */}
            <ActivitiesTable features={filtered} />
          </div>
        )}
      </div>
    </div>
  );
}
