import React, { useMemo } from "react";
import DatePicker from "react-datepicker";

// Helpers for YYYY-MM-DD <-> Date (local-safe)
function toDateFromYMD(ymd) {
  if (!ymd) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}
function toYMDFromDate(date) {
  if (!(date instanceof Date)) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export default function TimelineControls({
  enabled,
  setEnabled,
  startDay,
  setStartDay,
  endDay,
  setEndDay,
  minDay,
  maxDay,
  isPlaying,
  onTogglePlay,
  cursorIdx,
  setCursorIdx,
  playableDays,
  daysPerTick,
  setDaysPerTick,
}) {
  const maxIdx = Math.max(0, playableDays.length - 1);
  const safeIdx = Math.min(cursorIdx, maxIdx);
  const cursorDay = playableDays.length ? playableDays[safeIdx] : null;

  const speedOptions = useMemo(
    () => [
      { label: "1d", v: 1 },
      { label: "3d", v: 3 },
      { label: "7d", v: 7 },
      { label: "14d", v: 14 },
    ],
    []
  );

  const minDate = toDateFromYMD(minDay);
  const maxDate = toDateFromYMD(maxDay);

  const startDate = toDateFromYMD(startDay);
  const endDate = toDateFromYMD(endDay);

  // How many years to show in the dropdown.
  // If min/max exist, compute from that; else default to 30.
  const yearSpan = useMemo(() => {
    if (minDate && maxDate) {
      const diff = Math.abs(maxDate.getFullYear() - minDate.getFullYear()) + 1;
      return Math.min(120, Math.max(10, diff));
    }
    return 30;
  }, [minDate, maxDate]);

  const commonPickerProps = {
    minDate: minDate || undefined,
    maxDate: maxDate || undefined,
    dateFormat: "yyyy-MM-dd",
    placeholderText: "Select date",
    popperPlacement: "bottom-start",
    showPopperArrow: false,

    // ✅ Year + month dropdowns
    showYearDropdown: true,
    showMonthDropdown: true,
    dropdownMode: "select",

    // Optional: show a bigger year range + make it scrollable
    yearDropdownItemNumber: yearSpan,
    scrollableYearDropdown: true,

    customInput: <DarkDateInput />,
  };

  return (
    <div
      style={{
        padding: 12,
        borderBottom: enabled ? "1px solid rgba(255,255,255,0.08)" : "none",
        background: enabled ? "rgba(255,255,255,0.03)" : "transparent",
      }}
    >
      {/* Always visible */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            id="timeline-toggle"
          />
          <label htmlFor="timeline-toggle" style={{ color: "rgba(255,255,255,0.9)", fontSize: 13 }}>
            Timeline
          </label>
        </div>

        <button
          onClick={onTogglePlay}
          disabled={!enabled || playableDays.length === 0}
          style={btnStyle(!enabled || playableDays.length === 0)}
        >
          {isPlaying ? "Pause" : "Play"}
        </button>
      </div>

      {!enabled ? null : (
        <>
          {/* Date pickers */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
            <div>
              <div style={labelStyle}>Start</div>
              <DatePicker
                {...commonPickerProps}
                selected={startDate}
                onChange={(d) => setStartDay(toYMDFromDate(d))}
              />
            </div>

            <div>
              <div style={labelStyle}>End</div>
              <DatePicker
                {...commonPickerProps}
                selected={endDate}
                onChange={(d) => setEndDay(toYMDFromDate(d))}
              />
            </div>
          </div>

          <div style={{ marginTop: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
              <div style={{ color: "rgba(255,255,255,0.75)", fontSize: 12 }}>
                {cursorDay ? `Showing up to ${cursorDay}` : "No days in range"}
              </div>

              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  onClick={() => setCursorIdx(0)}
                  disabled={playableDays.length === 0}
                  style={pillStyle(playableDays.length === 0)}
                >
                  Start
                </button>
                <button
                  onClick={() => setCursorIdx(maxIdx)}
                  disabled={playableDays.length === 0}
                  style={pillStyle(playableDays.length === 0)}
                >
                  End
                </button>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", marginTop: 8 }}>
              <div style={{ display: "flex", gap: 6 }}>
                {speedOptions.map((o) => (
                  <button
                    key={o.v}
                    onClick={() => setDaysPerTick(o.v)}
                    style={{
                      padding: "4px 8px",
                      borderRadius: 999,
                      border: "1px solid rgba(255,255,255,0.15)",
                      background: daysPerTick === o.v ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.06)",
                      color: "rgba(255,255,255,0.85)",
                      cursor: "pointer",
                      fontSize: 12,
                    }}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            <input
              type="range"
              min={0}
              max={maxIdx}
              value={safeIdx}
              onChange={(e) => setCursorIdx(Number(e.target.value))}
              disabled={playableDays.length === 0}
              style={{ width: "100%", marginTop: 8 }}
            />

            <div style={{ color: "rgba(255,255,255,0.55)", fontSize: 12, marginTop: 6 }}>
              Days in range: {playableDays.length}
            </div>
          </div>

          {/* Dark theme overrides for react-datepicker */}
          <style>{darkDatepickerCss}</style>
        </>
      )}
    </div>
  );
}

const DarkDateInput = React.forwardRef(function DarkDateInput(props, ref) {
  const { value, onClick, placeholder } = props;
  return (
    <button
      type="button"
      ref={ref}
      onClick={onClick}
      style={{
        width: "100%",
        textAlign: "left",
        padding: "8px 10px",
        borderRadius: 10,
        border: "1px solid rgba(255,255,255,0.12)",
        background: "rgba(0,0,0,0.25)",
        color: value ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.45)",
        outline: "none",
        fontSize: 13,
        cursor: "pointer",
      }}
    >
      {value || placeholder || "Select date"}
    </button>
  );
});

const labelStyle = { color: "rgba(255,255,255,0.65)", fontSize: 12, marginBottom: 4 };

function btnStyle(disabled) {
  return {
    padding: "6px 10px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.15)",
    background: disabled ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.06)",
    color: "rgba(255,255,255,0.9)",
    cursor: disabled ? "not-allowed" : "pointer",
  };
}

function pillStyle(disabled) {
  return {
    padding: "4px 8px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.15)",
    background: "rgba(255,255,255,0.06)",
    color: "rgba(255,255,255,0.85)",
    cursor: disabled ? "not-allowed" : "pointer",
    fontSize: 12,
  };
}

const darkDatepickerCss = `
  .react-datepicker-popper { z-index: 5000; }
  .react-datepicker {
    background: rgba(10, 12, 18, 0.96);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 14px;
    box-shadow: 0 18px 45px rgba(0,0,0,0.55);
    overflow: hidden;
  }
  .react-datepicker__header {
    background: rgba(255,255,255,0.04);
    border-bottom: 1px solid rgba(255,255,255,0.10);
    padding-top: 10px;
  }
  .react-datepicker__current-month { color: rgba(255,255,255,0.92); font-weight: 600; }
  .react-datepicker__day-name { color: rgba(255,255,255,0.55); }
  .react-datepicker__day {
    color: rgba(255,255,255,0.80);
    border-radius: 10px;
    width: 2.0rem;
    line-height: 2.0rem;
    margin: 0.12rem;
  }
  .react-datepicker__day:hover { background: rgba(255,255,255,0.10); }
  .react-datepicker__day--disabled { color: rgba(255,255,255,0.20); }
  .react-datepicker__day--selected,
  .react-datepicker__day--keyboard-selected {
    background: rgba(255,255,255,0.18);
    color: rgba(255,255,255,0.95);
  }
  .react-datepicker__navigation-icon::before { border-color: rgba(255,255,255,0.75); }
  .react-datepicker__triangle { display: none; }

  /* Dropdowns */
  .react-datepicker__month-dropdown-container,
  .react-datepicker__year-dropdown-container {
    margin: 0 6px 8px 6px;
  }
  .react-datepicker__month-select,
  .react-datepicker__year-select {
    background: rgba(0,0,0,0.35);
    color: rgba(255,255,255,0.9);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 10px;
    padding: 6px 8px;
    font-size: 12px;
    outline: none;
  }
`;
