import { useEffect } from "react";
import { useMap } from "react-leaflet";
import { computeBoundsFromFeatures } from "../../lib/geo";

export default function FitToBounds({ features }) {
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

