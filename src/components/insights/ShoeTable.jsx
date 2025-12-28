import React from "react";
import { fmtDate } from "../../lib/geo";

export default function ShoeTable({ byShoe }) {
  const rows = React.useMemo(() => {
    const arr = Object.entries(byShoe || {}).map(([shoe, v]) => ({
      shoe,
      km: v?.distance_m != null ? (v.distance_m / 1000).toFixed(1) : "0.0",
      runs: v?.count || 0,
      last: v?.last_date ? new Date(v.last_date) : null,
      lastStr: v?.last_date ? fmtDate(v.last_date) : "—",
    }));

    arr.sort((a, b) => {
      if (a.last && b.last) return b.last - a.last;
      if (a.last && !b.last) return -1;
      if (!a.last && b.last) return 1;
      return 0;
    });

    return arr;
  }, [byShoe]);

  return (
    <div
      style={{
        width: "100%",
        overflow: "hidden",
        borderRadius: 16,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.03)",
      }}
    >
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
          <thead>
            <tr>
              <th style={th("left")}>Shoe</th>
              <th style={th("right")}>Km</th>
              <th style={th("right")}>Runs</th>
              <th style={th("left")}>Last used</th>
            </tr>
          </thead>

          <tbody>
            {rows.map((r, idx) => (
              <tr
                key={r.shoe}
                style={{
                  background: idx % 2 === 0 ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.00)",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(99,102,241,0.10)")}
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background =
                    idx % 2 === 0 ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.00)")
                }
              >
                <td style={td("left")}>
                  <div style={{ fontWeight: 800, color: "rgba(255,255,255,0.92)" }}>{r.shoe}</div>
                </td>
                <td style={td("right")}>{r.km}</td>
                <td style={td("right")}>{r.runs}</td>
                <td style={td("left")}>{r.lastStr}</td>
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
