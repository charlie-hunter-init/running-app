import React, { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, GeoJSON, useMap, LayersControl } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.heat";

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
    const s = f.properties?.shoe_name || f.properties?.gear_id;
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

// ---------- heat layer ----------
function HeatmapLayer({ points, radius = 8, blur = 12, maxZoom = 18, gradient }) {
  const map = useMap();
  const layerRef = useRef(null);

  useEffect(() => {
    if (!map) return;
    const ready =
      (map._loaded ?? true) &&
      map.getSize &&
      map.getSize().y > 0 &&
      map.getSize().x > 0;
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

// ---------- app ----------
export default function StravaHeatmapApp() {
  const [geojson, setGeojson] = useState(null);
  const [showLines, setShowLines] = useState(true); // ✅ lines ON by default
  const [radius, setRadius] = useState(8);
  const [blur, setBlur] = useState(12);
  const [year, setYear] = useState("All");
  const [type, setType] = useState("All");
  const [shoe, setShoe] = useState("All");

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
      White: "#ffffff",
    }),
    []
  );
  const [lineColorName, setLineColorName] = useState("White");
  const lineColor = lineColors[lineColorName];

  // Load default data
  useEffect(() => {
    fetch("/runs(s).geojson")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setGeojson(j))
      .catch(() => {});
  }, []);

  const features = geojson?.features || [];
  const yearOptions = useMemo(() => ["All", ...yearsFromFeatures(features)], [features]);
  const shoeOptions = useMemo(() => ["All", ...shoesFromFeatures(features)], [features]);
  const typeOptions = useMemo(() => ["All", ...typesFromFeatures(features)], [features]);

  const filtered = useMemo(() => {
    return features.filter((f) => {
      const p = f.properties || {};
      const y =
        p.year ||
        (p.start_date
          ? new Date(p.start_date).getUTCFullYear().toString()
          : null);
      const t = p.type || null;
      const s = p.shoe_name || p.gear_id || null;
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

  return (
    <div
      style={{
        height: "100vh",
        display: "grid",
        gridTemplateRows: "auto 1fr",
        background: "#f8fafc",
      }}
    >
      {/* Header */}
      <div
        style={{
          width: "100%",
          borderBottom: "1px solid #e5e7eb",
          background: "#fff",
          padding: "12px 16px",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 12,
        }}
      >
        <h1 style={{ fontSize: 20, fontWeight: 600, marginRight: "auto" }}>
          Strava Global Heatmap
        </h1>

        <label style={{ fontSize: 14 }}>
          Load GeoJSON
          <input
            type="file"
            accept=".json,.geojson,application/geo+json"
            onChange={handleFile}
            style={{ marginLeft: 8, fontSize: 14 }}
          />
        </label>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ fontSize: 14 }}>Year</label>
          <select
            value={year}
            onChange={(e) => setYear(e.target.value)}
            style={{ border: "1px solid #e5e7eb", borderRadius: 6, padding: "4px 8px", fontSize: 14 }}
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ fontSize: 14 }}>Type</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            style={{ border: "1px solid #e5e7eb", borderRadius: 6, padding: "4px 8px", fontSize: 14 }}
          >
            {typeOptions.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ fontSize: 14 }}>Shoe</label>
          <select
            value={shoe}
            onChange={(e) => setShoe(e.target.value)}
            style={{ border: "1px solid #e5e7eb", borderRadius: 6, padding: "4px 8px", fontSize: 14, maxWidth: 200 }}
          >
            {shoeOptions.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

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
          <select
            value={palette}
            onChange={(e) => setPalette(e.target.value)}
            style={{ border: "1px solid #e5e7eb", borderRadius: 6, padding: "4px 8px", fontSize: 14 }}
          >
            {Object.keys(gradients).map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        </div>

        {/* Line colour picker */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ fontSize: 14 }}>Line colour</label>
          <select
            value={lineColorName}
            onChange={(e) => setLineColorName(e.target.value)}
            style={{ border: "1px solid #e5e7eb", borderRadius: 6, padding: "4px 8px", fontSize: 14 }}
          >
            {Object.keys(lineColors).map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        </div>

        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14 }}>
          <input type="checkbox" checked={showLines} onChange={(e) => setShowLines(e.target.checked)} />
          Show lines
        </label>
      </div>

      {/* Map */}
      <div style={{ width: "100%", height: "100%" }}>
        <MapContainer style={{ width: "100%", height: "100%" }} center={[20, 0]} zoom={2} minZoom={2} worldCopyJump>
          <MapInvalidateOnReady />

          {/* ---- Base map switcher ---- */}
          <LayersControl position="topright">
            <LayersControl.BaseLayer name="OSM Standard">
              <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution="&copy; OpenStreetMap contributors"
              />
            </LayersControl.BaseLayer>

            {/* ✅ Default checked layer */}
            <LayersControl.BaseLayer checked name="Esri World Imagery (Satellite)">
              <TileLayer
                url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                attribution="Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community"
              />
            </LayersControl.BaseLayer>

            <LayersControl.BaseLayer name="Carto Positron (Light)">
              <TileLayer
                url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"
                attribution="&copy; OpenStreetMap contributors &copy; CARTO"
              />
            </LayersControl.BaseLayer>

            <LayersControl.BaseLayer name="Carto Dark Matter">
              <TileLayer
                url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"
                attribution="&copy; OpenStreetMap contributors &copy; CARTO"
              />
            </LayersControl.BaseLayer>

            <LayersControl.BaseLayer name="OSM Humanitarian">
              <TileLayer
                url="https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png"
                attribution="&copy; OpenStreetMap contributors, Humanitarian OpenStreetMap Team"
              />
            </LayersControl.BaseLayer>
          </LayersControl>

          {/* Heatmap */}
          <HeatmapLayer points={heatPoints} radius={radius} blur={blur} gradient={gradient} />

          {/* Optional lines (ON by default) */}
          {showLines && filtered.length > 0 && (
            <GeoJSON
              key={`lines-${filtered.length}`}
              data={{ type: "FeatureCollection", features: filtered }}
              style={{ color: lineColor, weight: 1, opacity: 0.6 }}
            />
          )}

          {/* Fit map to data */}
          <FitToBounds features={filtered} />
        </MapContainer>
      </div>
    </div>
  );
}
