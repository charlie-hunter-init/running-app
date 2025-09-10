import React from "react";
import { fmtDate, km } from "../../lib/geo";

export default function ActivitiesTable({ features }) {
  const rows = React.useMemo(() => {
    return (features || []).map((f) => {
      const p = f.properties || {};
      return {
        id: p.id,
        date: fmtDate(p.start_date),
        name: p.name || "(untitled)",
        type: p.type || "-",
        km: km(p.distance_m || 0),
        shoe: p.shoe_name || p.gear_name || p.gear_id || "-",
      };
    }).sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [features]);

  return (
    <div style={{ background: "#fff", border: "1px solid #eee", borderRadius: 8, overflow: "hidden" }}>
      <div style={{ padding: "8px 12px", borderBottom: "1px solid #eee", fontWeight: 600 }}>Activities</div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: 8 }}>Date</th>
              <th style={{ textAlign: "left", padding: 8 }}>Name</th>
              <th style={{ textAlign: "left", padding: 8 }}>Type</th>
              <th style={{ textAlign: "right", padding: 8 }}>Distance (km)</th>
              <th style={{ textAlign: "left", padding: 8 }}>Shoe</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={{ padding: 8, borderTop: "1px solid #f1f5f9" }}>{r.date}</td>
                <td style={{ padding: 8, borderTop: "1px solid #f1f5f9" }}>{r.name}</td>
                <td style={{ padding: 8, borderTop: "1px solid #f1f5f9" }}>{r.type}</td>
                <td style={{ padding: 8, borderTop: "1px solid #f1f5f9", textAlign: "right" }}>{r.km}</td>
                <td style={{ padding: 8, borderTop: "1px solid #f1f5f9" }}>{r.shoe}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

