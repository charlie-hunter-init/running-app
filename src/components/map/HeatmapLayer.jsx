import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";

export default function HeatmapLayer({ points, radius = 8, blur = 12, maxZoom = 18, gradient }) {
  const map = useMap();
  const layerRef = useRef(null);

  useEffect(() => {
    if (!map) return;
    const ready = (map._loaded ?? true) && map.getSize && map.getSize().y > 0 && map.getSize().x > 0;
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

