import React, { useMemo, useState, useCallback, useEffect } from "react";

function metersToKm(m) { if (m == null) return ""; return (m / 1000).toFixed(2); }
function formatPace(secondsPerKm) { if (!secondsPerKm || !isFinite(secondsPerKm)) return ""; const m = Math.floor(secondsPerKm / 60); const s = Math.round(secondsPerKm % 60); return `${m}:${s.toString().padStart(2, "0")}/km`; }
function formatDuration(sec) { if (sec == null) return ""; const h = Math.floor(sec / 3600); const m = Math.floor((sec % 3600) / 60); const s = Math.floor(sec % 60); return h > 0 ? `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}` : `${m}:${s.toString().padStart(2, "0")}`; }
function formatDate(iso) { try { return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); } catch { return ""; } }
function formatElevation(m) { if (m == null) return ""; return `${Math.round(m)} m`; }

const LONG_RUN_SECONDS = 70 * 60; // 1h10m
const WORKOUT_PACE_S_PER_KM = 240; // faster than 4:00/km

export default function RecentRunsList({
  items,        // from runs_index.json (newest → oldest)
  selectedId,
  onSelect,
  onClear,
  pageSize = 50,
}) {
  const [expandedId, setExpandedId] = useState(null);
  const [visibleCount, setVisibleCount] = useState(pageSize);

  // Filtersƒ
  const [kindFilter, setKindFilter] = useState("all"); // "all" | "workout" | "long" | "jog"
  const [shoeFilter, setShoeFilter] = useState("All");

  // Base list (cap to 300 to match parent)
  const baseList = useMemo(() => (items || []).slice(0, 300), [items]);

  // Shoe options
  const shoeOptions = useMemo(() => {
    const labels = new Set();
    for (const it of baseList) {
      const label = it.shoe_name || it.gear_name || "(no shoe)";
      labels.add(label);
    }
    return ["All", ...Array.from(labels).sort((a, b) => a.localeCompare(b))];
  }, [baseList]);

  // Classifier
  const classify = useCallback((it) => {
    const durationSec = it.moving_time ?? it.elapsed_time ?? 0;
    const secPerKm = it.average_speed
      ? (1000 / it.average_speed)
      : (it.moving_time && it.distance ? (it.moving_time / (it.distance / 1000)) : null);

    const isWorkout = secPerKm != null && secPerKm < WORKOUT_PACE_S_PER_KM;
    const isLong = durationSec >= LONG_RUN_SECONDS;
    const isJog = !isWorkout && !isLong;

    const shoeLabel = it.shoe_name || it.gear_name || "(no shoe)";
    return { isWorkout, isLong, isJog, shoeLabel, durationSec, secPerKm };
  }, []);

  // Apply filters
  const filteredList = useMemo(() => {
    return baseList.filter((it) => {
      const { isWorkout, isLong, isJog, shoeLabel } = classify(it);
      if (shoeFilter !== "All" && shoeLabel !== shoeFilter) return false;
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

  const handleClickItem = useCallback((item) => {
    const id = String(item.id);
    onSelect?.(id);
    setExpandedId((cur) => (cur === id ? null : id));
  }, [onSelect]);

  const handleClear = () => {
    onClear?.();
    setExpandedId(null);
  };

  const loadMore = () => setVisibleCount((c) => Math.min(c + pageSize, filteredList.length));

  return (
    <aside
      style={{
        height: "100%",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        borderLeft: "1px solid #e5e7eb",
        background: "#fff",
      }}
    >
      {/* Sticky header */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 5,
          background: "#fff",
          borderBottom: "1px solid #e5e7eb",
          boxShadow: "0 1px 0 rgba(0,0,0,0.02)",
        }}
      >
        {/* Row 1: title + clear */}
        <div
          style={{
            padding: "10px 12px",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Last 300 runs</h3>
          <div style={{ fontSize: 12, color: "#64748b" }}>
            Showing {visible.length} of {filteredList.length}
          </div>
          {(selectedId || expandedId) && (
            <button
              onClick={handleClear}
              style={{
                marginLeft: "auto",
                padding: "6px 10px",
                borderRadius: 8,
                border: "1px solid #e5e7eb",
                background: "#f8fafc",
                cursor: "pointer",
                fontWeight: 600,
              }}
              title="Clear selection"
            >
              Clear
            </button>
          )}
        </div>

        {/* Row 2: filters */}
        <div style={{ padding: "0 12px 10px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <label style={{ fontSize: 12, color: "#64748b", minWidth: 34 }}>Kind</label>
            <select
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value)}
              style={{
                flex: 1,
                padding: "6px 8px",
                border: "1px solid #e5e7eb",
                borderRadius: 8,
                background: "#fff",
                fontSize: 13,
              }}
            >
              <option value="all">All</option>
              <option value="workout">Workout (&lt; 4:00/km)</option>
              <option value="long">Long run (≥ 1:10)</option>
              <option value="jog">Jog</option>
            </select>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <label style={{ fontSize: 12, color: "#64748b", minWidth: 34 }}>Shoe</label>
            <select
              value={shoeFilter}
              onChange={(e) => setShoeFilter(e.target.value)}
              style={{
                flex: 1,
                padding: "6px 8px",
                border: "1px solid #e5e7eb",
                borderRadius: 8,
                background: "#fff",
                fontSize: 13,
              }}
            >
              {shoeOptions.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Scroll region */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {visible.map((item) => {
          const id = String(item.id);
          const active = selectedId === id;
          const expanded = expandedId === id;

          const name = item.name || "Run";
          const date = formatDate(item.start_date);
          const kmStr = metersToKm(item.distance);
          const durationSec = item.moving_time ?? item.elapsed_time;
          const durationStr = formatDuration(durationSec);

          const secPerKm = item.average_speed
            ? (1000 / item.average_speed)
            : (item.moving_time && item.distance ? (item.moving_time / (item.distance / 1000)) : null);
          const paceStr = secPerKm ? formatPace(secPerKm) : "";

          const elevStr = item.total_elevation_gain != null ? formatElevation(item.total_elevation_gain) : "";
          const hasMap = !!item.has_map;

          // Color coding
          const isWorkout = secPerKm != null && secPerKm < WORKOUT_PACE_S_PER_KM;
          const isLong = (durationSec || 0) >= LONG_RUN_SECONDS;

          let bg = "transparent";
          let borderCol = "transparent";
          let stripCol = "transparent";
          if (isWorkout) {
            bg = "#fee2e2";
            borderCol = "#fecaca";
            stripCol = "#f87171";
          } else if (isLong) {
            bg = "#dcfce7";
            borderCol = "#bbf7d0";
            stripCol = "#4ade80";
          }
          const stripWidth = active ? 6 : (stripCol === "transparent" ? 0 : 4);
          const fallbackActiveStrip = active && stripCol === "transparent" ? "#6366f1" : stripCol;

          return (
            <div key={id} style={{ borderBottom: "1px solid #f1f5f9", opacity: hasMap ? 1 : 0.65 }}>
              <button
                onClick={() => hasMap && handleClickItem(item)}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  alignItems: "center",
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 12px",
                  background: bg,
                  border: `1px solid ${borderCol}`,
                  borderLeft: stripWidth ? `${stripWidth}px solid ${fallbackActiveStrip}` : "1px solid transparent",
                  cursor: hasMap ? "pointer" : "not-allowed",
                }}
                title={hasMap ? "Highlight this run on the map and show details" : "No map for this activity"}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14, color: "#0f172a", marginBottom: 2 }}>
                    {name}
                  </div>
                  <div style={{ fontSize: 12, color: "#475569" }}>
                    {date}
                    {!hasMap && <span style={{ marginLeft: 8, color: "#ef4444", fontWeight: 600 }}>(no map)</span>}
                  </div>
                  <div style={{ fontSize: 12, color: "#334155", marginTop: 4, display: "flex", gap: 10, flexWrap: "wrap" }}>
                    {kmStr && <span>{kmStr} km</span>}
                    {durationStr && <span>• {durationStr}</span>}
                    {paceStr && <span>• {paceStr}</span>}
                  </div>
                </div>

                <div style={{ fontSize: 18, color: hasMap ? "#64748b" : "#cbd5e1", paddingLeft: 8 }}>
                  {expanded ? "▾" : "▸"}
                </div>
              </button>

              {expanded && (
                <div style={{ padding: "8px 12px 12px", background: "#f8fafc" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, fontSize: 13 }}>
                    <Detail label="Distance" value={kmStr ? `${kmStr} km` : "—"} />
                    <Detail label="Duration" value={durationStr || "—"} />
                    <Detail label="Pace" value={paceStr || "—"} />
                    <Detail label="Elevation Gain" value={elevStr || "—"} />
                  </div>

                  {(item.type || item.shoe_name || item.gear_name) && (
                    <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, fontSize: 13 }}>
                      {item.type && <Detail label="Type" value={item.type} />}
                      {item.shoe_name && <Detail label="Shoe" value={item.shoe_name} />}
                      {!item.shoe_name && item.gear_name && <Detail label="Gear" value={item.gear_name} />}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {canLoadMore && (
          <div style={{ padding: 12, display: "flex", justifyContent: "center" }}>
            <button
              onClick={loadMore}
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid #e5e7eb",
                background: "#ffffff",
                cursor: "pointer",
                fontWeight: 600,
              }}
              title="Load 10 more runs"
            >
              Load more
            </button>
          </div>
        )}

        {filteredList.length === 0 && (
          <div style={{ padding: 12, fontSize: 13, color: "#64748b" }}>
            No runs match your filters.
          </div>
        )}
      </div>
    </aside>
  );
}

function Detail({ label, value }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: "8px 10px" }}>
      <div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>{label}</div>
      <div style={{ fontWeight: 600, color: "#0f172a" }}>{value}</div>
    </div>
  );
}
