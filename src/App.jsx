import React, { useEffect, useMemo, useState } from "react";
import { yearsFromFeatures, shoesFromFeatures, typesFromFeatures } from "./lib/geo";
import Header from "./components/ui/Header";
import MapView from "./components/map/MapView";
import InsightsView from "./components/insights/InsightsView";
import PersonalBestView from "./components/personalBest/PersonalBestView";
import RecentRunsList from "./components/runs/RecentRunsList";

const SIDEBAR_WIDTH = 340; // keep the map big

export default function StravaHeatmapApp() {
  const [tab, setTab] = useState("map");

  const [geojson, setGeojson] = useState(null);
  const [stats, setStats] = useState(null);
  const [pb, setPb] = useState(null);
  const [indexData, setIndexData] = useState(null);

  // Filters (default to All so nothing is hidden at startup)
  const [year, setYear] = useState("All");
  const [type, setType] = useState("All");
  const [shoe, setShoe] = useState("All");

  const [weeklyRange, setWeeklyRange] = useState("all");

  // Line colors
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

  // Selection (for highlight-on-map)
  const [selectedRunId, setSelectedRunId] = useState(null);
  const [selectedFeature, setSelectedFeature] = useState(null);

  // Load data once
  useEffect(() => {
    fetch("/runs.geojson").then(r => (r.ok ? r.json() : null)).then(j => j && setGeojson(j)).catch(() => {});
    fetch("/stats.json").then(r => (r.ok ? r.json() : null)).then(s => s && setStats(s)).catch(() => {});
    fetch("/personal_bests.json").then(r => (r.ok ? r.json() : null)).then(p => p && setPb(p)).catch(() => {});
    fetch("/runs_index.json").then(r => (r.ok ? r.json() : null)).then(idx => idx && setIndexData(idx)).catch(() => {});
  }, []);

  const features = geojson?.features || [];

  // Safety: relax filters if they eliminate everything due to mismatched labels
  useEffect(() => {
    if (!features.length) return;
    if (type !== "All") {
      const presentTypes = new Set(features.map(f => f?.properties?.type).filter(Boolean));
      if (!presentTypes.has(type)) setType("All");
    }
    if (year !== "All") {
      const presentYears = new Set(features.map(f => {
        const p = f.properties || {};
        return p.year || (p.start_date ? new Date(p.start_date).getUTCFullYear().toString() : null);
      }).filter(Boolean));
      if (!presentYears.has(year)) setYear("All");
    }
    if (shoe !== "All") {
      const presentShoes = new Set(features.map(f => {
        const p = f.properties || {};
        return p.shoe_name || p.gear_name || p.gear_id || null;
      }).filter(Boolean));
      if (!presentShoes.has(shoe)) setShoe("All");
    }
  }, [features, type, year, shoe]);

  // Lookup for selection → feature
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

  // Apply filters (for map layers)
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
        setSelectedRunId(null); setSelectedFeature(null);
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
    setSelectedFeature(idToFeature.get(key) || null); // may be null if has_map=false
  }
  function clearSelection() {
    setSelectedRunId(null);
    setSelectedFeature(null);
  }

  // Sidebar: grab recent runs from index
  const last300 = useMemo(() => (indexData?.items || []).slice(0, 300), [indexData]);

  return (
    <div style={{ position: "fixed", inset: 0, display: "grid", gridTemplateRows: "auto 1fr", background: "#f8fafc", minWidth: 0, minHeight: 0 }}>
      <Header
        tab={tab}
        setTab={setTab}
        year={year} yearOptions={yearOptions} setYear={setYear}
        type={type} typeOptions={typeOptions} setType={setType}
        shoe={shoe} shoeOptions={shoeOptions} setShoe={setShoe}
        lineColorName={lineColorName} setLineColorName={setLineColorName}
        lineColors={lineColors}
        onFile={handleFile}
      />

      <div style={{ width: "100%", height: "100%", overflow: "hidden" }}>
        {tab === "map" ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `minmax(0, 1fr) ${SIDEBAR_WIDTH}px`,
              gap: 0,
              height: "100%",
              minHeight: 0,
            }}
          >
            {/* Map takes all remaining space */}
            <MapView
              filtered={filtered}
              lineColor={lineColor}
              selectedFeature={selectedFeature}
              highlightColor="#ff6a00"
            />

            {/* Right sidebar with sticky header inside component */}
            <RecentRunsList
              items={last300}
              selectedId={selectedRunId}
              onSelect={(id) => selectRun(id)}
              onClear={clearSelection}
              pageSize={50}
            />
          </div>
        ) : tab === "insights" ? (
          <InsightsView
            stats={stats}
            features={features}
            filtered={filtered}
            weeklyRange={weeklyRange}
            setWeeklyRange={setWeeklyRange}
          />
        ) : (
          <PersonalBestView pb={pb} features={features} />
        )}
      </div>
    </div>
  );
}
