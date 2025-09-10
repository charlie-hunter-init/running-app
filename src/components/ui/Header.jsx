import React from "react";

export default function Header({
  tab, setTab,
  year, yearOptions, setYear,
  type, typeOptions, setType,
  shoe, shoeOptions, setShoe,
  radius, setRadius,
  blur, setBlur,
  palette, setPalette, gradients,
  lineColorName, setLineColorName, lineColors,
  showLines, setShowLines,
}) {
  return (
    <div style={{ width: "100%", borderBottom: "1px solid #e5e7eb", background: "#fff", padding: "12px 16px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
      <h1 style={{ fontSize: 20, fontWeight: 600, marginRight: "auto" }}>Strava Global Heatmap</h1>

      <div style={{ display: "flex", gap: 8, marginRight: 16 }}>
        <button onClick={() => setTab("map")} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #e5e7eb", background: tab === "map" ? "#eef2ff" : "#fff" }}>Map</button>
        <button onClick={() => setTab("insights")} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #e5e7eb", background: tab === "insights" ? "#eef2ff" : "#fff" }}>Insights</button>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <label style={{ fontSize: 14 }}>Year</label>
        <select value={year} onChange={(e) => setYear(e.target.value)} style={{ border: "1px solid #e5e7eb", borderRadius: 6, padding: "4px 8px", fontSize: 14 }}>
          {yearOptions.map((y) => (<option key={y} value={y}>{y}</option>))}
        </select>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <label style={{ fontSize: 14 }}>Type</label>
        <select value={type} onChange={(e) => setType(e.target.value)} style={{ border: "1px solid #e5e7eb", borderRadius: 6, padding: "4px 8px", fontSize: 14 }}>
          {typeOptions.map((t) => (<option key={t} value={t}>{t}</option>))}
        </select>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <label style={{ fontSize: 14 }}>Shoe</label>
        <select value={shoe} onChange={(e) => setShoe(e.target.value)} style={{ border: "1px solid #e5e7eb", borderRadius: 6, padding: "4px 8px", fontSize: 14, maxWidth: 220 }}>
          {shoeOptions.map((s) => (<option key={s} value={s}>{s}</option>))}
        </select>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <label style={{ fontSize: 14 }}>Radius</label>
        <input type="range" min={4} max={30} value={radius} onChange={(e) => setRadius(Number(e.target.value))} />
        <span style={{ fontSize: 14, width: 24, textAlign: "center" }}>{radius}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <label style={{ fontSize: 14 }}>Blur</label>
        <input type="range" min={4} max={40} value={blur} onChange={(e) => setBlur(Number(e.target.value))} />
        <span style={{ fontSize: 14, width: 24, textAlign: "center" }}>{blur}</span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <label style={{ fontSize: 14 }}>Palette</label>
        <select value={palette} onChange={(e) => setPalette(e.target.value)} style={{ border: "1px solid #e5e7eb", borderRadius: 6, padding: "4px 8px", fontSize: 14 }}>
          {Object.keys(gradients).map((k) => (<option key={k} value={k}>{k}</option>))}
        </select>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <label style={{ fontSize: 14 }}>Line colour</label>
        <select value={lineColorName} onChange={(e) => setLineColorName(e.target.value)} style={{ border: "1px solid #e5e7eb", borderRadius: 6, padding: "4px 8px", fontSize: 14 }}>
          {Object.keys(lineColors).map((k) => (<option key={k} value={k}>{k}</option>))}
        </select>
      </div>
      <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14 }}>
        <input type="checkbox" checked={showLines} onChange={(e) => setShowLines(e.target.checked)} />
        Show lines
      </label>
    </div>
  );
}

