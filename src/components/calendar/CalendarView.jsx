import React from "react";
import CalendarMileageFill from "./CalendarMileageDots";

/**
 * CalendarView
 * A simple page wrapper for the circle-only mileage calendar.
 *
 * Props:
 * - features: all GeoJSON features (unfiltered)
 * - filtered: filtered features (if you prefer, pass this instead)
 */
export default function CalendarView({ features, filtered }) {
  // Use filtered so the calendar respects the current filters,
  // switch to `features` if you want all-time instead.
  const source = filtered?.length ? filtered : features;

  return (
    <div style={{ height: "100%", overflow: "auto", padding: 16 }}>
      <CalendarMileageFill
        features={source}
        // Optional knobs:
         maxKmForScale={30}
        // startFromLatest={true}
        onDayClick={(key, km) => console.log("Clicked day:", key, km)}
        title="Mileage calendar"
      />
    </div>
  );
}
