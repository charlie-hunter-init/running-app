import React, { useMemo, useRef, useEffect } from "react";
import { MapContainer, TileLayer, GeoJSON, LayersControl, Pane, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.heat"; // plugin
import HeatmapLayer from "./HeatmapLayer";
import FitToBounds from "./FitToBounds";
import MapInvalidateOnReady from "./MapInvalidateOnReady";

function haversineMeters(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const [lng1, lat1] = a, [lng2, lat2] = b;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const s =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.sqrt(s));
}

function interpolate(a, b, t) {
  const [lng1, lat1] = a, [lng2, lat2] = b;
  return [lng1 + (lng2 - lng1) * t, lat1 + (lat2 - lat1) * t];
}

function sliceLineByDistance(coords, fromM, toM) {
  if (!Array.isArray(coords) || coords.length < 2) return null;
  if (toM <= fromM) return null;
  let acc = 0;
  const out = [];
  let started = false;
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i];
    const b = coords[i + 1];
    const segLen = haversineMeters(a, b);
    const nextAcc = acc + segLen;

    if (nextAcc > fromM && acc < toM) {
      let startPt;
      if (!started) {
        if (fromM <= acc) startPt = a;
        else {
          const t = (fromM - acc) / segLen;
          startPt = interpolate(a, b, t);
        }
        out.push(startPt);
        started = true;
      }
      if (toM <= nextAcc) {
        const t2 = (toM - acc) / segLen;
        out.push(interpolate(a, b, t2));
        break;
      } else {
        out.push(b);
      }
    }
    acc = nextAcc;
  }
  return out.length >= 2 ? out : null;
}

/**
 * Base runs layer implemented as an imperative Leaflet layer.
 * This avoids react-leaflet <GeoJSON> reconciliation issues during high-frequency updates.
 */
function BaseRunsLayer({ features, style, renderer, pane }) {
  const map = useMap();
  const layerRef = useRef(null);
  const prevLenRef = useRef(0);

  // Create layer once
  useEffect(() => {
    const layer = L.geoJSON(
      { type: "FeatureCollection", features: [] },
      {
        pane,
        style,
        interactive: false,
        smoothFactor: 1.0,
        renderer,
      }
    );

    layer.addTo(map);
    try {
      layer.bringToFront();
    } catch {}

    layerRef.current = layer;
    prevLenRef.current = 0;

    return () => {
      try {
        layer.remove();
      } catch {}
      layerRef.current = null;
    };
  }, [map, pane, renderer, style]);

  // Update style when it changes (eg line colour picker)
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    try {
      layer.setStyle(style);
    } catch {}
  }, [style]);

  // Incremental update of data
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;

    const newLen = features.length;
    const prevLen = prevLenRef.current;

    try {
      if (newLen > prevLen) {
        // append-only delta
        const delta = features.slice(prevLen);
        if (delta.length) {
          layer.addData({ type: "FeatureCollection", features: delta });
        }
      } else {
        // scrub backwards / filter changes: rebuild once
        layer.clearLayers();
        if (newLen) {
          layer.addData({ type: "FeatureCollection", features });
        }
      }

      prevLenRef.current = newLen;
      try {
        layer.bringToFront();
      } catch {}
    } catch {
      // swallow Leaflet errors so the map doesn't blank
    }
  }, [features]);

  return null;
}

export default function MapView({
  filtered,
  heatPoints,
  radius,
  blur,
  gradient,
  lineColor,
  selectedFeature,
  highlightColor = "#ff6a00",
  selectedKm = null,
  selectedKmColor = "#60a5fa",
  suppressFit = false,
}) {
  // One stable renderer instance
  const canvasRenderer = useMemo(() => L.canvas(), []);

  // Styles
  const baseStyle = useMemo(() => ({ color: lineColor, weight: 1, opacity: 0.5 }), [lineColor]);
  const hiStyle = useMemo(() => ({ color: highlightColor, weight: 4, opacity: 0.98 }), [highlightColor]);
  const kmStyle = useMemo(
    () => ({ color: selectedKmColor, weight: 7, opacity: 1, lineJoin: "round", lineCap: "round" }),
    [selectedKmColor]
  );

  // Selected overlay data
  const selectedGeojsonData = useMemo(
    () => (selectedFeature ? { type: "FeatureCollection", features: [selectedFeature] } : null),
    [selectedFeature]
  );

  // Derived: selected km segment
  const selectedKmFeature = useMemo(() => {
    if (!selectedFeature || !selectedKm) return null;
    const g = selectedFeature.geometry || {};
    const type = g.type;
    const coords =
      type === "LineString"
        ? g.coordinates
        : type === "MultiLineString"
          ? g.coordinates.flat()
          : null;
    if (!coords) return null;

    const fromM = (selectedKm - 1) * 1000;
    const toM = selectedKm * 1000;
    const sub = sliceLineByDistance(coords, fromM, toM);
    if (!sub) return null;

    return {
      type: "Feature",
      properties: { id: selectedFeature?.properties?.id, km: selectedKm },
      geometry: { type: "LineString", coordinates: sub },
    };
  }, [selectedFeature, selectedKm]);

  // Selection clear behaviour
  const selectedId = selectedFeature?.properties?.id ?? null;
  const prevSelectedIdRef = useRef(null);
  const clearedSelection = prevSelectedIdRef.current != null && selectedId == null;
  useEffect(() => {
    prevSelectedIdRef.current = selectedId;
  }, [selectedId]);

  const fitFeatures = useMemo(() => {
    if (suppressFit) return [];
    if (clearedSelection) return [];
    if (selectedKmFeature) return [selectedKmFeature];
    return selectedFeature ? [selectedFeature] : filtered;
  }, [suppressFit, clearedSelection, selectedKmFeature, selectedFeature, filtered]);

  const selectedKeyId = selectedId ?? "none";

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

      {/* Heatmap */}
      <Pane name="heat" style={{ zIndex: 300 }} />
      <HeatmapLayer pane="heat" points={heatPoints} radius={radius} blur={blur} gradient={gradient} />

      {/* Base lines */}
      <Pane name="base-lines" style={{ zIndex: 1000 }} />
      <BaseRunsLayer
        features={filtered}
        style={baseStyle}
        renderer={canvasRenderer}
        pane="base-lines"
      />

      {/* Selected overlay */}
      <Pane name="selected-line" style={{ zIndex: 1100 }} />
      {selectedGeojsonData && (
        <GeoJSON
          key={`selected-${selectedKeyId}`}
          pane="selected-line"
          data={selectedGeojsonData}
          style={hiStyle}
          renderer={canvasRenderer}
          interactive={false}
          smoothFactor={0}
          whenCreated={(layer) => {
            try { layer.bringToFront(); } catch {}
          }}
        />
      )}

      {/* Selected KM overlay */}
      <Pane name="selected-km" style={{ zIndex: 1150 }} />
      {selectedKmFeature && (
        <GeoJSON
          key={`selected-km-${selectedKeyId}-${selectedKm}`}
          pane="selected-km"
          data={{ type: "FeatureCollection", features: [selectedKmFeature] }}
          style={kmStyle}
          renderer={canvasRenderer}
          interactive={false}
          smoothFactor={0}
          whenCreated={(layer) => {
            try { layer.bringToFront(); } catch {}
          }}
        />
      )}

      <FitToBounds features={fitFeatures} maxZoom={14} />
    </MapContainer>
  );
}
