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
  lineColor,
  selectedFeature,
  highlightColor = "#ff6a00",
}) {
  // Base data = all filtered runs
  const baseGeojsonData = useMemo(
    () => ({ type: "FeatureCollection", features: filtered }),
    [filtered]
  );

  // Selected overlay = only the chosen run
  const selectedGeojsonData = useMemo(
    () => (selectedFeature ? { type: "FeatureCollection", features: [selectedFeature] } : null),
    [selectedFeature]
  );

  // Force base layer to remount whenever 'filtered' changes (e.g., after fetch)
  const baseKey = useMemo(() => {
    const len = filtered.length;
    const firstId = len ? (filtered[0]?.properties?.id ?? "a") : "x";
    const lastId  = len ? (filtered[len - 1]?.properties?.id ?? "b") : "y";
    return `base-${len}-${firstId}-${lastId}`;
  }, [filtered]);

  const selectedId = selectedFeature?.properties?.id ?? "none";

  // Line styles
  const baseStyle = useMemo(() => ({ color: lineColor, weight: 1, opacity: 0.5 }), [lineColor]);
  const hiStyle   = useMemo(() => ({ color: highlightColor, weight: 4,   opacity: 0.98 }), [highlightColor]);

  return (
    <MapContainer
      style={{ width: "100%", height: "100%" }}
      center={[20, 0]}
      zoom={2}
      minZoom={2}
      worldCopyJump
      preferCanvas={true}        // Canvas = fewer DOM nodes, faster
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

      {/* Heatmap: dedicated low-z pane */}
      <Pane name="heat" style={{ zIndex: 300 }} />
      <HeatmapLayer
        pane="heat"               // If your HeatmapLayer forwards this to L.heatLayer options
        points={heatPoints}
        radius={radius}
        blur={blur}
        gradient={gradient}
      />

      {/* Base lines: very high z, always on top of heat */}
      <Pane name="base-lines" style={{ zIndex: 1000 }} />
      {filtered.length > 0 && (
        <GeoJSON
          key={baseKey}
          pane="base-lines"
          data={baseGeojsonData}
          style={baseStyle}
          renderer={L.canvas()}
          interactive={false}
          smoothFactor={1.0}
          whenCreated={(layer) => {
            try { layer.bringToFront(); } catch {}
          }}
        />
      )}

      {/* Selected overlay: highest of all */}
      <Pane name="selected-line" style={{ zIndex: 1100 }} />
      {selectedGeojsonData && (
        <GeoJSON
          key={`selected-${selectedId}`}
          pane="selected-line"
          data={selectedGeojsonData}
          style={hiStyle}
          renderer={L.canvas()}
          interactive={false}
          smoothFactor={0}
          whenCreated={(layer) => {
            try { layer.bringToFront(); } catch {}
          }}
        />
      )}

      {/* Fit to selected if present; else fit to all */}
      <FitToBounds
        features={selectedFeature ? [selectedFeature] : filtered}
        maxZoom={14}
      />
    </MapContainer>
  );
}
