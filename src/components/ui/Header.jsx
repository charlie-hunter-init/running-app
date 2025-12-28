import React, { useState, useMemo } from "react";

export default function Header({
  tab, setTab,
  year, yearOptions, setYear,
  type, typeOptions, setType,
  shoe, shoeOptions, setShoe,
  lineColorName, setLineColorName, lineColors,
  onFile,
  tabs = [
    { id: "map", label: "Map" },
    { id: "insights", label: "Insights" },
    { id: "calendar", label: "Calendar" },
    { id: "wrapped", label: "Wrapped" },
    { id: "pb", label: "PBs" },
  ],
  isMobile = false,
}) {
  const [showFilters, setShowFilters] = useState(false);

  const filtersRelevant = useMemo(
    () => tab === "map" || tab === "insights",
    [tab]
  );
  const shouldShowFilters = !isMobile || (showFilters && filtersRelevant);

  return (
    <header style={styles.root(isMobile)}>
      {/* Top strip: title + tabs */}
      <div style={styles.topStrip(isMobile)}>
        <h1 style={styles.title(isMobile)}>Running Heatmap</h1>

        {isMobile && filtersRelevant && (
          <button
            onClick={() => setShowFilters(v => !v)}
            style={styles.filtersToggle(showFilters)}
            aria-expanded={showFilters}
            aria-controls="filters-row"
          >
            Filters {showFilters ? "▲" : "▼"}
          </button>
        )}

        <nav
          style={{
            ...styles.tabsRow,
            overflowX: isMobile ? "auto" : "visible",
            WebkitOverflowScrolling: "touch",
          }}
        >
          {tabs.map((t) => (
            <TabButton
              key={t.id}
              label={t.label}
              isActive={tab === t.id}
              onClick={() => {
                setTab(t.id);
                if (isMobile) setShowFilters(false);
              }}
            />
          ))}
        </nav>
      </div>

      {/* Filters row */}
      {shouldShowFilters && (
        <div id="filters-row" style={styles.filtersRow(isMobile)}>
          <SelectControl
            label="Year"
            value={year}
            onChange={setYear}
            options={yearOptions}
            isMobile={isMobile}
          />
          <SelectControl
            label="Type"
            value={type}
            onChange={setType}
            options={typeOptions}
            isMobile={isMobile}
          />
          <SelectControl
            label="Shoe"
            value={shoe}
            onChange={setShoe}
            options={shoeOptions}
            isMobile={isMobile}
          />
          <SelectControl
            label="Line colour"
            value={lineColorName}
            onChange={setLineColorName}
            options={Object.keys(lineColors)}
            isMobile={isMobile}
          />
        </div>
      )}
    </header>
  );
}

function SelectControl({ label, value, onChange, options, isMobile }) {
  return (
    <div style={styles.control(isMobile)}>
      <label style={styles.controlLabel}>{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={styles.select(isMobile)}
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    </div>
  );
}

function TabButton({ label, isActive, onClick }) {
  const activeStyle = isActive
    ? {
        background:
          "linear-gradient(180deg, rgba(99,102,241,0.35), rgba(99,102,241,0.15))",
        borderColor: "rgba(167,139,250,0.95)",
        color: "#ffffff",
        boxShadow:
          "0 0 0 2px rgba(167,139,250,0.22), 0 8px 24px rgba(99,102,241,0.35)",
      }
    : {
        background: "rgba(255,255,255,0.04)",
        borderColor: "rgba(255,255,255,0.12)",
        color: "rgba(229,231,235,0.9)",
      };

  return (
    <button
      onClick={onClick}
      aria-pressed={isActive}
      style={{ ...styles.tabBtn, ...activeStyle }}
      onMouseEnter={(e) => {
        if (!isActive) e.currentTarget.style.background = "rgba(255,255,255,0.08)";
      }}
      onMouseLeave={(e) => {
        if (!isActive) e.currentTarget.style.background = "rgba(255,255,255,0.04)";
      }}
    >
      {label}
    </button>
  );
}

const styles = {
  root: (isMobile) => ({
    width: "100%",
    background: "rgba(5,6,10,0.9)",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
    padding: isMobile ? "8px 10px" : "14px 18px", // more breathing room desktop
    display: "flex",
    flexDirection: "column",
    gap: isMobile ? 6 : 12, // bigger vertical spacing on desktop
    position: "sticky",
    top: 0,
    zIndex: 20,
    backdropFilter: "blur(8px)",
  }),

  // title + tabs row
  topStrip: (isMobile) => ({
    display: "flex",
    alignItems: "center",
    gap: isMobile ? 8 : 14, // spread out desktop
    flexWrap: isMobile ? "wrap" : "nowrap",
  }),

  title: (isMobile) => ({
    fontWeight: 800,
    letterSpacing: -0.2,
    fontSize: isMobile ? 14 : 20,
    margin: 0,
    color: "#fff",
    marginRight: isMobile ? 0 : 12,
    whiteSpace: "nowrap",
  }),

  filtersToggle: (open) => ({
    padding: "6px 10px",
    borderRadius: 999,
    border: `1px solid ${open ? "rgba(99,102,241,0.9)" : "rgba(255,255,255,0.14)"}`,
    background: open ? "rgba(99,102,241,0.16)" : "rgba(255,255,255,0.06)",
    color: "#fff",
    fontWeight: 800,
    fontSize: 12,
    cursor: "pointer",
    whiteSpace: "nowrap",
  }),

  tabsRow: {
    display: "flex",
    gap: 8,              // wider gap between tabs
    maxWidth: "100%",
    paddingBottom: 2,
    marginLeft: "auto",  // push tabs to the right on desktop
  },

  tabBtn: {
    padding: "7px 12px", // slightly larger pills
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.12)",
    fontWeight: 800,
    fontSize: 13,
    cursor: "pointer",
    whiteSpace: "nowrap",
    transition: "background .12s ease, border-color .12s ease, box-shadow .12s ease, color .12s ease",
    outline: "none",
  },

  // filters in a grid on desktop, wrap on mobile
  filtersRow: (isMobile) => ({
    display: "grid",
    gridTemplateColumns: isMobile
      ? "1fr 1fr"
      : "repeat(4, minmax(140px, 1fr))",
    gap: isMobile ? 8 : 14, // big horizontal/vertical spacing desktop
    alignItems: "center",
  }),

  control: (isMobile) => ({
    display: "flex",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
  }),

  controlLabel: {
    fontSize: 12,
    color: "rgba(229,231,235,0.85)",
    fontWeight: 700,
    whiteSpace: "nowrap",
  },

  select: (isMobile) => ({
    width: "100%",
    border: "1px solid rgba(255,255,255,0.14)",
    borderRadius: 10,
    padding: "7px 10px",
    fontSize: 13,
    background: "rgba(255,255,255,0.06)",
    color: "#fff",
    outline: "none",
  }),
};
