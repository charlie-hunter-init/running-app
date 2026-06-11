import React, { useMemo, useState, useCallback, useEffect } from "react";

// ---------- format helpers ----------
function metersToKm(m) { if (m == null) return ""; return (m / 1000).toFixed(2); }
function formatPace(secondsPerKm) {
  if (!secondsPerKm || !isFinite(secondsPerKm)) return "";
  const m = Math.floor(secondsPerKm / 60);
  const s = Math.round(secondsPerKm % 60);
  return `${m}:${s.toString().padStart(2, "0")}/km`;
}
function formatDuration(sec) {
  if (sec == null) return "";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0
    ? `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
    : `${m}:${s.toString().padStart(2, "0")}`;
}
function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch { return ""; }
}
function formatElevation(m) { if (m == null) return ""; return `${Math.round(m)} m`; }

// ---------- geometry helpers ----------
function haversineMeters(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const [lng1, lat1] = a, [lng2, lat2] = b;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * Given a GeoJSON feature, compute per-km splits using the line geometry.
 * Returns [{ km, distanceM, elapsedM }] where elapsedM is metres walked so far.
 * Pace cannot be derived from geometry alone (no time data), so it's omitted.
 */
function computeGeomSplits(feature) {
  const geom = feature?.geometry;
  if (!geom) return [];
  const coords =
    geom.type === "LineString"
      ? geom.coordinates
      : geom.type === "MultiLineString"
      ? geom.coordinates.flat()
      : null;
  if (!coords || coords.length < 2) return [];

  let totalM = 0;
  const cumulative = [0]; // cumulative distance at each coord index
  for (let i = 1; i < coords.length; i++) {
    totalM += haversineMeters(coords[i - 1], coords[i]);
    cumulative.push(totalM);
  }

  const splits = [];
  const fullKms = Math.floor(totalM / 1000);
  const numSplits = fullKms + (totalM % 1000 > 50 ? 1 : 0); // include partial last km if > 50m

  for (let k = 1; k <= numSplits; k++) {
    const fromM = (k - 1) * 1000;
    const toM = Math.min(k * 1000, totalM);
    splits.push({ km: k, distanceM: Math.round(toM - fromM) });
  }

  return splits;
}

const LONG_RUN_SECONDS = 70 * 60; // 1h10m
const WORKOUT_PACE_S_PER_KM = 250; // faster than 4:10/km
const WALK_PACE_S_PER_KM = 9 * 60; // > 9:00/km is a walk

// ---------- kind theme ----------
const KIND_THEME = {
  walk: {
    label: "walk",
    bg:
      "linear-gradient(135deg, rgba(59,130,246,0.18) 0%, rgba(14,165,233,0.10) 55%, rgba(0,0,0,0.15) 100%)",
    border: "rgba(147,197,253,0.45)",
    strip: "#60a5fa",
    text: "#dbeafe",
  },
  workout: {
    label: "workout",
    bg:
      "linear-gradient(135deg, rgba(244,63,94,0.18) 0%, rgba(248,113,113,0.10) 55%, rgba(0,0,0,0.15) 100%)",
    border: "rgba(252,165,165,0.45)",
    strip: "#fb7185",
    text: "#fee2e2",
  },
  long: {
    label: "long",
    bg:
      "linear-gradient(135deg, rgba(245,158,11,0.20) 0%, rgba(251,191,36,0.10) 55%, rgba(0,0,0,0.15) 100%)",
    border: "rgba(253,224,71,0.45)",
    strip: "#f59e0b",
    text: "#fef3c7",
  },
  jog: {
    label: "jog",
    bg:
      "linear-gradient(135deg, rgba(16,185,129,0.18) 0%, rgba(52,211,153,0.10) 55%, rgba(0,0,0,0.15) 100%)",
    border: "rgba(167,243,208,0.35)",
    strip: "#34d399",
    text: "#dcfce7",
  },
  tread: {
    label: "🏃 treadmill",
    bg:
      "linear-gradient(135deg, rgba(236,72,153,0.18) 0%, rgba(244,114,182,0.10) 55%, rgba(0,0,0,0.15) 100%)",
    border: "rgba(249,168,212,0.45)",
    strip: "#f472b6",
    text: "#fce7f3",
  },
};

// ---------- styles ----------
const styles = {
  aside: {
    height: "100%",
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    borderLeft: "1px solid rgba(255,255,255,0.08)",
    background:
      "linear-gradient(180deg, rgba(9,11,20,0.98) 0%, rgba(10,14,28,0.98) 100%)",
    color: "#e5e7eb",
  },

  stickyHeader: {
    position: "sticky",
    top: 0,
    zIndex: 5,
    padding: "10px 12px 12px",
    background:
      "linear-gradient(180deg, rgba(9,11,20,0.98) 0%, rgba(10,14,28,0.98) 100%)",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
    boxShadow: "0 8px 20px rgba(0,0,0,0.35)",
  },

  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },

  pill: {
    display: "inline-flex",
    alignItems: "center",
    padding: "4px 8px",
    borderRadius: 999,
    background: "rgba(255,255,255,0.08)",
    border: "1px solid rgba(255,255,255,0.12)",
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },

  h3: { margin: 0, fontSize: 15, fontWeight: 800, color: "#fff" },
  sub: { fontSize: 12, color: "rgba(229,231,235,0.65)" },

  clearBtn: {
    marginLeft: "auto",
    padding: "6px 10px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.06)",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 700,
  },

  filtersGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 8,
  },

  filterWrap: { display: "flex", alignItems: "center", gap: 8 },
  filterLabel: { fontSize: 11, color: "rgba(229,231,235,0.6)", minWidth: 36 },
  select: {
    flex: 1,
    padding: "7px 9px",
    border: "1px solid rgba(255,255,255,0.14)",
    borderRadius: 10,
    background: "rgba(255,255,255,0.04)",
    color: "#e5e7eb",
    fontSize: 13,
    outline: "none",
  },

  scrollRegion: {
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    padding: "10px 10px 14px",
  },

  itemShell: ({ active, theme, hasMap }) => ({
    position: "relative",
    marginBottom: 8,
    borderRadius: 14,
    background: theme.bg,
    border: active
      ? `1px solid rgba(99,102,241,0.75)`
      : `1px solid ${theme.border}`,
    boxShadow: active
      ? "0 10px 26px rgba(0,0,0,0.45)"
      : "0 6px 18px rgba(0,0,0,0.28)",
    overflow: "hidden",
    opacity: hasMap ? 1 : 0.55,
    transition: "transform .12s ease, box-shadow .12s ease, border-color .12s ease",
  }),

  leftStrip: (colour, active) => ({
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: active ? 7 : 5,
    background: `linear-gradient(180deg, ${colour} 0%, rgba(255,255,255,0.0) 120%)`,
    boxShadow: `0 0 0 1px rgba(0,0,0,0.35) inset`,
  }),

  itemButton: (hasMap) => ({
    width: "100%",
    display: "grid",
    gridTemplateColumns: "1fr auto",
    gap: 8,
    textAlign: "left",
    padding: "11px 12px 11px 14px",
    background: "transparent",
    border: "none",
    color: "inherit",
    cursor: hasMap ? "pointer" : "not-allowed",
  }),

  name: { fontWeight: 800, fontSize: 14, color: "#fff", marginBottom: 3 },
  dateLine: { fontSize: 12, color: "rgba(229,231,235,0.8)" },
  metaRow: {
    fontSize: 12,
    color: "rgba(229,231,235,0.95)",
    marginTop: 6,
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
  },

  kindChip: (theme) => ({
    display: "inline-flex",
    alignItems: "center",
    padding: "2px 7px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 900,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    background: "rgba(0,0,0,0.35)",
    border: "1px solid rgba(255,255,255,0.12)",
    color: theme.text,
  }),

  expandIcon: { fontSize: 16, color: "rgba(229,231,235,0.75)", paddingLeft: 8 },

  expandedPanel: {
    padding: "10px 12px 12px",
    background: "rgba(0,0,0,0.28)",
    borderTop: "1px solid rgba(255,255,255,0.10)",
  },

  detailGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0,1fr))",
    gap: 8,
    fontSize: 13,
  },

  detailCard: {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: 10,
    padding: "8px 10px",
  },
  detailLabel: { fontSize: 11, color: "rgba(229,231,235,0.6)", marginBottom: 2 },
  detailValue: { fontWeight: 700, color: "#fff" },

  splitsTable: {
    width: "100%",
    fontSize: 12,
    borderCollapse: "collapse",
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: 10,
    overflow: "hidden",
  },
  splitsHeadRow: {
    textAlign: "left",
    color: "rgba(229,231,235,0.75)",
    background: "rgba(255,255,255,0.06)",
  },

  loadMoreWrap: { padding: 12, display: "flex", justifyContent: "center" },
  loadMoreBtn: {
    padding: "8px 12px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.06)",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 700,
  },

  empty: { padding: 12, fontSize: 13, color: "rgba(229,231,235,0.65)" },
};

// ---------- component ----------
export default function RecentRunsList({
  items,
  idToFeature,
  selectedId,
  selectedKm,
  onSelect,
  onSelectSplit,
  onClear,
  pageSize = 50,
}) {
  const [expandedId, setExpandedId] = useState(null);
  const [visibleCount, setVisibleCount] = useState(pageSize);

  // Splits lazy-load cache and state
  const [splitsById, setSplitsById] = useState({});
  const [splitsLoading, setSplitsLoading] = useState({});
  const [splitsError, setSplitsError] = useState({});

  const [kindFilter, setKindFilter] = useState("all");
  const [shoeFilter, setShoeFilter] = useState("All");

  const baseList = useMemo(() => (items || []).slice(0, 1000), [items]);

  const shoeOptions = useMemo(() => {
    const labels = new Set();
    for (const it of baseList) {
      const label = it.shoe_name || it.gear_name || "(no shoe)";
      labels.add(label);
    }
    return ["All", ...Array.from(labels).sort((a, b) => a.localeCompare(b))];
  }, [baseList]);

  const classify = useCallback((it) => {
    const durationSec = it.moving_time ?? it.elapsed_time ?? 0;
    const secPerKm = it.average_speed
      ? (1000 / it.average_speed)
      : (it.moving_time && it.distance ? (it.moving_time / (it.distance / 1000)) : null);

    const isWalk = secPerKm != null && secPerKm > WALK_PACE_S_PER_KM;
    const isWorkout = !isWalk && secPerKm != null && secPerKm < WORKOUT_PACE_S_PER_KM;
    const isLong = !isWalk && durationSec >= LONG_RUN_SECONDS;
    const isJog = !isWalk && !isWorkout && !isLong;

    const shoeLabel = it.shoe_name || it.gear_name || "(no shoe)";
    return { isWalk, isWorkout, isLong, isJog, shoeLabel, durationSec, secPerKm };
  }, []);

  const filteredList = useMemo(() => {
    return baseList.filter((it) => {
      const { isWalk, isWorkout, isLong, isJog, shoeLabel } = classify(it);
      if (shoeFilter !== "All" && shoeLabel !== shoeFilter) return false;
      if (kindFilter === "walk" && !isWalk) return false;
      if (kindFilter === "workout" && !isWorkout) return false;
      if (kindFilter === "long" && !isLong) return false;
      if (kindFilter === "jog" && !isJog) return false;
      return true;
    });
  }, [baseList, classify, shoeFilter, kindFilter]);

  useEffect(() => {
    setVisibleCount(pageSize);
    setExpandedId(null);
  }, [pageSize, kindFilter, shoeFilter]);

  const visible = useMemo(() => filteredList.slice(0, visibleCount), [filteredList, visibleCount]);
  const canLoadMore = visibleCount < filteredList.length;

  const fetchSplits = useCallback(async (id) => {
    if (splitsById[id] || splitsLoading[id]) return;
    setSplitsLoading((m) => ({ ...m, [id]: true }));
    setSplitsError((m) => ({ ...m, [id]: undefined }));
    try {
      const res = await fetch(`/splits/${id}.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const splits = json?.splits || json?.splits_metric || [];
      setSplitsById((m) => ({ ...m, [id]: splits }));
    } catch (e) {
      setSplitsError((m) => ({ ...m, [id]: "Failed to load splits" }));
    } finally {
      setSplitsLoading((m) => ({ ...m, [id]: false }));
    }
  }, [splitsById, splitsLoading]);

  const handleClickItem = useCallback((item) => {
    const id = String(item.id);
    onSelect?.(id);
    setExpandedId((cur) => {
      const next = cur === id ? null : id;
      if (next && item.has_splits) fetchSplits(id);
      return next;
    });
  }, [onSelect, fetchSplits]);

  const handleClickSplit = useCallback((runId, km) => {
    if (selectedId !== runId) onSelect?.(runId);
    onSelectSplit?.(runId, km);
  }, [onSelect, onSelectSplit, selectedId]);

  const handleClear = () => {
    onClear?.();
    setExpandedId(null);
  };

  const loadMore = () => setVisibleCount((c) => Math.min(c + pageSize, filteredList.length));

  return (
    <aside style={styles.aside}>
      {/* Sticky header */}
      <div style={styles.stickyHeader}>
        <div style={styles.titleRow}>
          <div style={styles.pill}>Recent runs</div>
          <h3 style={styles.h3}>Last 1000 runs</h3>
          <div style={styles.sub}>
            Showing {visible.length} of {filteredList.length}
          </div>

          {(selectedId || expandedId) && (
            <button onClick={handleClear} style={styles.clearBtn} title="Clear selection">
              Clear
            </button>
          )}
        </div>

        {/* Filters */}
        <div style={styles.filtersGrid}>
          <div style={styles.filterWrap}>
            <label style={styles.filterLabel}>Kind</label>
            <select
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value)}
              style={styles.select}
            >
              <option value="all">All</option>
              <option value="walk">Walk (&gt; 9:00/km)</option>
              <option value="workout">Workout (&lt; 4:10/km)</option>
              <option value="long">Long run (≥ 1:10)</option>
              <option value="jog">Jog</option>
            </select>
          </div>

          <div style={styles.filterWrap}>
            <label style={styles.filterLabel}>Shoe</label>
            <select
              value={shoeFilter}
              onChange={(e) => setShoeFilter(e.target.value)}
              style={styles.select}
            >
              {shoeOptions.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Scroll region */}
      <div style={styles.scrollRegion}>
        {visible.map((item) => {
          const id = String(item.id);
          const active = selectedId === id;
          const expanded = expandedId === id;
          const hasMap = !!item.has_map;

          const name = item.name || "Run";
          const date = formatDate(item.start_date);
          const location = item.location || "";
          const dateLine = location ? `${date} — ${location}` : date;

          const kmStr = metersToKm(item.distance);
          const durationSec = item.moving_time ?? item.elapsed_time;
          const durationStr = formatDuration(durationSec);

          const secPerKm = item.average_speed
            ? (1000 / item.average_speed)
            : (item.moving_time && item.distance ? (item.moving_time / (item.distance / 1000)) : null);
          const paceStr = secPerKm ? formatPace(secPerKm) : "";

          const elevStr = item.total_elevation_gain != null ? formatElevation(item.total_elevation_gain) : "";

          const isTread = !hasMap && /tread/i.test(name);
          const isWalk = secPerKm != null && secPerKm > WALK_PACE_S_PER_KM;
          const isWorkout = !isWalk && secPerKm != null && secPerKm < WORKOUT_PACE_S_PER_KM;
          const isLong = !isWalk && (durationSec || 0) >= LONG_RUN_SECONDS;
          const theme =
            isTread ? KIND_THEME.tread :
            isWalk ? KIND_THEME.walk :
            isWorkout ? KIND_THEME.workout :
            isLong ? KIND_THEME.long :
            KIND_THEME.jog;

          return (
            <div
              key={id}
              style={styles.itemShell({ active, theme, hasMap })}
              className="recent-card"
              onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-1px)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; }}
            >
              <div style={styles.leftStrip(theme.strip, active)} />

              <button
                onClick={() => hasMap && handleClickItem(item)}
                style={styles.itemButton(hasMap)}
                title={hasMap ? "Highlight this run on the map and show details" : "No map for this activity"}
              >
                <div>
                  <div style={styles.name}>{name}</div>
                  <div style={styles.dateLine}>
                    {dateLine}
                    {!hasMap && (
                      <span style={{ marginLeft: 8, color: "#fca5a5", fontWeight: 800 }}>
                        (no map)
                      </span>
                    )}
                  </div>

                  <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={styles.kindChip(theme)}>{theme.label}</span>
                    {kmStr && <span style={styles.metaRow}><strong>{kmStr} km</strong></span>}
                    {durationStr && <span style={styles.metaRow}>• {durationStr}</span>}
                    {paceStr && <span style={styles.metaRow}>• {paceStr}</span>}
                  </div>
                </div>

                <div style={styles.expandIcon}>{expanded ? "▾" : "▸"}</div>
              </button>

              {expanded && (
                <div style={styles.expandedPanel}>
                  {/* Stats grid */}
                  <div style={styles.detailGrid}>
                    <Detail label="Distance" value={kmStr ? `${kmStr} km` : "—"} />
                    <Detail label="Duration" value={durationStr || "—"} />
                    <Detail label="Pace" value={paceStr || "—"} />
                    <Detail label="Elevation Gain" value={elevStr || "—"} />
                  </div>

                  {(item.type || item.shoe_name || item.gear_name) && (
                    <div style={{ marginTop: 8, ...styles.detailGrid }}>
                      {item.type && <Detail label="Type" value={item.type} />}
                      {item.shoe_name && <Detail label="Shoe" value={item.shoe_name} />}
                      {!item.shoe_name && item.gear_name && <Detail label="Gear" value={item.gear_name} />}
                    </div>
                  )}

                  {/* Splits — real file if available, geometry-derived for all mapped runs */}
                  {hasMap && (() => {
                    const feature = idToFeature?.get(id);
                    const geomSplits = feature ? computeGeomSplits(feature) : [];
                    const realSplits = splitsById[id];
                    const usingReal = item.has_splits && Array.isArray(realSplits) && realSplits.length > 0;
                    const showSplits = usingReal || geomSplits.length > 0;

                    if (!showSplits && !splitsLoading[id]) return null;

                    return (
                      <div style={{ marginTop: 12 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                          <div style={{ fontWeight: 800 }}>Km splits</div>
                          {!usingReal && geomSplits.length > 0 && (
                            <span style={{ fontSize: 10, color: "rgba(229,231,235,0.5)", fontStyle: "italic" }}>
                              from GPS trace
                            </span>
                          )}
                        </div>

                        {splitsLoading[id] && (
                          <div style={{ fontSize: 12, color: "rgba(229,231,235,0.7)" }}>Loading splits…</div>
                        )}
                        {splitsError[id] && (
                          <div style={{ fontSize: 12, color: "#fca5a5" }}>{splitsError[id]}</div>
                        )}

                        {!splitsLoading[id] && (() => {
                          const rows = usingReal ? realSplits : geomSplits;
                          return (
                            <table style={styles.splitsTable}>
                              <thead>
                                <tr style={styles.splitsHeadRow}>
                                  <th style={{ padding: "6px 8px" }}>Km</th>
                                  <th style={{ padding: "6px 8px" }}>Dist</th>
                                  {usingReal && <th style={{ padding: "6px 8px" }}>Time</th>}
                                  {usingReal && <th style={{ padding: "6px 8px" }}>Pace</th>}
                                  {usingReal && <th style={{ padding: "6px 8px" }}>Elev</th>}
                                </tr>
                              </thead>
                              <tbody>
                                {rows.map((s, i) => {
                                  const km = usingReal ? (s.split ?? (i + 1)) : s.km;
                                  const distM = usingReal ? s.distance : s.distanceM;
                                  const dKm = distM ? (distM / 1000) : 1;
                                  const spk = usingReal && s.moving_time && dKm > 0
                                    ? (s.moving_time / dKm)
                                    : null;
                                  const isActiveSplit = selectedId === id && selectedKm === km;

                                  return (
                                    <tr
                                      key={i}
                                      onClick={() => handleClickSplit(id, km)}
                                      title={`Highlight km ${km} on the map`}
                                      aria-selected={isActiveSplit}
                                      style={{
                                        borderTop: "1px solid rgba(255,255,255,0.08)",
                                        cursor: "pointer",
                                        background: isActiveSplit ? "rgba(59,130,246,0.18)" : "transparent",
                                        fontWeight: isActiveSplit ? 800 : 500,
                                      }}
                                    >
                                      <td style={{ padding: "6px 8px" }}>{km}</td>
                                      <td style={{ padding: "6px 8px" }}>{distM ? `${(distM / 1000).toFixed(2)} km` : "—"}</td>
                                      {usingReal && <td style={{ padding: "6px 8px" }}>{formatDuration(s.moving_time ?? s.elapsed_time)}</td>}
                                      {usingReal && <td style={{ padding: "6px 8px" }}>{spk ? formatPace(spk) : "—"}</td>}
                                      {usingReal && <td style={{ padding: "6px 8px" }}>{formatElevation(s.elevation_difference)}</td>}
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          );
                        })()}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          );
        })}

        {canLoadMore && (
          <div style={styles.loadMoreWrap}>
            <button onClick={loadMore} style={styles.loadMoreBtn} title="Load more runs">
              Load more
            </button>
          </div>
        )}

        {filteredList.length === 0 && (
          <div style={styles.empty}>No runs match your filters.</div>
        )}
      </div>
    </aside>
  );
}

function Detail({ label, value }) {
  return (
    <div style={styles.detailCard}>
      <div style={styles.detailLabel}>{label}</div>
      <div style={styles.detailValue}>{value}</div>
    </div>
  );
}
