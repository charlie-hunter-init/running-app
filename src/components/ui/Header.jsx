import React from "react";

export default function Header({
  tab, setTab,
  year, yearOptions, setYear,
  type, typeOptions, setType,
  shoe, shoeOptions, setShoe,
  lineColorName, setLineColorName, lineColors,
  onFile,
}) {
  const isWrapped = tab === "wrapped";
  const filterStyle = isWrapped
    ? { opacity: 0.5, pointerEvents: "none" }
    : undefined;

  return (
    <div
      style={{
        width: "100%",
        borderBottom: "1px solid #e5e7eb",
        background: "#fff",
        padding: "12px 16px",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 12,
      }}
    >
      <h1 style={{ fontSize: 20, fontWeight: 600, marginRight: "auto" }}>
        Global running Heatmap
      </h1>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, marginRight: 16 }}>
        <TabButton label="Map"            isActive={tab === "map"}       onClick={() => setTab("map")} />
        <TabButton label="Insights"       isActive={tab === "insights"}  onClick={() => setTab("insights")} />
        <TabButton label="Calendar"       isActive={tab === "calendar"}  onClick={() => setTab("calendar")} />
        <TabButton label="Wrapped"        isActive={tab === "wrapped"}   onClick={() => setTab("wrapped")} />
        <TabButton label="Personal Best"  isActive={tab === "pb"}        onClick={() => setTab("pb")} />
      </div>

      {/* Filters (disabled on Wrapped tab) */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, ...filterStyle }}>
        <label style={{ fontSize: 14 }}>Year</label>
        <select
          value={year}
          onChange={(e) => setYear(e.target.value)}
          style={{ border: "1px solid #e5e7eb", borderRadius: 6, padding: "4px 8px", fontSize: 14 }}
          disabled={isWrapped}
        >
          {yearOptions.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, ...filterStyle }}>
        <label style={{ fontSize: 14 }}>Type</label>
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          style={{ border: "1px solid #e5e7eb", borderRadius: 6, padding: "4px 8px", fontSize: 14 }}
          disabled={isWrapped}
        >
          {typeOptions.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, ...filterStyle }}>
        <label style={{ fontSize: 14 }}>Shoe</label>
        <select
          value={shoe}
          onChange={(e) => setShoe(e.target.value)}
          style={{ border: "1px solid #e5e7eb", borderRadius: 6, padding: "4px 8px", fontSize: 14, maxWidth: 220 }}
          disabled={isWrapped}
        >
          {shoeOptions.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, ...filterStyle }}>
        <label style={{ fontSize: 14 }}>Line colour</label>
        <select
          value={lineColorName}
          onChange={(e) => setLineColorName(e.target.value)}
          style={{ border: "1px solid #e5e7eb", borderRadius: 6, padding: "4px 8px", fontSize: 14 }}
          disabled={isWrapped}
        >
          {Object.keys(lineColors).map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
      </div>

      {isWrapped && (
        <div style={{ fontSize: 12, color: "#6b7280" }}>
          Wrapped uses calendar years only (this year vs last year).
        </div>
      )}

      {/* Optional file input (kept, since you were already wiring onFile) */}
      {/* <input type="file" accept="application/geo+json,application/json" onChange={onFile} /> */}
    </div>
  );
}

function TabButton({ label, isActive, onClick }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={isActive}
      style={{
        padding: "6px 10px",
        borderRadius: 6,
        border: "1px solid #e5e7eb",
        background: isActive ? "#eef2ff" : "#fff",
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}
