import React from "react";
import CalendarMileageFill from "./CalendarMileageDots";

/**
 * CalendarView
 * Wrapper for the calendar. Uses items (from runs_index.json) for pace/duration.
 */
export default function CalendarView({ features, filtered, items = [] }) {
  return (
    <div style={styles.page}>
      <div style={styles.wrap}>
        <CalendarMileageFill
          items={items}
          title="Mileage calendar"
          maxKmForScale={30}
          fitToContainer={true}
        />
      </div>
    </div>
  );
}

const styles = {
  page: {
    height: "100%",
    width: "100%",
    overflowY: "auto",
    overflowX: "hidden",
    WebkitOverflowScrolling: "touch",
    background:
      "radial-gradient(1200px 600px at 15% -10%, #1d4ed8 0%, transparent 60%)," +
      "radial-gradient(1000px 600px at 110% 20%, #06b6d4 0%, transparent 55%)," +
      "radial-gradient(1000px 600px at 50% 120%, #a855f7 0%, transparent 55%)," +
      "linear-gradient(180deg, #05060a 0%, #0b1020 100%)",
    color: "#e5e7eb",
  },
  wrap: {
    maxWidth: 1200,
    margin: "0 auto",
    padding: "18px 18px 36px",
  },
};
