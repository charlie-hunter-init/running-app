import React from "react";
import CalendarMileageFill from "./CalendarMileageDots"; // ensure the filename matches

/**
 * CalendarView
 * Wrapper for the calendar. Uses items (from runs_index.json) for pace/duration.
 *
 * Props:
 * - features: all GeoJSON features (unfiltered)
 * - filtered: filtered features (optional)
 * - items:    indexData.items (preferred for correct pace/long/workout detection)
 */
export default function CalendarView({ features, filtered, items = [] }) {
  // If you want the calendar to respect current map filters, keep using `filtered` for geometry-based stuff.
  // For classification (walk/workout/long/jog), we rely on `items` which includes timing/pace.
  // You can optionally filter `items` to match your year/type/shoe filters if desired.

  return (
    <div style={{ height: "100%", overflow: "auto", padding: 16 }}>
      <CalendarMileageFill
        items={items}                 // <— use the data from runs_index.json
        // features={filtered?.length ? filtered : features} // optional fallback (not needed)
        title="Mileage calendar"
        maxKmForScale={30}
        // startFromLatest={true}
        // onDayClick={(key, km, slices) => console.log("Clicked:", key, km, slices)}
      />
    </div>
  );
}
