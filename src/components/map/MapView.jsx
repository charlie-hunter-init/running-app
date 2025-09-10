import React from "react";
import { MapContainer, TileLayer, GeoJSON, LayersControl } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.heat"; // plugin
import HeatmapLayer from "./HeatmapLayer";
import FitToBounds from "./FitToBounds";
import MapInvalidateOnReady from "./MapInvalidateOnReady";

export default function MapView({ filtered, heatPoints, radius, blur, gradient, showLines, lineColor }) {
  return (
    <MapContainer style={{ width: "100%", height: "100%" }} center={[20, 0]} zoom={2} minZoom={2} worldCopyJump>
      <MapInvalidateOnReady />

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

      <HeatmapLayer points={heatPoints} radius={radius} blur={blur} gradient={gradient} />

      {showLines && filtered.length > 0 && (
        <GeoJSON key={`lines-${filtered.length}`} data={{ type: "FeatureCollection", features: filtered }} style={{ color: lineColor, weight: 1, opacity: 0.6 }} />
      )}

      <FitToBounds features={filtered} />
    </MapContainer>
  );
}

