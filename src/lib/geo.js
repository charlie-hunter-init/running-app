import L from "leaflet";

export function flattenLineCoords(feature) {
  if (!feature || feature.type !== "Feature") return [];
  const geom = feature.geometry;
  if (!geom) return [];
  if (geom.type === "LineString") return geom.coordinates;
  if (geom.type === "MultiLineString") return geom.coordinates.flat();
  return [];
}

export function computeBoundsFromFeatures(features) {
  const bounds = L.latLngBounds([]);
  for (const f of features) {
    const lonlat = flattenLineCoords(f);
    for (const [lon, lat] of lonlat) bounds.extend([lat, lon]);
  }
  return bounds.isValid() ? bounds : null;
}

export function yearsFromFeatures(features) {
  const set = new Set();
  for (const f of features) {
    const y = f.properties?.year || (f.properties?.start_date ? new Date(f.properties.start_date).getUTCFullYear().toString() : null);
    if (y) set.add(y);
  }
  return [...set].sort();
}

export function shoesFromFeatures(features) {
  const set = new Set();
  for (const f of features) {
    const s = f.properties?.shoe_name || f.properties?.gear_name || f.properties?.gear_id;
    if (s) set.add(s);
  }
  return [...set].sort();
}

export function typesFromFeatures(features) {
  const set = new Set();
  for (const f of features) {
    const t = f.properties?.type;
    if (t) set.add(t);
  }
  return [...set].sort();
}

export function linesToHeatPoints(features, sampleEvery = 1) {
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

export function km(m) { return (m / 1000).toFixed(1); }
export function fmtDate(iso) { return (iso || "").slice(0, 10); }

