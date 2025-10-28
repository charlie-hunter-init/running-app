import React, { useEffect, useMemo, useState } from "react";
import { yearsFromFeatures, shoesFromFeatures, typesFromFeatures } from "./lib/geo";
import Header from "./components/ui/Header";
import MapView from "./components/map/MapView";
import InsightsView from "./components/insights/InsightsView";
import PersonalBestView from "./components/personalBest/PersonalBestView";
import RecentRunsList from "./components/runs/RecentRunsList";
import CalendarView from "./components/calendar/CalendarView"; // NEW

const SIDEBAR_WIDTH = 340; // keep the map big

export default function StravaHeatmapApp() {
  const [tab, setTab] = useState("map"); // values: map | insights | calendar | pb

  const [geojson, setGeojson] = useState(null);
  const [stats, setStats] = useState(null);
  const [pb, setPb] = useState(null);
  const [indexData, setIndexData] = useState(null);

  // Filters
  const [year, setYear] = useState("All");
  const [type, setType] = useState("All");
  const [shoe, setShoe] = useState("All");
  const [weeklyRange, setWeeklyRange] = useState("all");

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
    fetch("/runs.geojson").then(r => (r.ok ? r.json() : null)).then(j => j && setGeojson(j)).catch(() => {});
    fetch("/stats.json").then(r => (r.ok ? r.json() : null)).then(s => s && setStats(s)).catch(() => {});
    fetch("/personal_bests.json").then(r => (r.ok ? r.json() : null)).then(p => p && setPb(p)).catch(() => {});
    fetch("/runs_index.json").then(r => (r.ok ? r.json() : null)).then(idx => idx && setIndexData(idx)).catch(() => {});
  }, []);

  const features = geojson?.features || [];

  // Safety: relax filters if they eliminate everything
  useEffect(() => {
    if (!features.length) return;
    if (type !== "All") {
      const present = new Set(features.map(f => f?.properties?.type).filter(Boolean));
      if (!present.has(type)) setType("All");
    }
    if (year !== "All") {
      const present = new Set(
        features
          .map(f => {
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
          .map(f => {
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

  const last1000 = useMemo(() => (indexData?.items || []).slice(0, 1000), [indexData]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "grid",
        gridTemplateRows: "auto 1fr",
        background: "#f8fafc",
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
            <MapView
              filtered={filtered}
              lineColor={lineColor}
              selectedFeature={selectedFeature}
              highlightColor="#ff6a00"
              selectedKm={selectedKm}
              selectedKmColor="#3b82f6"
            />
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
            items={indexData?.items || []}
          />
        ) : (
          <PersonalBestView pb={pb} features={features} />
        )}
      </div>
    </div>
  );
}
