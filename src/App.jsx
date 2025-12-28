import React, { useEffect, useMemo, useState } from "react";
import { yearsFromFeatures, shoesFromFeatures, typesFromFeatures } from "./lib/geo";
import Header from "./components/ui/Header";
import MapView from "./components/map/MapView";
import InsightsView from "./components/insights/InsightsView";
import PersonalBestView from "./components/personalBest/PersonalBestView";
import RecentRunsList from "./components/runs/RecentRunsList";
import CalendarView from "./components/calendar/CalendarView";
import WrapView from "./components/wrapped/WrapView";
import "./app.css";

const SIDEBAR_WIDTH = 340; // desktop width
const SIDEBAR_GUTTER = 5; // NEW: space between map + sidebar
const SIDEBAR_RIGHT_PAD = 100; // NEW: space from right edge

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

  // Line colours
  const lineColors = React.useMemo(
    () => ({
      "Dark Blue": "#0b3d91",
      Green: "#16a34a",
      Red: "#ff4d4f",
      Black: "#000000",
      White: "#ffffff",
    }),
    []
  );
  const [lineColorName, setLineColorName] = useState("White");
  const lineColor = lineColors[lineColorName];

  // Selection for map
  const [selectedRunId, setSelectedRunId] = useState(null);
  const [selectedFeature, setSelectedFeature] = useState(null);
  const [selectedKm, setSelectedKm] = useState(null);

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
        lineColors={lineColors}
        onFile={handleFile}
        isMobile={isMobile}
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
              gap: isMobile ? 0 : SIDEBAR_GUTTER, // NEW: gutter only on desktop
              height: "100%",
              minHeight: 0,
              paddingRight: isMobile ? 0 : SIDEBAR_RIGHT_PAD, // NEW: push sidebar off edge
              boxSizing: "border-box",
            }}
          >
            {/* Map */}
            <div style={{ minHeight: 0 }}>
              <MapView
                filtered={filtered}
                lineColor={lineColor}
                selectedFeature={selectedFeature}
                highlightColor="#ff6a00"
                selectedKm={selectedKm}
                selectedKmColor="#3b82f6"
                isMobile={isMobile}
              />
            </div>

            {/* Sidebar wrapper */}
            <div
              style={{
                height: isMobile ? "42dvh" : "100%",
                minHeight: 0,
                borderTop: isMobile ? "1px solid rgba(255,255,255,0.08)" : "none",
                background: isMobile ? "#05060a" : "transparent",

                // NEW: subtle separation from map
                borderRadius: isMobile ? 0 : 12,
                overflow: "hidden",
                boxShadow: isMobile
                  ? "none"
                  : "0 0 0 1px rgba(255,255,255,0.06), 0 12px 30px rgba(0,0,0,0.45)",
              }}
            >
              <RecentRunsList
                items={last1000}
                selectedId={selectedRunId}
                selectedKm={selectedKm}
                onSelect={(id) => selectRun(id)}
                onSelectSplit={(runId, km) => { selectRun(runId); setSelectedKm(km); }}
                onClear={clearSelection}
                pageSize={50}
              />
            </div>
          </div>
        ) : tab === "insights" ? (
          <InsightsView
            stats={stats}
            features={features}
            filtered={filtered}
            weeklyRange={weeklyRange}
            setWeeklyRange={setWeeklyRange}
          />
        ) : tab === "calendar" ? (
          <CalendarView
            features={features}
            filtered={filtered}
            items={allIndexItems}
          />
        ) : tab === "wrapped" ? (
          <WrapView
            items={allIndexItems}
            features={features}
          />
        ) : (
          <PersonalBestView pb={pb} features={features} />
        )}
      </div>
    </div>
  );
}
