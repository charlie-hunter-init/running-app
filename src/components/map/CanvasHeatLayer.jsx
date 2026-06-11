import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";

/**
 * Strava-style heatmap using Leaflet's own L.canvas() renderer.
 *
 * Rendered into a named pane (heat-lines, z:420) so the selected-run
 * overlay panes (z:500+) are always on top purely via CSS z-index —
 * no bringToFront(), no paint-order fragility.
 *
 * gradient: { r, g, b, alpha }
 */

const DEFAULT_GRADIENT = { r: 255, g: 160, b: 20, alpha: 0.35 };

function gradientToStyle(gradient) {
  const { r, g, b, alpha } = gradient || DEFAULT_GRADIENT;
  return {
    color: `rgb(${r},${g},${b})`,
    weight: 2.5,
    opacity: alpha,
    smoothFactor: 1.0,
  };
}

export default function CanvasHeatLayer({ features, gradient, pane = "overlayPane", rendererRef }) {
  const map = useMap();
  const layerRef = useRef(null);
  const prevLenRef = useRef(0);

  // Mount: create renderer lazily (pane is guaranteed to exist by SetupPanes),
  // then create the geoJSON layer.
  useEffect(() => {
    if (!map) return;

    // Create renderer into the correct pane on first use
    if (!rendererRef.current) {
      rendererRef.current = L.canvas({ pane });
    }

    const style = gradientToStyle(gradient);
    const layer = L.geoJSON(
      { type: "FeatureCollection", features: [] },
      {
        pane,
        style,
        interactive: false,
        renderer: rendererRef.current,
        smoothFactor: 1.0,
      }
    );

    layer.addTo(map);
    layerRef.current = layer;
    prevLenRef.current = 0;

    return () => {
      try { layer.remove(); } catch {}
      layerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, pane]);

  // Update style when gradient changes
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.setStyle(gradientToStyle(gradient));
  }, [gradient]);

  // Incremental feature updates — append-only when growing, full rebuild otherwise
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;

    const newLen = features.length;
    const prevLen = prevLenRef.current;

    try {
      if (newLen > prevLen) {
        const delta = features.slice(prevLen);
        if (delta.length) {
          layer.addData({ type: "FeatureCollection", features: delta });
        }
      } else {
        layer.clearLayers();
        if (newLen) {
          layer.addData({ type: "FeatureCollection", features });
        }
      }
      prevLenRef.current = newLen;
    } catch {
      // swallow Leaflet errors
    }
  }, [features]);

  return null;
}
