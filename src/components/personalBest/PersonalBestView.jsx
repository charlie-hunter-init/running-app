import React, { useEffect, useMemo, useState } from "react";

// ─── format helpers ────────────────────────────────────────────────────────────
function formatHMS(totalSeconds) {
  if (totalSeconds == null || !isFinite(totalSeconds) || totalSeconds <= 0) return "—";
  const s = Math.round(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`
    : `${m}:${String(r).padStart(2, "0")}`;
}

function formatPace(secPerKm) {
  if (!secPerKm || !isFinite(secPerKm) || secPerKm <= 0) return "—";
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}/km`;
}

function fmtDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric", month: "short", day: "numeric",
    });
  } catch { return "—"; }
}

// ─── geometry helpers ──────────────────────────────────────────────────────────
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
 * Given a flat array of [lng, lat] coords and the run's total moving_time,
 * find the fastest contiguous window of exactly targetMeters distance.
 * Returns the time in seconds for that window, or null if the run is too short.
 */
function fastestWindowFromGeom(coords, movingTimeSec, targetMeters) {
  if (!coords || coords.length < 2 || !movingTimeSec) return null;

  // Build cumulative distance array
  const cum = [0];
  for (let i = 1; i < coords.length; i++) {
    cum.push(cum[i - 1] + haversineMeters(coords[i - 1], coords[i]));
  }
  const totalDist = cum[cum.length - 1];
  if (totalDist < targetMeters * 0.95) return null; // run too short

  // Sliding window: for each start index i, binary-search for end index j
  // where cum[j] - cum[i] >= targetMeters
  let bestTime = Infinity;
  for (let i = 0; i < cum.length - 1; i++) {
    const target = cum[i] + targetMeters;
    if (target > totalDist) break;

    // Binary search for first j where cum[j] >= target
    let lo = i + 1, hi = cum.length - 1, j = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] >= target) { j = mid; hi = mid - 1; }
      else lo = mid + 1;
    }
    if (j === -1) continue;

    const segDist = cum[j] - cum[i];
    // Proportional time: segment covers segDist / totalDist of the run
    const segTime = (segDist / totalDist) * movingTimeSec;
    // Scale down to exactly targetMeters
    const scaledTime = segTime * (targetMeters / segDist);
    if (scaledTime < bestTime) bestTime = scaledTime;
  }

  return bestTime === Infinity ? null : bestTime;
}

/**
 * Given per-km split rows (each has distance, moving_time) find the fastest
 * consecutive window covering exactly targetMeters.
 * This is exact — uses real per-km times.
 */
function fastestWindowFromSplits(splits, targetMeters) {
  if (!splits || splits.length === 0) return null;

  // Build cumulative distance and time arrays
  const cumDist = [0];
  const cumTime = [0];
  for (const s of splits) {
    cumDist.push(cumDist[cumDist.length - 1] + (s.distance || 0));
    cumTime.push(cumTime[cumTime.length - 1] + (s.moving_time || 0));
  }

  const totalDist = cumDist[cumDist.length - 1];
  if (totalDist < targetMeters * 0.95) return null;

  let bestTime = Infinity;

  for (let i = 0; i < cumDist.length - 1; i++) {
    const target = cumDist[i] + targetMeters;
    if (target > totalDist + 50) break; // 50m tolerance

    // Find j where cumDist[j] >= target
    let lo = i + 1, hi = cumDist.length - 1, j = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (cumDist[mid] >= target) { j = mid; hi = mid - 1; }
      else lo = mid + 1;
    }
    if (j === -1) continue;

    const segDist = cumDist[j] - cumDist[i];
    const segTime = cumTime[j] - cumTime[i];
    // Scale to exact target distance
    const scaledTime = segTime * (targetMeters / segDist);
    if (scaledTime < bestTime) bestTime = scaledTime;
  }

  return bestTime === Infinity ? null : bestTime;
}

// ─── constants ────────────────────────────────────────────────────────────────
const DISTANCES = [
  { key: "1k",  label: "1 km",         meters: 1000 },
  { key: "5k",  label: "5 km",         meters: 5000 },
  { key: "10k", label: "10 km",        meters: 10000 },
  { key: "hm",  label: "Half Marathon",meters: 21097.5 },
];

