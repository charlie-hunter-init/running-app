import React, { useMemo } from "react";
import { MapContainer, TileLayer, GeoJSON, LayersControl, Pane } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.heat"; // plugin
import HeatmapLayer from "./HeatmapLayer";
import FitToBounds from "./FitToBounds";
import MapInvalidateOnReady from "./MapInvalidateOnReady";

export default function MapView({
  filtered,
  heatPoints,
  radius,
  blur,
  gradient,
  showLines,
  lineColor,
  selectedFeature,
  highlightColor = "#ff6a00",
}) {
  // Split visible features into base vs selected
  const { baseFeatures, selectedOnly } = useMemo(() => {
    if (!selectedFeature) return { baseFeatures: filtered, selectedOnly: [] };
    const base = filtered.filter((f) => f !== selectedFeature);
    return { baseFeatures: base, selectedOnly: [selectedFeature] };
  }, [filtered, selectedFeature]);

  const baseStyle = useMemo(() => ({ color: lineColor, weight: 1, opacity: 0.4 }), [lineColor]);
  const hiStyle = useMemo(() => ({ color: highlightColor, weight: 4, opacity: 0.95 }), [highlightColor]);

  // Use the selected feature's id in the key to force a clean remount on change
  const selectedId = selectedOnly[0]?.properties?.id ?? "none";

  return (
    <MapContainer
      style={{ width: "100%", height: "100%" }}
      center={[20, 0]}
      zoom={2}
      minZoom={2}
      worldCopyJump
      preferCanvas={true}
      wheelDebounceTime={40}
      updateWhenZooming={false}
      updateWhenIdle={true}
    >
      <MapInvalidateOnReady />

      <LayersControl position="topright">
        <LayersControl.BaseLayer name="OSM Standard">
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution="&copy; OpenStreetMap contributors"
          />
        </LayersControl.BaseLayer>

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

      {/* Heatmap over all filtered runs */}
      <HeatmapLayer points={heatPoints} radius={radius} blur={blur} gradient={gradient} />

      {/* Base lines in a lower z-index pane — Canvas + non-interactive */}
      <Pane name="base-lines" style={{ zIndex: 450 }} />
      {showLines && baseFeatures.length > 0 && (
        <GeoJSON
          key="base-lines" // keep stable for perf
          pane="base-lines"
          data={{ type: "FeatureCollection", features: baseFeatures }}
          style={baseStyle}
          renderer={L.canvas()}
          interactive={false}
          smoothFactor={1.0}
        />
      )}

      {/* Selected run on top in bright orange — force remount when id changes */}
      <Pane name="selected-line" style={{ zIndex: 650 }} />
      {showLines && selectedOnly.length === 1 && (
        <GeoJSON
          key={`selected-${selectedId}`} // ← remount on selection change
          pane="selected-line"
          data={{ type: "FeatureCollection", features: selectedOnly }}
          style={hiStyle}
          renderer={L.canvas()}
          interactive={false}
          smoothFactor={0}
        />
      )}

      {/* Auto-zoom: selected feature if present, else all filtered */}
      <FitToBounds
        features={selectedOnly.length ? selectedOnly : filtered}
        maxZoom={14}
      />
    </MapContainer>
  );
}
