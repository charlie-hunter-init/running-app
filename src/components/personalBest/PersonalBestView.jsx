import React from "react";
import { fmtDate } from "../../lib/geo";

// ------- small utils -------
function formatHMS(totalSeconds) {
  if (totalSeconds == null || !isFinite(totalSeconds)) return "—";
  const s = Math.round(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}

function formatPace(secPerKm) {
  if (!isFinite(secPerKm) || secPerKm <= 0) return "—";
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}/km`;
}

// Tiny polyline decoder (no extra deps)
function decodePolyline(str, precision = 5) {
  let index = 0, lat = 0, lng = 0, coordinates = [];
  const factor = Math.pow(10, precision);
  while (index < str.length) {
    let b, shift = 0, result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    const dlat = (result & 1) ? ~(result >> 1) : (result >> 1); lat += dlat;
    shift = 0; result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    const dlng = (result & 1) ? ~(result >> 1) : (result >> 1); lng += dlng;
    coordinates.push([lat / factor, lng / factor]); // [lat, lon]
  }
  return coordinates;
}

// Convert [lat,lon] array into an SVG path fit into width x height with padding
function svgPathFromLatLngs(latlngs, width, height, pad = 8) {
  if (!latlngs || !latlngs.length) return "";
  let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
  for (const [lat, lon] of latlngs) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  }
  const spanLon = Math.max(1e-9, maxLon - minLon);
  const spanLat = Math.max(1e-9, maxLat - minLat);
  const sx = (width - 2 * pad) / spanLon;
  const sy = (height - 2 * pad) / spanLat;
  const s = Math.min(sx, sy);
  const ox = pad - minLon * s;
  const oy = pad + maxLat * s; // y flips (lat downwards)
  // build path
  let d = "";
  for (let i = 0; i < latlngs.length; i++) {
    const [lat, lon] = latlngs[i];
    const x = lon * s + ox;
    const y = -lat * s + oy;
    d += (i === 0 ? "M" : "L") + x.toFixed(1) + "," + y.toFixed(1) + " ";
  }
  return d.trim();
}

// A tiny inline map preview
function MapPreview({ polyline, height = 180 }) {
  const containerStyle = {
    width: "100%",
    height,
    background: "#f8fafc",
    border: "1px solid #e5e7eb",
    borderRadius: 8,
  };
  if (!polyline) {
    return (
      <div style={{ ...containerStyle, display: "grid", placeItems: "center", color: "#64748b", fontSize: 13 }}>
        No map available for this activity (will appear after next sync)
      </div>
    );
  }
  let pathD = "";
  try {
    const pts = decodePolyline(polyline);
    pathD = svgPathFromLatLngs(pts, 800, height - 0); // viewBox will scale down proportionally
  } catch {
    // ignore
  }
  return (
    <div style={containerStyle}>
      <svg viewBox={`0 0 800 ${height}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
        <rect x="0" y="0" width="800" height={height} fill="none" />
        {pathD ? (
          <path
            d={pathD}
            fill="none"
            stroke="#0ea5e9"
            strokeWidth="3"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ) : (
          <text x="50%" y="50%" textAnchor="middle" fill="#64748b" fontSize="12">Unable to draw polyline</text>
        )}
      </svg>
    </div>
  );
}

