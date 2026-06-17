import React, { useState, useEffect } from "react";
import {
  loadOverride,
  saveOverride,
  deleteOverride,
  validateOverride,
} from "../../lib/shoeOverrideApi.js";

export default function ShoeOverrideEditor({ activityId, activityName, totalDistanceM, stravaShoe, shoeList, onOverrideChange }) {
  const totalKm = totalDistanceM / 1000;
  const [expanded, setExpanded] = useState(false);

  const [segments, setSegments] = useState([
    { shoe_name: stravaShoe?.name || "", gear_id: stravaShoe?.gearId || "", distance_km: totalKm.toFixed(2) },
    { shoe_name: "", gear_id: "", distance_km: "0" },
  ]);
  const [hasExisting, setHasExisting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState([]);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await loadOverride(activityId);
        if (cancelled) return;
        if (result.override) {
          setHasExisting(true);
          const segs = result.override.segments || [];
          setSegments([
            {
              shoe_name: segs[0]?.shoe_name || "",
              gear_id: segs[0]?.gear_id || "",
              distance_km: segs[0]?.distance_m ? (segs[0].distance_m / 1000).toFixed(2) : "0",
            },
            {
              shoe_name: segs[1]?.shoe_name || "",
              gear_id: segs[1]?.gear_id || "",
              distance_km: segs[1]?.distance_m ? (segs[1].distance_m / 1000).toFixed(2) : "0",
            },
          ]);
        }
      } catch (err) {
        if (!cancelled) {
          setMessage({ type: "error", text: `Failed to load override: ${err.message}` });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activityId]);

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.loadingText}>Loading shoe override...</div>
      </div>
    );
  }

  // When segment 1 distance changes, auto-calc segment 2
  const handleSeg1DistanceChange = (value) => {
    const seg1Km = parseFloat(value) || 0;
    const seg2Km = Math.max(0, totalKm - seg1Km);
    setSegments((prev) => [
      { ...prev[0], distance_km: value },
      { ...prev[1], distance_km: seg2Km.toFixed(2) },
    ]);
    setErrors([]);
    setMessage(null);
  };

  // When segment 2 distance changes, auto-calc segment 1
  const handleSeg2DistanceChange = (value) => {
    const seg2Km = parseFloat(value) || 0;
    const seg1Km = Math.max(0, totalKm - seg2Km);
    setSegments((prev) => [
      { ...prev[0], distance_km: seg1Km.toFixed(2) },
      { ...prev[1], distance_km: value },
    ]);
    setErrors([]);
    setMessage(null);
  };

  // When shoe 2 dropdown changes, auto-fill gear_id
  const handleShoe2Select = (value) => {
    const selected = shoeList.find((s) => s.name === value);
    setSegments((prev) => [
      prev[0],
      { ...prev[1], shoe_name: value, gear_id: selected?.gearId || "" },
    ]);
    setErrors([]);
    setMessage(null);
  };

  const updateSegment = (idx, field, value) => {
    setSegments((prev) => prev.map((seg, i) => i === idx ? { ...seg, [field]: value } : seg));
    setErrors([]);
    setMessage(null);
  };

  const handleSave = async () => {
    const segmentsM = segments.map((seg) => ({
      shoe_name: seg.shoe_name.trim(),
      gear_id: seg.gear_id.trim() || null,
      distance_m: Math.round(parseFloat(seg.distance_km || 0) * 1000),
    }));

    const validation = validateOverride(segmentsM, totalDistanceM);
    if (!validation.valid) {
      setErrors(validation.errors);
      return;
    }

    setSaving(true);
    setErrors([]);
    setMessage(null);
    try {
      await saveOverride({
        activity_id: String(activityId),
        total_distance_m: totalDistanceM,
        segments: segmentsM,
      });
      setHasExisting(true);
      setMessage({ type: "success", text: "Override saved successfully" });
      if (onOverrideChange) onOverrideChange();
    } catch (err) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm("Delete this shoe override? This cannot be undone.")) return;
    setSaving(true);
    setMessage(null);
    try {
      await deleteOverride(String(activityId));
      setHasExisting(false);
      setSegments([
        { shoe_name: stravaShoe?.name || "", gear_id: stravaShoe?.gearId || "", distance_km: totalKm.toFixed(2) },
        { shoe_name: "", gear_id: "", distance_km: "0" },
      ]);
      setMessage({ type: "success", text: "Override deleted" });
      if (onOverrideChange) onOverrideChange();
    } catch (err) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.header} onClick={() => setExpanded(!expanded)}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <span style={{ fontSize: 10, color: "rgba(241,245,249,0.5)", transition: "transform 0.2s", transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}>▶</span>
          <div style={styles.title}>Shoe Override</div>
          {hasExisting && !expanded && <span style={{ fontSize: 9, color: "#86efac", opacity: 0.8 }}>✓ saved</span>}
        </div>
        <div style={styles.totalDistance}>Total: {totalKm.toFixed(2)} km</div>
      </div>

      {expanded && (
        <>
          {/* Segment 1 — Strava shoe (text input for name) */}
          <div style={styles.segmentRow}>
            <div style={styles.segmentLabel}>Jogging</div>
            <input
              type="text"
              placeholder="Shoe name"
              value={segments[0].shoe_name}
              onChange={(e) => updateSegment(0, "shoe_name", e.target.value)}
              style={{ ...styles.input, flex: 2 }}
            />
            <input
              type="text"
              placeholder="gear_id"
              value={segments[0].gear_id}
              readOnly
              style={{ ...styles.input, width: 100, opacity: 0.6 }}
            />
            <input
              type="number"
              step="0.01"
              min="0"
              value={segments[0].distance_km}
              onChange={(e) => handleSeg1DistanceChange(e.target.value)}
              style={{ ...styles.input, width: 80 }}
            />
            <span style={styles.kmLabel}>km</span>
          </div>

          {/* Segment 2 — dropdown for shoe selection */}
          <div style={styles.segmentRow}>
            <div style={styles.segmentLabel}>Workout</div>
            <select
              value={segments[1].shoe_name}
              onChange={(e) => handleShoe2Select(e.target.value)}
              style={{ ...styles.select, flex: 2 }}
            >
              <option value="">Select shoe...</option>
              {shoeList.map((shoe) => (
                <option key={shoe.gearId || shoe.name} value={shoe.name}>
                  {shoe.name}
                </option>
              ))}
            </select>
            <input
              type="text"
              placeholder="gear_id"
              value={segments[1].gear_id}
              readOnly
              style={{ ...styles.input, width: 100, opacity: 0.6 }}
            />
            <input
              type="number"
              step="0.01"
              min="0"
              value={segments[1].distance_km}
              onChange={(e) => handleSeg2DistanceChange(e.target.value)}
              style={{ ...styles.input, width: 80 }}
            />
            <span style={styles.kmLabel}>km</span>
          </div>

          {errors.length > 0 && (
            <div style={styles.errorBox}>
              {errors.map((err, i) => <div key={i}>{err}</div>)}
            </div>
          )}

          {message && (
            <div style={message.type === "success" ? styles.successBox : styles.errorBox}>
              {message.text}
            </div>
          )}

          <div style={styles.actions}>
            <button onClick={handleSave} disabled={saving} style={styles.saveBtn}>
              {saving ? "Saving..." : "Save Override"}
            </button>
            {hasExisting && (
              <button onClick={handleDelete} disabled={saving} style={styles.deleteBtn}>
                Delete
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

const styles = {
  container: {
    background: "rgba(15,18,30,0.9)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 12,
    padding: "16px 20px",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  title: {
    fontSize: 13,
    fontWeight: 700,
    color: "#f1f5f9",
  },
  totalDistance: {
    fontSize: 11,
    color: "rgba(241,245,249,0.6)",
  },
  segmentRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  segmentLabel: {
    fontSize: 10,
    fontWeight: 600,
    color: "rgba(241,245,249,0.5)",
    width: 50,
    flexShrink: 0,
  },
  input: {
    padding: "6px 10px",
    borderRadius: 6,
    border: "1px solid rgba(255,255,255,0.1)",
    background: "rgba(255,255,255,0.05)",
    color: "#f1f5f9",
    fontSize: 12,
    outline: "none",
    flex: 1,
  },
  select: {
    padding: "6px 10px",
    borderRadius: 6,
    border: "1px solid rgba(255,255,255,0.1)",
    background: "rgba(255,255,255,0.05)",
    color: "#f1f5f9",
    fontSize: 12,
    outline: "none",
    cursor: "pointer",
  },
  kmLabel: {
    fontSize: 11,
    color: "rgba(241,245,249,0.5)",
  },
  actions: {
    display: "flex",
    gap: 8,
    marginTop: 12,
  },
  saveBtn: {
    padding: "7px 16px",
    borderRadius: 6,
    border: "1px solid rgba(59,130,246,0.5)",
    background: "rgba(59,130,246,0.15)",
    color: "#93c5fd",
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
  },
  deleteBtn: {
    padding: "7px 16px",
    borderRadius: 6,
    border: "1px solid rgba(239,68,68,0.4)",
    background: "rgba(239,68,68,0.1)",
    color: "#fca5a5",
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
  },
  errorBox: {
    background: "rgba(239,68,68,0.1)",
    border: "1px solid rgba(239,68,68,0.3)",
    borderRadius: 6,
    padding: "8px 12px",
    fontSize: 11,
    color: "#fca5a5",
    marginTop: 8,
  },
  successBox: {
    background: "rgba(34,197,94,0.1)",
    border: "1px solid rgba(34,197,94,0.3)",
    borderRadius: 6,
    padding: "8px 12px",
    fontSize: 11,
    color: "#86efac",
    marginTop: 8,
  },
  loadingText: {
    fontSize: 11,
    color: "rgba(241,245,249,0.5)",
  },
};
