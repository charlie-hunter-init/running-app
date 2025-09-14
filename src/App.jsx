import React, { useEffect, useMemo, useState } from "react";
import { linesToHeatPoints, yearsFromFeatures, shoesFromFeatures, typesFromFeatures } from "./lib/geo";
import Header from "./components/ui/Header";
import MapView from "./components/map/MapView";
import InsightsView from "./components/insights/InsightsView";
import PersonalBestView from "./components/personalBest/PersonalBestView";
import RecentRunsList from "./components/runs/RecentRunsList"; // uses runs_index.json

export default function StravaHeatmapApp() {
  // "map" | "insights" | "pb"
  const [tab, setTab] = useState("map");

  const [geojson, setGeojson] = useState(null);
  const [stats, setStats] = useState(null);
  const [pb, setPb] = useState(null);
  const [indexData, setIndexData] = useState(null); // ← runs_index.json

  const [showLines, setShowLines] = useState(true);
  const [radius, setRadius] = useState(8);
  const [blur, setBlur] = useState(12);

  const [year, setYear] = useState("All");
  const [type, setType] = useState("Run");
  const [shoe, setShoe] = useState("All");

  const [weeklyRange, setWeeklyRange] = useState("all");

  const gradients = React.useMemo(
    () => ({
      "Red→Orange→Yellow": { 0.0: "#ff0000", 0.5: "#ff7f00", 1.0: "#ffff00" },
      "Yellow→Orange→Red": { 0.0: "#ffff00", 0.5: "#ff7f00", 1.0: "#ff0000" },
      "Blue→Lime→Red": { 0.4: "blue", 0.65: "lime", 1.0: "red" },
      "Purple→Pink→Yellow": { 0.0: "#6b21a8", 0.5: "#ec4899", 1.0: "#fde047" },
      Grayscale: { 0.4: "#444", 0.65: "#888", 1.0: "#ccc" },
    }),
    []
  );
  const [palette, setPalette] = useState("Grayscale");
  const gradient = gradients[palette];

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

  // Selection state (for highlight-on-map)
  const [selectedRunId, setSelectedRunId] = useState(null);
  const [selectedFeature, setSelectedFeature] = useState(null);

  // Load data
  useEffect(() => {
    fetch("/runs.geojson").then(r => (r.ok ? r.json() : null)).then(j => j && setGeojson(j)).catch(() => {});
    fetch("/stats.json").then(r => (r.ok ? r.json() : null)).then(s => s && setStats(s)).catch(() => {});
    fetch("/personal_bests.json").then(r => (r.ok ? r.json() : null)).then(p => p && setPb(p)).catch(() => {});
    fetch("/runs_index.json").then(r => (r.ok ? r.json() : null)).then(idx => idx && setIndexData(idx)).catch(() => {});
  }, []);

  const features = geojson?.features || [];
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

  // Map filters (apply only to map layers; the list uses indexData)
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

  // Heatmap reflects ALL currently filtered runs, regardless of selection
  const heatPoints = useMemo(() => linesToHeatPoints(filtered, 1), [filtered]);

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

  // When a list item is clicked, highlight the map feature if present
  function selectRun(id) {
    const key = String(id);
    setSelectedRunId(key);
    setSelectedFeature(idToFeature.get(key) || null); // may be null if has_map=false
  }
  function clearSelection() {
    setSelectedRunId(null);
    setSelectedFeature(null);
  }

  // Sidebar items: cap to 30 from runs_index.json (already sorted newest → oldest)
  const last100 = useMemo(() => {
    const items = indexData?.items || [];
    return items.slice(0, 100);
  }, [indexData]);

  return (
    <div style={{ height: "100vh", display: "grid", gridTemplateRows: "auto 1fr", background: "#f8fafc" }}>
      <Header
        tab={tab}
        setTab={setTab}
        year={year} yearOptions={yearOptions} setYear={setYear}
        type={type} typeOptions={typeOptions} setType={setType}
        shoe={shoe} shoeOptions={shoeOptions} setShoe={setShoe}
        radius={radius} setRadius={setRadius}
        blur={blur} setBlur={setBlur}
        palette={palette} setPalette={setPalette}
        gradients={gradients}
        lineColorName={lineColorName} setLineColorName={setLineColorName}
        lineColors={lineColors}
        showLines={showLines} setShowLines={setShowLines}
      />

      <div style={{ width: "100%", height: "100%", overflow: "hidden" }}>
        {tab === "map" ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", height: "100%" }}>
            <MapView
              filtered={filtered}
              heatPoints={heatPoints}
              radius={radius}
              blur={blur}
              gradient={gradient}
              showLines={showLines}
              lineColor={lineColor}
              selectedFeature={selectedFeature}     // highlight on map (may be null if no geometry)
              highlightColor="#ff6a00"
            />

            <RecentRunsList
              items={last100}                 // ← use runs_index.json (stats source)
              selectedId={selectedRunId}
              onSelect={(id) => selectRun(id)}
              onClear={clearSelection}
              pageSize={10}                  // ← paginate 10 at a time
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
          <PersonalBestView
            pb={pb}
            features={features}
          />
        )}
      </div>
    </div>
  );
}
