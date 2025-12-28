import React from "react";
import { fmtDate, km } from "../../lib/geo";

export default function ActivitiesTable({ features }) {
  const rows = React.useMemo(() => {
    return (features || [])
      .map((f) => {
        const p = f.properties || {};
        const start = p.start_date ? new Date(p.start_date) : null;
        return {
          id: p.id ?? `${p.start_date || "na"}-${p.name || "na"}`,
          start,
          date: p.start_date ? fmtDate(p.start_date) : "—",
          name: p.name || "(untitled)",
          type: p.type || "—",
          km: km(p.distance_m || 0),
          shoe: p.shoe_name || p.gear_name || p.gear_id || "—",
        };
      })
      .sort((a, b) => {
        const at = a.start ? a.start.getTime() : 0;
        const bt = b.start ? b.start.getTime() : 0;
        return bt - at;
      });
  }, [features]);

  return (
    <div
      style={{
        width: "100%",
        borderRadius: 18,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.03)",
        overflow: "hidden",
      }}
    >
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
          <thead>
            <tr>
              <th style={th("left")}>Date</th>
              <th style={th("left")}>Name</th>
              <th style={th("left")}>Type</th>
              <th style={th("right")}>Distance</th>
              <th style={th("left")}>Shoe</th>
            </tr>
          </thead>

          <tbody>
            {rows.map((r, idx) => (
              <tr
                key={r.id}
                style={{
                  background: idx % 2 === 0 ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.00)",
                  transition: "background 120ms ease",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(99,102,241,0.10)")}
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background =
                    idx % 2 === 0 ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.00)")
                }
              >
                <td style={td("left")}>{r.date}</td>
                <td style={td("left")}>
                  <div style={{ fontWeight: 900, color: "rgba(255,255,255,0.92)" }}>{r.name}</div>
                </td>
                <td style={td("left")}>{r.type}</td>
                <td style={td("right")}>{r.km}</td>
                <td style={td("left")}>{r.shoe}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function th(align) {
  return {
    position: "sticky",
    top: 0,
    zIndex: 1,
    textAlign: align,
    padding: "10px 12px",
    fontSize: 12,
    fontWeight: 950,
    letterSpacing: "0.02em",
    color: "rgba(229,231,235,0.80)",
    background: "rgba(5,6,10,0.75)",
    backdropFilter: "blur(8px)",
    borderBottom: "1px solid rgba(255,255,255,0.10)",
    whiteSpace: "nowrap",
  };
}

function td(align) {
  return {
    textAlign: align,
    padding: "10px 12px",
    fontSize: 13,
    color: "rgba(229,231,235,0.85)",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
    whiteSpace: "nowrap",
  };
}
