import React, { useState, useMemo } from "react";

export default function Header({
  tab, setTab,
  year, yearOptions, setYear,
  type, typeOptions, setType,
  shoe, shoeOptions, setShoe,
  lineColorName, setLineColorName, heatGradients,
  lineMode, setLineMode,
  lineColor, setLineColor, lineColors,
  onFile,
  themeMode = "dark",
  toggleTheme,
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

        {/* Sync button */}
        <SyncButton />

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          title={themeMode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          aria-label={themeMode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          style={{
            padding: "7px 11px",
            borderRadius: 999,
            border: `1px solid ${themeMode === "light" ? "rgba(0,0,0,0.15)" : "rgba(255,255,255,0.15)"}`,
            background: themeMode === "light" ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.08)",
            color: themeMode === "light" ? "#334155" : "rgba(229,231,235,0.9)",
            fontSize: 15,
            lineHeight: 1,
            cursor: "pointer",
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "background .15s ease, border-color .15s ease",
          }}
        >
          {themeMode === "dark" ? "☀️" : "🌙"}
        </button>
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
          {/* Map mode controls — line mode toggle + heat/line colour picker */}
          {tab === "map" && (
            <div style={{ ...styles.control(isMobile), gap: 10, flexWrap: "wrap" }}>
              {/* Line mode toggle */}
              <button
                onClick={() => setLineMode(v => !v)}
                aria-pressed={lineMode}
                style={{
                  padding: "5px 11px",
                  borderRadius: 999,
                  border: lineMode
                    ? "1px solid rgba(255,255,255,0.7)"
                    : "1px solid rgba(255,255,255,0.2)",
                  background: lineMode
                    ? "rgba(255,255,255,0.15)"
                    : "rgba(255,255,255,0.05)",
                  color: lineMode ? "#fff" : "rgba(229,231,235,0.7)",
                  fontWeight: 800,
                  fontSize: 12,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  transition: "all .15s ease",
                  letterSpacing: 0.3,
                }}
              >
                {lineMode ? "● Line" : "○ Line"}
              </button>

              <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.12)", flexShrink: 0 }} />

              {lineMode ? (
                /* Line colour picker */
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <label style={styles.controlLabel}>Colour</label>
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                    {Object.entries(lineColors).map(([name, hex]) => {
                      const isActive = lineColor === name;
                      return (
                        <button
                          key={name}
                          title={name}
                          onClick={() => setLineColor(name)}
                          aria-pressed={isActive}
                          aria-label={`Line colour: ${name}`}
                          style={{
                            width: 22,
                            height: 22,
                            borderRadius: "50%",
                            border: isActive
                              ? "2px solid #fff"
                              : "2px solid rgba(255,255,255,0.2)",
                            background: hex,
                            cursor: "pointer",
                            padding: 0,
                            flexShrink: 0,
                            boxShadow: isActive
                              ? `0 0 0 3px rgba(255,255,255,0.2), 0 0 8px ${hex}`
                              : "none",
                            transition: "box-shadow .15s ease, border-color .15s ease",
                          }}
                        />
                      );
                    })}
                  </div>
                </div>
              ) : (
                /* Heat gradient swatches */
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <label style={styles.controlLabel}>Heat</label>
                  <div style={{ display: "flex", gap: 5 }}>
                    {Object.entries(heatGradients).map(([name, g]) => {
                      const isActive = lineColorName === name;
                      const swatchColor = `rgb(${g.r},${g.g},${g.b})`;
                      return (
                        <button
                          key={name}
                          title={name}
                          onClick={() => setLineColorName(name)}
                          aria-pressed={isActive}
                          aria-label={`Heat colour: ${name}`}
                          style={{
                            width: 22,
                            height: 22,
                            borderRadius: "50%",
                            border: isActive
                              ? "2px solid #fff"
                              : "2px solid rgba(255,255,255,0.2)",
                            background: `radial-gradient(circle at 35% 35%, white, ${swatchColor})`,
                            cursor: "pointer",
                            padding: 0,
                            flexShrink: 0,
                            boxShadow: isActive
                              ? `0 0 0 3px rgba(255,255,255,0.25), 0 0 10px ${swatchColor}`
                              : "none",
                            transition: "box-shadow .15s ease, border-color .15s ease",
                          }}
                        />
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
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
    background: "var(--header-bg, rgba(5,6,10,0.9))",
    borderBottom: "1px solid var(--header-border, rgba(255,255,255,0.08))",
    padding: isMobile ? "8px 10px" : "14px 18px",
    display: "flex",
    flexDirection: "column",
    gap: isMobile ? 6 : 12,
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
      : "repeat(3, minmax(120px, 1fr)) minmax(220px, auto)",
    gap: isMobile ? 8 : 14,
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

// ---- Sync Button (dev only) ----
function SyncButton() {
  const [syncing, setSyncing] = React.useState(false);
  const [result, setResult] = React.useState(null); // "ok" | "error"

  const handleSync = async () => {
    if (syncing) return;
    setSyncing(true);
    setResult(null);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      if (res.ok) {
        setResult("ok");
        // Reload data after a short delay
        setTimeout(() => window.location.reload(), 1500);
      } else {
        setResult("error");
      }
    } catch {
      setResult("error");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <button
      onClick={handleSync}
      disabled={syncing}
      title={syncing ? "Syncing..." : "Sync latest data from Strava"}
      aria-label="Sync data"
      style={{
        width: 32,
        height: 32,
        borderRadius: 999,
        border: `1px solid ${result === "error" ? "rgba(239,68,68,0.5)" : result === "ok" ? "rgba(16,185,129,0.5)" : "rgba(255,255,255,0.15)"}`,
        background: result === "error" ? "rgba(239,68,68,0.1)" : result === "ok" ? "rgba(16,185,129,0.1)" : "rgba(255,255,255,0.08)",
        color: result === "error" ? "#ef4444" : result === "ok" ? "#10b981" : "rgba(229,231,235,0.9)",
        fontSize: 14,
        cursor: syncing ? "wait" : "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        transition: "all .2s",
        animation: syncing ? "spin 1s linear infinite" : "none",
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    </button>
  );
}