// ------- main view -------
export default function PersonalBestView({ pb }) {
  const events = pb?.events || null;

  const cardStyle = { background: "#fff", border: "1px solid #eee", borderRadius: 8, padding: 12 };
  const tableHeader = { fontSize: 12, color: "#6b7280" };
  const title = { margin: 0, fontSize: 16 };

  if (!events) {
    return (
      <div style={{ height: "100%", overflow: "auto", padding: 16 }}>
        <div style={{ ...cardStyle }}>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Personal Bests</div>
          <div style={{ fontSize: 14, color: "#6b7280" }}>
            Loading <code>personal_bests.json</code>… (or none found yet)
          </div>
        </div>
      </div>
    );
  }

  const keys = ["hm", "10k", "5k", "1k"]; // display order
  const labels = { hm: "Half Marathon", "10k": "10K", "5k": "5K", "1k": "1K" };

  const PBCard = ({ k }) => {
    const e = events[k];
    const best = e?.top?.[0] || null;
    return (
      <div style={cardStyle}>
        <div style={{ ...tableHeader }}>{labels[k]} PB</div>
        <div style={{ fontSize: 22, fontWeight: 700 }}>
          {best ? formatHMS(best.elapsed_time_s) : "—"}
        </div>
        <div style={{ fontSize: 12, color: "#6b7280" }}>
          {best ? `${formatPace(best.pace_s_per_km)} • ${fmtDate(best.start_date)}` : `No ${labels[k]} PB yet`}
        </div>
      </div>
    );
  };

  // Table-with-disclosure per distance
  const Top3Table = ({ k }) => {
    const e = events[k];
    const rows = e?.top || [];
    const [openIdx, setOpenIdx] = React.useState(null);

    const toggle = (i) => setOpenIdx((cur) => (cur === i ? null : i));

    return (
      <div style={{ ...cardStyle }}>
        <h3 style={title}>{labels[k]}: Top 3</h3>
        {!rows.length ? (
          <div style={{ paddingTop: 4, color: "#6b7280" }}>No best efforts found.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr>
                  <th style={{ ...tableHeader, textAlign: "left", paddingBottom: 6 }}>Date</th>
                  <th style={{ ...tableHeader, textAlign: "left", paddingBottom: 6 }}>Time</th>
                  <th style={{ ...tableHeader, textAlign: "left", paddingBottom: 6 }}>Pace</th>
                  <th style={{ ...tableHeader, textAlign: "left", paddingBottom: 6 }}>Activity</th>
                  <th style={{ ...tableHeader, textAlign: "left", paddingBottom: 6 }}>Rank</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const isOpen = openIdx === i;
                  const hasMap = !!r?.map?.polyline;
                  return (
                    <React.Fragment key={`${r.activity_id}-${i}`}>
                      <tr
                        onClick={() => toggle(i)}
                        style={{
                          borderTop: "1px solid #f1f5f9",
                          cursor: "pointer",
                          background: isOpen ? "#f8fafc" : "transparent",
                        }}
                        title="Click to view map"
                      >
                        <td style={{ padding: "8px 0" }}>
                          <span style={{ marginRight: 6, display: "inline-block", width: 12 }}>
                            {isOpen ? "▾" : "▸"}
                          </span>
                          {fmtDate(r.start_date)}
                        </td>
                        <td style={{ padding: "8px 0" }}>{formatHMS(r.elapsed_time_s)}</td>
                        <td style={{ padding: "8px 0" }}>{formatPace(r.pace_s_per_km)}</td>
                        <td style={{ padding: "8px 0" }}>{r.activity_name || "—"}</td>
                        <td style={{ padding: "8px 0" }}>{r.pr_rank ? `#${r.pr_rank}` : "—"}</td>
                      </tr>

                      {isOpen && (
                        <tr>
                          <td colSpan={5} style={{ padding: "8px 0 0 0" }}>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
                              <MapPreview polyline={r?.map?.polyline || null} height={180} />
                              <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 180 }}>
                                <a
                                  href={`https://www.strava.com/activities/${r.activity_id}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  style={{
                                    textDecoration: "none",
                                    border: "1px solid #e5e7eb",
                                    borderRadius: 6,
                                    padding: "8px 10px",
                                    fontSize: 13,
                                    color: "#111827",
                                    background: "#fff",
                                  }}
                                >
                                  View on Strava ↗
                                </a>
                                <div style={{ fontSize: 12, color: "#6b7280" }}>
                                  Tip: Click the row again to collapse
                                </div>
                                {!hasMap && (
                                  <div style={{ fontSize: 12, color: "#ef4444" }}>
                                    No polyline yet — run the PB sync again to hydrate maps.
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ height: "100%", overflow: "auto", padding: 16 }}>
      {/* PB cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
          marginBottom: 16,
        }}
      >
        {keys.map((k) => (
          <PBCard key={k} k={k} />
        ))}
      </div>

      {/* Two-column layout for Top 3 tables */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {keys.map((k) => (
          <Top3Table key={`t-${k}`} k={k} />
        ))}
      </div>
    </div>
  );
}
