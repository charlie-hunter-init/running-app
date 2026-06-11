import React, { useEffect, useMemo, useState } from "react";
import { DateTime } from "luxon";
import { yearsFromFeatures, shoesFromFeatures, typesFromFeatures } from "./lib/geo";
import Header from "./components/ui/Header";
import MapView from "./components/map/MapView";
import InsightsView from "./components/insights/InsightsView";
import PersonalBestView from "./components/personalBest/PersonalBestView";
import RecentRunsList from "./components/runs/RecentRunsList";
import CalendarView from "./components/calendar/CalendarView";
import WrapView from "./components/wrapped/WrapView";
import TimelineControls from "./components/map/TimelineControls";
import "react-datepicker/dist/react-datepicker.css";
import "./app.css";

const SIDEBAR_WIDTH = 340; // desktop width
const SIDEBAR_GUTTER = 5; // space between map + sidebar
const SIDEBAR_RIGHT_PAD = 100; // space from right edge

export default function StravaHeatmapApp() {
  const [tab, setTab] = useState("map");

  const [geojson, setGeojson] = useState(null);
  const [stats, setStats] = useState(null);
  const [pb, setPb] = useState(null);
  const [indexData, setIndexData] = useState(null);

  // Filters
  const [year, setYear] = useState("All");
  const [type, setType] = useState("All");
  const [shoe, setShoe] = useState("All");
  const [weeklyRange, setWeeklyRange] = useState("all");

  // Responsive breakpoint
  const [isMobile, setIsMobile] = useState(
    window.matchMedia("(max-width: 900px)").matches
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const onChange = (e) => setIsMobile(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Theme
  const [themeMode, setThemeMode] = useState(
    () => localStorage.getItem("theme") || "dark"
  );
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", themeMode);
    localStorage.setItem("theme", themeMode);
  }, [themeMode]);
  const toggleTheme = () => setThemeMode(m => m === "dark" ? "light" : "dark");

  // Heat gradient presets
  const heatGradients = React.useMemo(
    () => ({
      "Strava": { r: 255, g: 160, b: 20,  alpha: 0.35, label: "Strava" },
      "Inferno": { r: 220, g: 40,  b: 120, alpha: 0.35, label: "Inferno" },
      "Ocean":   { r: 20,  g: 180, b: 240, alpha: 0.35, label: "Ocean" },
      "Forest":  { r: 60,  g: 220, b: 80,  alpha: 0.35, label: "Forest" },
    }),
    []
  );
  const [lineColorName, setLineColorName] = useState("Strava");

  // Line mode
  const [lineMode, setLineMode] = useState(false);
  const lineColors = React.useMemo(() => ({
    "White":     "#ffffff",
    "Orange":    "#ff6a00",
    "Blue":      "#3b82f6",
    "Green":     "#16a34a",
    "Red":       "#ef4444",
    "Yellow":    "#facc15",
    "Pink":      "#f472b6",
    "Dark Blue": "#0b3d91",
  }), []);
  const [lineColor, setLineColor] = useState("White");

  // Selection for map
  const [selectedRunId, setSelectedRunId] = useState(null);
  const [selectedFeature, setSelectedFeature] = useState(null);
  const [selectedKm, setSelectedKm] = useState(null);

  // Timeline playback (map)
  const [timelineEnabled, setTimelineEnabled] = useState(false);
  const [timelineStartDay, setTimelineStartDay] = useState(""); // "YYYY-MM-DD"
  const [timelineEndDay, setTimelineEndDay] = useState("");
  const [timelineIsPlaying, setTimelineIsPlaying] = useState(false);
  const [timelineCursorIdx, setTimelineCursorIdx] = useState(0);
  const [timelineDaysPerTick, setTimelineDaysPerTick] = useState(1);

  const TZ = "Pacific/Auckland";
  function dayKeyNZ(isoZ) {
    return DateTime.fromISO(isoZ, { zone: "utc" }).setZone(TZ).toISODate();
  }

  // Load data once
  useEffect(() => {
    fetch("/runs.geojson")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setGeojson(j))
      .catch(() => {});
    fetch("/stats.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => s && setStats(s))
      .catch(() => {});
    fetch("/personal_bests.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => p && setPb(p))
      .catch(() => {});
    fetch("/runs_index.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((idx) => idx && setIndexData(idx))
      .catch(() => {});
  }, []);

  const features = geojson?.features || [];

  // Safety: relax filters if they eliminate everything
  useEffect(() => {
    if (!features.length) return;

    if (type !== "All") {
      const present = new Set(features.map((f) => f?.properties?.type).filter(Boolean));
      if (!present.has(type)) setType("All");
    }

    if (year !== "All") {
      const present = new Set(
        features
          .map((f) => {
            const p = f.properties || {};
            return p.year || (p.start_date ? new Date(p.start_date).getUTCFullYear().toString() : null);
          })
          .filter(Boolean)
      );
      if (!present.has(year)) setYear("All");
    }

    if (shoe !== "All") {
      const present = new Set(
        features
          .map((f) => {
            const p = f.properties || {};
            return p.shoe_name || p.gear_name || p.gear_id || null;
          })
          .filter(Boolean)
      );
      if (!present.has(shoe)) setShoe("All");
    }
  }, [features, type, year, shoe]);

  // Map id->feature
  const idToFeature = useMemo(() => {
    const m = new Map();
    for (const f of features) {
      const id = f?.properties?.id;
      if (id != null) m.set(String(id), f);
    }
    return m;
  }, [features]);

  const yearOptions = useMemo(() => ["All", ...yearsFromFeatures(features)], [features]);
  const shoeOptions = useMemo(() => ["All", ...shoesFromFeatures(features)], [features]);
  const typeOptions = useMemo(() => ["All", ...typesFromFeatures(features)], [features]);

  // Apply filters for map/analytics
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

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        setGeojson(data);
        setYear("All"); setType("All"); setShoe("All");
        setSelectedRunId(null); setSelectedFeature(null); setSelectedKm(null);

        // Timeline reset on file load
        setTimelineEnabled(false);
        setTimelineIsPlaying(false);
        setTimelineCursorIdx(0);
        setTimelineStartDay("");
        setTimelineEndDay("");
      } catch {
        alert("Invalid GeoJSON file");
      }
    };
    reader.readAsText(file);
  }

  // Selection handlers
  function selectRun(id) {
    const key = String(id);
    setSelectedRunId(key);
    setSelectedFeature(idToFeature.get(key) || null);
    setSelectedKm(null);
  }
  function clearSelection() {
    setSelectedRunId(null);
    setSelectedFeature(null);
    setSelectedKm(null);
  }

  const last1000 = useMemo(() => (indexData?.items || []).slice(0, 2000), [indexData]);
  const allIndexItems = indexData?.items || [];

  // ---- Timeline derived data (built from 'filtered' so it respects existing filters) ----

  // Stable order by time so the base layer can append-only during forward playback
  const timelineSortedFiltered = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const da = a?.properties?.start_date ? Date.parse(a.properties.start_date) : 0;
      const db = b?.properties?.start_date ? Date.parse(b.properties.start_date) : 0;
      return da - db;
    });
  }, [filtered]);

  const timelineBucketsByDay = useMemo(() => {
    const map = new Map(); // dayKey -> features[]
    for (const f of timelineSortedFiltered) {
      const sd = f?.properties?.start_date;
      if (!sd) continue;
      const key = dayKeyNZ(sd);
      const arr = map.get(key);
      if (arr) arr.push(f);
      else map.set(key, [f]);
    }
    return map;
  }, [timelineSortedFiltered]);

  const timelineAllDays = useMemo(() => {
    return Array.from(timelineBucketsByDay.keys()).sort();
  }, [timelineBucketsByDay]);

  const timelineMinDay = useMemo(
    () => (timelineAllDays.length ? timelineAllDays[0] : ""),
    [timelineAllDays]
  );
  const timelineMaxDay = useMemo(
    () => (timelineAllDays.length ? timelineAllDays[timelineAllDays.length - 1] : ""),
    [timelineAllDays]
  );

  // Initialise default range when enabling
  useEffect(() => {
    if (!timelineEnabled) return;
    if (timelineAllDays.length === 0) return;
    if (!timelineStartDay) setTimelineStartDay(timelineAllDays[0]);
    if (!timelineEndDay) setTimelineEndDay(timelineAllDays[timelineAllDays.length - 1]);
  }, [timelineEnabled, timelineAllDays, timelineStartDay, timelineEndDay]);

  const timelinePlayableDays = useMemo(() => {
    if (!timelineEnabled) return [];
    if (!timelineStartDay || !timelineEndDay) return [];
    const start = timelineStartDay <= timelineEndDay ? timelineStartDay : timelineEndDay;
    const end = timelineStartDay <= timelineEndDay ? timelineEndDay : timelineStartDay;
    return timelineAllDays.filter((d) => d >= start && d <= end);
  }, [timelineEnabled, timelineAllDays, timelineStartDay, timelineEndDay]);

  // When user changes range, show runs up to the start day immediately
  useEffect(() => {
    if (!timelineEnabled) return;
    if (!timelineStartDay || !timelineEndDay) return;
    if (timelinePlayableDays.length === 0) return;

    setTimelineIsPlaying(false);
    setTimelineCursorIdx(0);
  }, [timelineEnabled, timelineStartDay, timelineEndDay, timelinePlayableDays.length]);

  // Reset playback cursor when filters change (keeps things consistent)
  useEffect(() => {
    setTimelineIsPlaying(false);
    setTimelineCursorIdx(0);
  }, [year, type, shoe]);

  // Playback loop (day stepping)
  useEffect(() => {
    if (!timelineEnabled) return;
    if (!timelineIsPlaying) return;
    if (timelinePlayableDays.length === 0) return;

    const handle = window.setInterval(() => {
      setTimelineCursorIdx((idx) => {
        const max = timelinePlayableDays.length - 1;
        const next = idx + timelineDaysPerTick;
        if (next >= max) {
          setTimelineIsPlaying(false);
          return max;
        }
        return next;
      });
    }, 400);

    return () => window.clearInterval(handle);
  }, [timelineEnabled, timelineIsPlaying, timelinePlayableDays, timelineDaysPerTick]);

  // Features visible on the map
  // ✅ Behaviour:
  // - When Start is selected, show ALL runs up to Start (from the beginning of time)
  // - When playing, keep adding runs beyond Start up to the cursor day (within start..end)
  const mapRuns = useMemo(() => {
    if (!timelineEnabled) return filtered;
    if (!timelineStartDay) return filtered;
    if (timelineAllDays.length === 0) return [];

    const max = Math.max(0, timelinePlayableDays.length - 1);
    const cursorDayInWindow = timelinePlayableDays.length
      ? timelinePlayableDays[Math.max(0, Math.min(timelineCursorIdx, max))]
      : timelineStartDay;

    const cutoffDay = cursorDayInWindow;

    const out = [];
    for (const d of timelineAllDays) {
      if (d > cutoffDay) break;
      const bucket = timelineBucketsByDay.get(d);
      if (bucket) out.push(...bucket);
    }
    return out;
  }, [
    timelineEnabled,
    filtered,
    timelineStartDay,
    timelinePlayableDays,
    timelineCursorIdx,
    timelineAllDays,
    timelineBucketsByDay,
  ]);

  return (
    <div
      className="app-root"
      style={{
        position: "fixed",
        inset: 0,
        display: "grid",
        gridTemplateRows: "auto 1fr",
        background: "#05060a",
        minWidth: 0,
        minHeight: 0,
      }}
    >
      <Header
        tab={tab}
        setTab={setTab}
        year={year} yearOptions={yearOptions} setYear={setYear}
        type={type} typeOptions={typeOptions} setType={setType}
        shoe={shoe} shoeOptions={shoeOptions} setShoe={setShoe}
        lineColorName={lineColorName} setLineColorName={setLineColorName}
        heatGradients={heatGradients}
        lineMode={lineMode} setLineMode={setLineMode}
        lineColor={lineColor} setLineColor={setLineColor}
        lineColors={lineColors}
        onFile={handleFile}
        isMobile={isMobile}
        themeMode={themeMode}
        toggleTheme={toggleTheme}
        tabs={[
          { id: "map", label: "Map" },
          { id: "insights", label: "Insights" },
          { id: "calendar", label: "Calendar" },
          { id: "wrapped", label: "Wrapped" },
          { id: "pb", label: "PBs" },
        ]}
      />

      <div style={{ width: "100%", height: "100%", overflow: "hidden" }}>
        {tab === "map" ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: isMobile
                ? "1fr"
                : `minmax(0, 1fr) ${SIDEBAR_WIDTH}px`,
              gridTemplateRows: isMobile ? "1fr auto" : "1fr",
              gap: isMobile ? 0 : SIDEBAR_GUTTER,
              height: "100%",
              minHeight: 0,
              paddingRight: isMobile ? 0 : SIDEBAR_RIGHT_PAD,
              boxSizing: "border-box",
            }}
          >
            {/* Map */}
            <div style={{ minHeight: 0 }}>
              <MapView
                filtered={mapRuns}
                heatGradient={heatGradients[lineColorName]}
                lineMode={lineMode}
                lineColor={lineColors[lineColor]}
                selectedFeature={selectedFeature}
                highlightColor="#ff6a00"
                selectedKm={selectedKm}
                selectedKmColor="#3b82f6"
                isMobile={isMobile}
                suppressFit={timelineEnabled && timelineIsPlaying}
              />
            </div>

            {/* Sidebar wrapper */}
            <div
              style={{
                height: isMobile ? "42dvh" : "100%",
                minHeight: 0,
                borderTop: isMobile ? "1px solid rgba(255,255,255,0.08)" : "none",
                background: isMobile ? "#05060a" : "transparent",
                borderRadius: isMobile ? 0 : 12,
                overflow: "hidden",
                boxShadow: isMobile
                  ? "none"
                  : "0 0 0 1px rgba(255,255,255,0.06), 0 12px 30px rgba(0,0,0,0.45)",
              }}
            >
              <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
                <TimelineControls
                  enabled={timelineEnabled}
                  setEnabled={(v) => {
                    setTimelineEnabled(v);
                    setTimelineIsPlaying(false);
                    setTimelineCursorIdx(0);
                  }}
                  startDay={timelineStartDay}
                  setStartDay={setTimelineStartDay}
                  endDay={timelineEndDay}
                  setEndDay={setTimelineEndDay}
                  minDay={timelineMinDay}
                  maxDay={timelineMaxDay}
                  isPlaying={timelineIsPlaying}
                  onTogglePlay={() => setTimelineIsPlaying((p) => !p)}
                  cursorIdx={timelineCursorIdx}
                  setCursorIdx={(v) => {
                    setTimelineIsPlaying(false);
                    setTimelineCursorIdx(v);
                  }}
                  playableDays={timelinePlayableDays}
                  daysPerTick={timelineDaysPerTick}
                  setDaysPerTick={setTimelineDaysPerTick}
                />

                <div style={{ flex: 1, minHeight: 0 }}>
                  <RecentRunsList
                    items={last1000}
                    idToFeature={idToFeature}
                    selectedId={selectedRunId}
                    selectedKm={selectedKm}
                    onSelect={(id) => selectRun(id)}
                    onSelectSplit={(runId, km) => {
                      selectRun(runId);
                      setSelectedKm(km);
                    }}
                    onClear={clearSelection}
                    pageSize={50}
                  />
                </div>
              </div>
            </div>
          </div>
        ) : tab === "insights" ? (
          <InsightsView
            stats={stats}
            features={features}
            filtered={filtered}
            allItems={allIndexItems}
            weeklyRange={weeklyRange}
            setWeeklyRange={setWeeklyRange}
          />
        ) : tab === "calendar" ? (
          <CalendarView features={features} filtered={filtered} items={allIndexItems} />
        ) : tab === "wrapped" ? (
          <WrapView items={allIndexItems} features={features} />
        ) : (
          <PersonalBestView pb={pb} features={features} />
        )}
      </div>
    </div>
  );
}