// ─── main component ────────────────────────────────────────────────────────────
export default function PersonalBestView({ features }) {
  const [splitsCache, setSplitsCache] = useState({}); // id -> splits[]
  const [loadingDone, setLoadingDone] = useState(false);

  // All runs that have a map
  const mappedFeatures = useMemo(
    () => (features || []).filter((f) => f?.geometry && f?.properties?.start_date),
    [features]
  );

  // IDs of runs that have split files available
  const splitIds = useMemo(() => {
    // Check runs_index for has_splits — but we don't have that here.
    // Instead we'll attempt to load all splits files and cache what works.
    return mappedFeatures
      .map((f) => String(f.properties.id))
      .filter(Boolean);
  }, [mappedFeatures]);

  // Fetch all available split files in parallel on mount / when features change
  useEffect(() => {
    if (splitIds.length === 0) { setLoadingDone(true); return; }
    setLoadingDone(false);

    let cancelled = false;
    const BATCH = 20; // parallel fetch batch size

    async function loadAll() {
      const cache = {};
      for (let i = 0; i < splitIds.length; i += BATCH) {
        if (cancelled) break;
        const batch = splitIds.slice(i, i + BATCH);
        await Promise.all(
          batch.map(async (id) => {
            try {
              const res = await fetch(`/splits/${id}.json`);
              if (!res.ok) return;
              const json = await res.json();
              const splits = json?.splits || json?.splits_metric || [];
              if (splits.length > 0) cache[id] = splits;
            } catch {
              // no split file — will fall back to geometry
            }
          })
        );
      }
      if (!cancelled) {
        setSplitsCache(cache);
        setLoadingDone(true);
      }
    }

    loadAll();
    return () => { cancelled = true; };
  }, [splitIds]);

  // ── Compute PBs ──────────────────────────────────────────────────────────────
  const pbs = useMemo(() => {
    if (!loadingDone) return null;

    // result: { [key]: [{ timeSec, pace, feature, source }] sorted fastest first }
    const results = {};
    for (const d of DISTANCES) results[d.key] = [];

    for (const feature of mappedFeatures) {
      const p = feature.properties || {};
      const id = String(p.id);
      const movingTime = p.moving_time ?? p.elapsed_time ?? 0;
      const geom = feature.geometry;

      const coords =
        geom.type === "LineString"
          ? geom.coordinates
          : geom.type === "MultiLineString"
          ? geom.coordinates.flat()
          : null;

      const splits = splitsCache[id] || null;

      for (const { key, meters } of DISTANCES) {
        let timeSec = null;
        let source = "geom";

        if (splits) {
          timeSec = fastestWindowFromSplits(splits, meters);
          if (timeSec) source = "splits";
        }

        // Fall back to geometry interpolation
        if (!timeSec && coords && movingTime > 0) {
          timeSec = fastestWindowFromGeom(coords, movingTime, meters);
          source = "geom";
        }

        if (timeSec && timeSec > 0) {
          results[key].push({
            timeSec,
            pace: timeSec / (meters / 1000),
            source,
            name: p.name || "Run",
            date: p.start_date,
            id,
          });
        }
      }
    }

    // Sort each distance: fastest first
    for (const d of DISTANCES) {
      results[d.key].sort((a, b) => a.timeSec - b.timeSec);
    }

    return results;
  }, [loadingDone, mappedFeatures, splitsCache]);

  // ── Render ───────────────────────────────────────────────────────────────────
  if (!loadingDone || !pbs) {
    const total = splitIds.length;
    const done = Object.keys(splitsCache).length;
    return (
      <div style={styles.page}>
        <div style={styles.loadingCard}>
          <div style={styles.loadingTitle}>Calculating Personal Bests…</div>
          <div style={styles.loadingBar}>
            <div
              style={{
                ...styles.loadingFill,
                width: total > 0 ? `${Math.round((done / total) * 100)}%` : "0%",
              }}
            />
          </div>
          <div style={styles.loadingSub}>
            {done} / {total} runs processed
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      {/* PB hero cards */}
      <div style={styles.heroGrid}>
        {DISTANCES.map((d) => {
          const best = pbs[d.key][0] || null;
          return (
            <div key={d.key} style={styles.heroCard}>
              <div style={styles.heroLabel}>{d.label}</div>
              <div style={styles.heroTime}>{best ? formatHMS(best.timeSec) : "—"}</div>
              <div style={styles.heroPace}>
                {best ? `${formatPace(best.pace)} · ${fmtDate(best.date)}` : "No efforts found"}
              </div>
              {best && (
                <div style={styles.heroSource}>
                  {best.source === "splits" ? "✓ exact splits" : "~ GPS estimate"}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Top 5 tables per distance */}
      <div style={styles.tablesGrid}>
        {DISTANCES.map((d) => (
          <TopTable key={d.key} label={d.label} rows={pbs[d.key].slice(0, 5)} />
        ))}
      </div>
    </div>
  );
}

// ─── TopTable ─────────────────────────────────────────────────────────────────
function TopTable({ label, rows }) {
  return (
    <div style={styles.tableCard}>
      <div style={styles.tableTitle}>{label} · Top 5</div>
      {rows.length === 0 ? (
        <div style={styles.tableEmpty}>No efforts found — need runs of at least this distance.</div>
      ) : (
        <table style={styles.table}>
          <thead>
            <tr>
              {["#", "Time", "Pace", "Run", "Date", ""].map((h) => (
                <th key={h} style={styles.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.id}-${i}`} style={styles.tr(i === 0)}>
                <td style={styles.td}>
                  {i === 0 ? <span style={styles.goldBadge}>🥇</span> :
                   i === 1 ? <span style={styles.silverBadge}>🥈</span> :
                   i === 2 ? <span style={styles.bronzeBadge}>🥉</span> :
                   <span style={styles.rankNum}>{i + 1}</span>}
                </td>
                <td style={{ ...styles.td, fontWeight: i === 0 ? 900 : 600, color: i === 0 ? "#fff" : "rgba(229,231,235,0.9)" }}>
                  {formatHMS(r.timeSec)}
                </td>
                <td style={styles.td}>{formatPace(r.pace)}</td>
                <td style={{ ...styles.td, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.name}
                </td>
                <td style={styles.td}>{fmtDate(r.date)}</td>
                <td style={{ ...styles.td, color: "rgba(229,231,235,0.4)", fontSize: 10 }}>
                  {r.source === "splits" ? "exact" : "~GPS"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ─── styles ───────────────────────────────────────────────────────────────────
const styles = {
  page: {
    height: "100%",
    overflowY: "auto",
    padding: "20px 20px 40px",
    background: "#05060a",
    color: "#e5e7eb",
  },

  loadingCard: {
    maxWidth: 420,
    margin: "80px auto",
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 18,
    padding: 32,
    textAlign: "center",
  },
  loadingTitle: { fontSize: 18, fontWeight: 800, marginBottom: 20, color: "#fff" },
  loadingBar: {
    height: 8,
    borderRadius: 999,
    background: "rgba(255,255,255,0.08)",
    overflow: "hidden",
    marginBottom: 12,
  },
  loadingFill: {
    height: "100%",
    borderRadius: 999,
    background: "linear-gradient(90deg, #6366f1, #0ea5e9)",
    transition: "width .3s ease",
  },
  loadingSub: { fontSize: 13, color: "rgba(229,231,235,0.6)" },

  heroGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 14,
    marginBottom: 24,
  },
  heroCard: {
    background: "linear-gradient(135deg, rgba(99,102,241,0.15) 0%, rgba(14,165,233,0.08) 100%)",
    border: "1px solid rgba(99,102,241,0.3)",
    borderRadius: 18,
    padding: "18px 16px",
  },
  heroLabel: {
    fontSize: 11,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    color: "rgba(229,231,235,0.6)",
    marginBottom: 6,
  },
  heroTime: { fontSize: 32, fontWeight: 900, color: "#fff", lineHeight: 1, marginBottom: 6 },
  heroPace: { fontSize: 13, color: "rgba(229,231,235,0.75)" },
  heroSource: { marginTop: 6, fontSize: 11, color: "rgba(229,231,235,0.4)" },

  tablesGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
    gap: 14,
  },
  tableCard: {
    background: "rgba(255,255,255,0.03)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 18,
    padding: "16px 14px",
  },
  tableTitle: {
    fontSize: 14,
    fontWeight: 900,
    color: "rgba(255,255,255,0.9)",
    marginBottom: 12,
  },
  tableEmpty: { fontSize: 13, color: "rgba(229,231,235,0.5)", padding: "4px 0" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: {
    textAlign: "left",
    fontSize: 11,
    fontWeight: 700,
    color: "rgba(229,231,235,0.5)",
    padding: "0 8px 8px 0",
    whiteSpace: "nowrap",
  },
  tr: (isFirst) => ({
    borderTop: "1px solid rgba(255,255,255,0.06)",
    background: isFirst ? "rgba(99,102,241,0.08)" : "transparent",
  }),
  td: {
    padding: "9px 8px 9px 0",
    color: "rgba(229,231,235,0.8)",
    verticalAlign: "middle",
  },
  goldBadge:   { fontSize: 16 },
  silverBadge: { fontSize: 16 },
  bronzeBadge: { fontSize: 16 },
  rankNum: { fontSize: 13, color: "rgba(229,231,235,0.5)", fontWeight: 700 },
};
