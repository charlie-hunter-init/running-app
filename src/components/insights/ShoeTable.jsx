import React from "react";
import { fmtDate } from "../../lib/geo";

export default function ShoeTable({ byShoe }) {
  const rows = React.useMemo(() => {
    const arr = Object.entries(byShoe || {}).map(([shoe, v]) => ({
      shoe,
      km: (v.distance_m / 1000).toFixed(1),
      runs: v.count || 0,
      last: v.last_date ? new Date(v.last_date) : null,
      lastStr: v.last_date ? fmtDate(v.last_date) : "-",
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
    <div style={{ background: "#fff", border: "1px solid #eee", borderRadius: 8, overflow: "hidden" }}>
      <div style={{ padding: "8px 12px", borderBottom: "1px solid #eee", fontWeight: 600 }}>Shoe Totals (last used)</div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: 8 }}>Shoe</th>
              <th style={{ textAlign: "right", padding: 8 }}>Km</th>
              <th style={{ textAlign: "right", padding: 8 }}>Runs</th>
              <th style={{ textAlign: "left", padding: 8 }}>Last used</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.shoe}>
                <td style={{ padding: 8, borderTop: "1px solid #f1f5f9" }}>{r.shoe}</td>
                <td style={{ padding: 8, borderTop: "1px solid #f1f5f9", textAlign: "right" }}>{r.km}</td>
                <td style={{ padding: 8, borderTop: "1px solid #f1f5f9", textAlign: "right" }}>{r.runs}</td>
                <td style={{ padding: 8, borderTop: "1px solid #f1f5f9" }}>{r.lastStr}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

