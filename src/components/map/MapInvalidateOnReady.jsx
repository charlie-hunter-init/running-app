import { useEffect } from "react";
import { useMap } from "react-leaflet";

export default function MapInvalidateOnReady() {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    map.whenReady(() => {
      setTimeout(() => map.invalidateSize(), 0);
    });
  }, [map]);
  return null;
}

