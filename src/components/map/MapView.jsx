import React, { useMemo, useRef, useEffect } from "react";
import { MapContainer, TileLayer, GeoJSON, LayersControl, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import CanvasHeatLayer from "./CanvasHeatLayer";
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
 * Creates custom panes once when the map is ready.
 * Using createPane() imperatively avoids the react-leaflet <Pane>
 * re-registration bug that occurs when the map tab remounts.
 */
function SetupPanes() {
  const map = useMap();
  useEffect(() => {
    const panes = [
      { name: "heat-lines",    z: 420 },
      { name: "line-mode",     z: 420 },
      { name: "selected-line", z: 500 },
      { name: "selected-km",   z: 510 },
    ];
    for (const { name, z } of panes) {
      if (!map.getPane(name)) {
        const pane = map.createPane(name);
        pane.style.zIndex = z;
        // Panes that hold canvas layers must not intercept pointer events
        pane.style.pointerEvents = "none";
      }
    }
  }, [map]);
  return null;
}

/**
 * Plain line layer — same incremental pattern as CanvasHeatLayer but
 * renders flat opaque lines for "line mode".
 */
function LineLayer({ features, style, pane, rendererRef }) {
  const map = useMap();
  const layerRef = useRef(null);
  const prevLenRef = useRef(0);

  useEffect(() => {
    if (!map) return;
    if (!rendererRef.current) {
      rendererRef.current = L.canvas({ pane });
    }
    const layer = L.geoJSON(
      { type: "FeatureCollection", features: [] },
      { pane, style, interactive: false, renderer: rendererRef.current, smoothFactor: 1.0 }
    );
    layer.addTo(map);
    layerRef.current = layer;
    prevLenRef.current = 0;
    return () => { try { layer.remove(); } catch {} layerRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, pane]);

  useEffect(() => {
    layerRef.current?.setStyle(style);
  }, [style]);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const newLen = features.length;
    const prevLen = prevLenRef.current;
    try {
      if (newLen > prevLen) {
        const delta = features.slice(prevLen);
        if (delta.length) layer.addData({ type: "FeatureCollection", features: delta });
      } else {
        layer.clearLayers();
        if (newLen) layer.addData({ type: "FeatureCollection", features });
      }
      prevLenRef.current = newLen;
    } catch {}
  }, [features]);

  return null;
}

export default function MapView({
  filtered,
  heatGradient,
  lineMode = false,
  lineColor = "#ffffff",
  selectedFeature,
  highlightColor = "#ff6a00",
  selectedKm = null,
  selectedKmColor = "#60a5fa",
  suppressFit = false,
}) {
  const heatRendererRef   = useRef(null);
  const lineRendererRef   = useRef(null);
  const selectRendererRef = useRef(null);
  const kmRendererRef     = useRef(null);

  const lineStyle = useMemo(
    () => ({ color: lineColor, weight: 1.5, opacity: 0.7, smoothFactor: 1.0 }),
    [lineColor]
  );

  // Styles
  const hiStyle = useMemo(
    () => ({ color: highlightColor, weight: 4, opacity: 0.98 }),
    [highlightColor]
  );
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

      {/* Create panes before any layers are added */}
      <SetupPanes />

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

      {/* Routes layer — heat mode or plain line mode */}
      {lineMode ? (
        <LineLayer
          features={filtered}
          style={lineStyle}
          pane="line-mode"
          rendererRef={lineRendererRef}
        />
      ) : (
        <CanvasHeatLayer
          features={filtered}
          gradient={heatGradient}
          pane="heat-lines"
          rendererRef={heatRendererRef}
        />
      )}

      {/* Selected run — rendered into selected-line pane (z:500), always above heatmap */}
      {selectedGeojsonData && (
        <SelectedLayer
          key={`selected-${selectedKeyId}`}
          data={selectedGeojsonData}
          style={hiStyle}
          pane="selected-line"
          rendererRef={selectRendererRef}
        />
      )}

      {/* Selected km — rendered into selected-km pane (z:510) */}
      {selectedKmFeature && (
        <SelectedLayer
          key={`selected-km-${selectedKeyId}-${selectedKm}`}
          data={{ type: "FeatureCollection", features: [selectedKmFeature] }}
          style={kmStyle}
          pane="selected-km"
          rendererRef={kmRendererRef}
        />
      )}

      <FitToBounds features={fitFeatures} maxZoom={14} />
    </MapContainer>
  );
}

/**
 * Renders a GeoJSON layer into a named pane using an L.canvas() renderer.
 * Gets or creates its renderer lazily so the pane is guaranteed to exist first.
 */
function SelectedLayer({ data, style, pane, rendererRef }) {
  const map = useMap();
  const layerRef = useRef(null);

  useEffect(() => {
    if (!map) return;

    // Get or create the renderer for this pane
    if (!rendererRef.current) {
      rendererRef.current = L.canvas({ pane });
    }

    const layer = L.geoJSON(data, {
      pane,
      style,
      interactive: false,
      smoothFactor: 0,
      renderer: rendererRef.current,
    });

    layer.addTo(map);
    layerRef.current = layer;

    return () => {
      try { layer.remove(); } catch {}
      layerRef.current = null;
    };
  // Re-run when data or style changes (key prop handles run switches)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, data, style, pane]);

  return null;
}
