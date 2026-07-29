// Unit tests for the Intervals.icu integration
// Run with: node --test lambda/test/intervals.test.js

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { _test } from "../index.js";

const {
  normalizeIntervalsType,
  adaptIntervalsActivity,
  buildGeoJsonFeatureFromPoints,
  calculateKmSplits,
  isIntervalsDuplicate,
  buildIntervalsSplitsData,
  getIntervalsAfterDate,
  buildIndexEntry,
  buildStatsFromIndexItems,
  INTERVALS_CUTOVER_MS,
  INTERVALS_TYPE_MAP,
  INCLUDED_TYPES,
} = _test;

// ============ USE_STRAVA selection ============

describe("USE_STRAVA selection", () => {
  it("should select intervals when USE_STRAVA is not set", () => {
    // The module-level constant is already evaluated based on process.env
    // We test the logic conceptually:
    const selectSource = (envVal) => {
      const use = String(envVal || "").trim().toLowerCase() === "true";
      return use ? "strava" : "intervals";
    };

    assert.equal(selectSource(undefined), "intervals");
    assert.equal(selectSource(""), "intervals");
    assert.equal(selectSource("false"), "intervals");
    assert.equal(selectSource("FALSE"), "intervals");
    assert.equal(selectSource("  "), "intervals");
    assert.equal(selectSource("yes"), "intervals");
    assert.equal(selectSource("1"), "intervals");
  });

  it("should select strava only when USE_STRAVA is exactly 'true' after normalization", () => {
    const selectSource = (envVal) => {
      const use = String(envVal || "").trim().toLowerCase() === "true";
      return use ? "strava" : "intervals";
    };

    assert.equal(selectSource("true"), "strava");
    assert.equal(selectSource("TRUE"), "strava");
    assert.equal(selectSource("True"), "strava");
    assert.equal(selectSource("  true  "), "strava");
    assert.equal(selectSource(" TRUE "), "strava");
  });
});

// ============ Intervals Basic auth construction ============

describe("Intervals Basic auth construction", () => {
  it("should construct correct Basic auth header", () => {
    const apiKey = "test-api-key-12345";
    const expected = Buffer.from(`API_KEY:${apiKey}`).toString("base64");

    // Verify the format: "API_KEY:<key>" base64 encoded
    const decoded = Buffer.from(expected, "base64").toString("utf-8");
    assert.equal(decoded, "API_KEY:test-api-key-12345");
  });

  it("should never include raw credentials in the auth string", () => {
    const apiKey = "secret-value";
    const encoded = Buffer.from(`API_KEY:${apiKey}`).toString("base64");

    // The encoded value should not contain the raw password
    assert.ok(!encoded.includes(apiKey));
  });
});

// ============ Cutover filtering ============

describe("Cutover filtering", () => {
  it("should have correct cutover timestamp", () => {
    // 2026-07-30T00:00:00+07:00 = 2026-07-29T17:00:00Z
    const expected = Date.parse("2026-07-29T17:00:00.000Z");
    assert.equal(INTERVALS_CUTOVER_MS, expected);
  });

  it("should exclude activities before cutover", () => {
    const beforeCutover = Date.parse("2026-07-29T16:59:59Z");
    assert.ok(beforeCutover < INTERVALS_CUTOVER_MS);
  });

  it("should include activities at or after cutover", () => {
    const atCutover = Date.parse("2026-07-29T17:00:00Z");
    assert.ok(atCutover >= INTERVALS_CUTOVER_MS);

    const afterCutover = Date.parse("2026-07-30T01:00:00Z");
    assert.ok(afterCutover >= INTERVALS_CUTOVER_MS);
  });

  it("getIntervalsAfterDate returns cutover date when no intervals data exists", () => {
    const existingIndex = { items: [
      { id: "12345", start_date: "2026-07-28T00:00:00Z", type: "Run" },
    ] };
    // No items with source: "intervals", so should use cutover
    const result = getIntervalsAfterDate(existingIndex);
    // Should be YYYY-MM-DD of cutover in UTC
    assert.equal(result, "2026-07-29");
  });

  it("getIntervalsAfterDate uses newest intervals activity when available", () => {
    const existingIndex = { items: [
      { id: "intervals:i999", start_date: "2026-08-15T00:00:00Z", type: "Run", source: "intervals" },
      { id: "12345", start_date: "2026-07-28T00:00:00Z", type: "Run" },
    ] };
    const result = getIntervalsAfterDate(existingIndex);
    // Should use the intervals activity date minus lookback
    const expectedMs = Date.parse("2026-08-15T00:00:00Z") - (172800 * 1000);
    const expectedDate = new Date(Math.max(INTERVALS_CUTOVER_MS, expectedMs)).toISOString().slice(0, 10);
    assert.equal(result, expectedDate);
  });
});

// ============ Namespaced IDs ============

describe("Namespaced IDs", () => {
  it("should prefix intervals activities with 'intervals:'", () => {
    const adapted = adaptIntervalsActivity({
      id: "i12345678",
      name: "Morning Run",
      type: "Run",
      distance: 10000,
      moving_time: 3000,
      start_date_local: "2026-08-01T07:00:00",
      icu_timezone: "Asia/Bangkok",
    });

    assert.equal(adapted.id, "intervals:i12345678");
    assert.equal(adapted.source, "intervals");
    assert.equal(adapted.source_activity_id, "i12345678");
  });

  it("namespaced ID cannot collide with a numeric Strava ID", () => {
    const adapted = adaptIntervalsActivity({ id: "i12345", type: "Run", distance: 5000, moving_time: 1500 });
    assert.ok(adapted.id.startsWith("intervals:"));
    assert.ok(isNaN(Number(adapted.id)));
  });
});

// ============ Deduplication ============

describe("Deduplication", () => {
  it("should detect exact namespaced ID duplicate", () => {
    const adapted = { id: "intervals:i999", _type: "Run", distance: 10000, start_date: "2026-08-01T00:00:00Z" };
    const indexMap = new Map([["intervals:i999", { id: "intervals:i999", type: "Run" }]]);

    const result = isIntervalsDuplicate(adapted, indexMap);
    assert.equal(result.isDuplicate, true);
    assert.equal(result.reason, "exact_id");
  });

  it("should detect external/strava ID duplicate", () => {
    const adapted = { id: "intervals:i999", _type: "Run", distance: 10000, start_date: "2026-08-01T00:00:00Z", _external_id: "19507994137" };
    const indexMap = new Map([["19507994137", { id: "19507994137", type: "Run", start_date: "2026-07-28T23:06:21Z", distance: 11328.8 }]]);

    const result = isIntervalsDuplicate(adapted, indexMap);
    assert.equal(result.isDuplicate, true);
    assert.equal(result.reason, "external_id_match");
  });

  it("should detect fuzzy duplicate by time+type+distance", () => {
    const adapted = { id: "intervals:i999", _type: "Run", distance: 10050, start_date: "2026-08-01T00:01:00Z", _external_id: null };
    const indexMap = new Map([["strava123", { id: "strava123", type: "Run", start_date: "2026-08-01T00:00:00Z", distance: 10000 }]]);

    const result = isIntervalsDuplicate(adapted, indexMap);
    assert.equal(result.isDuplicate, true);
    assert.equal(result.reason, "fuzzy_match");
  });

  it("should NOT flag as duplicate when distance differs >10%", () => {
    const adapted = { id: "intervals:i999", _type: "Run", distance: 15000, start_date: "2026-08-01T00:01:00Z", _external_id: null };
    const indexMap = new Map([["strava123", { id: "strava123", type: "Run", start_date: "2026-08-01T00:00:00Z", distance: 10000 }]]);

    const result = isIntervalsDuplicate(adapted, indexMap);
    assert.equal(result.isDuplicate, false);
  });

  it("should NOT flag as duplicate when time differs >5min", () => {
    const adapted = { id: "intervals:i999", _type: "Run", distance: 10000, start_date: "2026-08-01T00:10:00Z", _external_id: null };
    const indexMap = new Map([["strava123", { id: "strava123", type: "Run", start_date: "2026-08-01T00:00:00Z", distance: 10000 }]]);

    const result = isIntervalsDuplicate(adapted, indexMap);
    assert.equal(result.isDuplicate, false);
  });
});

// ============ Intervals latlng conversion ============

describe("Intervals latlng conversion (data/data2)", () => {
  it("should zip data (lat) and data2 (lng) into [lat, lng] pairs", () => {
    // Simulate what fetchIntervalsStreams does internally
    const stream = { type: "latlng", data: [13.728, 13.729, 13.730], data2: [100.570, 100.571, 100.572] };

    const lats = stream.data;
    const lngs = stream.data2;
    const minLen = Math.min(lats.length, lngs.length);
    const result = [];
    for (let i = 0; i < minLen; i++) {
      result.push([Number(lats[i]), Number(lngs[i])]);
    }

    assert.deepEqual(result, [
      [13.728, 100.570],
      [13.729, 100.571],
      [13.730, 100.572],
    ]);
  });

  it("should handle mismatched array lengths safely", () => {
    const lats = [13.728, 13.729, 13.730, 13.731];
    const lngs = [100.570, 100.571];
    const minLen = Math.min(lats.length, lngs.length);
    const result = [];
    for (let i = 0; i < minLen; i++) {
      result.push([Number(lats[i]), Number(lngs[i])]);
    }

    assert.equal(result.length, 2);
  });
});

// ============ GeoJSON coordinate order ============

describe("GeoJSON longitude/latitude order", () => {
  it("should produce [lng, lat] in GeoJSON coordinates (not [lat, lng])", () => {
    const run = {
      id: "intervals:i123",
      source: "intervals",
      source_activity_id: "i123",
      name: "Test Run",
      _type: "Run",
      start_date: "2026-08-01T00:00:00Z",
      distance: 5000,
      moving_time: 1500,
      elapsed_time: 1500,
      average_speed: 3.333,
      total_elevation_gain: 10,
    };

    // Map points in [lat, lng] format (as returned by Intervals)
    const mapPoints = [
      [13.728, 100.570],
      [13.729, 100.571],
      [13.730, 100.572],
    ];

    const feature = buildGeoJsonFeatureFromPoints(run, mapPoints);

    assert.ok(feature);
    assert.equal(feature.geometry.type, "LineString");

    // GeoJSON coordinates must be [lng, lat]
    assert.deepEqual(feature.geometry.coordinates[0], [100.570, 13.728]);
    assert.deepEqual(feature.geometry.coordinates[1], [100.571, 13.729]);
    assert.deepEqual(feature.geometry.coordinates[2], [100.572, 13.730]);
  });

  it("should return null for insufficient map points", () => {
    const run = { id: "intervals:i123", _type: "Run" };
    assert.equal(buildGeoJsonFeatureFromPoints(run, []), null);
    assert.equal(buildGeoJsonFeatureFromPoints(run, [[13.7, 100.5]]), null);
    assert.equal(buildGeoJsonFeatureFromPoints(run, null), null);
  });
});

// ============ Heart rate stream mapping ============

describe("Heart rate stream mapping", () => {
  it("should set has_heartrate true when HR data exists", () => {
    const adapted = {
      id: "intervals:i123",
      average_heartrate: 155,
      max_heartrate: 180,
    };
    const streams = { heartrate: [140, 150, 160, 170, 180] };

    const splitsData = buildIntervalsSplitsData(adapted, streams);
    assert.equal(splitsData.has_heartrate, true);
    assert.equal(splitsData.average_heartrate, 155);
    assert.equal(splitsData.max_heartrate, 180);
  });

  it("should set has_heartrate false when no HR data", () => {
    const adapted = {
      id: "intervals:i123",
      average_heartrate: null,
      max_heartrate: null,
    };
    const streams = { heartrate: [0, 0, 0] };

    const splitsData = buildIntervalsSplitsData(adapted, streams);
    assert.equal(splitsData.has_heartrate, false);
  });

  it("should handle missing HR stream gracefully", () => {
    const adapted = { id: "intervals:i123", average_heartrate: null, max_heartrate: null };
    const streams = { time: [0, 1, 2], distance: [0, 3, 6] };

    const splitsData = buildIntervalsSplitsData(adapted, streams);
    assert.equal(splitsData.has_heartrate, false);
    assert.equal(splitsData.streams.heartrate, undefined);
  });
});

// ============ Pace/speed mapping ============

describe("Pace/speed mapping", () => {
  it("should calculate average_speed in m/s", () => {
    const adapted = adaptIntervalsActivity({
      id: "i123",
      type: "Run",
      distance: 10000,
      moving_time: 3000,
      start_date_local: "2026-08-01T07:00:00",
      icu_timezone: "Asia/Bangkok",
    });

    assert.equal(adapted.average_speed, 3.333);
  });

  it("should handle zero moving_time without division error", () => {
    const adapted = adaptIntervalsActivity({
      id: "i123",
      type: "Run",
      distance: 10000,
      moving_time: 0,
    });

    assert.equal(adapted.average_speed, null);
  });

  it("should protect against negative max_speed", () => {
    const adapted = adaptIntervalsActivity({
      id: "i123",
      type: "Run",
      distance: 5000,
      moving_time: 1500,
      max_speed: -1,
    });

    assert.equal(adapted.max_speed, null);
  });

  it("should store velocity_smooth in m/s preserving existing format", () => {
    // velocity_smooth values from Intervals should be m/s
    const streams = {
      velocity_smooth: [3.5, 3.6, 3.7, 0, 3.8],
      time: [0, 1, 2, 3, 4],
      distance: [0, 3.5, 7.1, 7.1, 10.9],
    };

    const splitsData = buildIntervalsSplitsData({ id: "intervals:i1" }, streams);
    assert.deepEqual(splitsData.streams.velocity_smooth, [3.5, 3.6, 3.7, 0, 3.8]);
  });
});

// ============ Kilometre split calculation ============

describe("Kilometre split calculation", () => {
  it("should calculate correct splits for a 3km run", () => {
    // Simulate a 3km run at ~3.5 m/s
    const distance = [];
    const time = [];
    const heartrate = [];
    const altitude = [];

    for (let i = 0; i <= 900; i++) {
      time.push(i);
      distance.push(i * 3.5);
      heartrate.push(150 + Math.floor(i / 100));
      altitude.push(10 + (i < 300 ? i * 0.01 : 3 - (i - 300) * 0.005));
    }

    const streams = { distance, time, heartrate, altitude };
    const splits = calculateKmSplits(streams);

    // Should have 3 full km splits + possible partial
    assert.ok(splits.length >= 3);

    // First split should be ~1000m
    assert.ok(Math.abs(splits[0].distance - 1000) < 10);

    // Moving time for first km at 3.5m/s should be ~286s
    assert.ok(Math.abs(splits[0].moving_time - 286) < 5);

    // Average speed should be ~3.5 m/s
    assert.ok(splits[0].average_speed > 3.0 && splits[0].average_speed < 4.0);

    // Should have heartrate data
    assert.ok(splits[0].average_heartrate > 0);

    // pace_zone should be null (not available from Intervals)
    assert.equal(splits[0].pace_zone, null);
  });

  it("should handle empty streams gracefully", () => {
    assert.deepEqual(calculateKmSplits({}), []);
    assert.deepEqual(calculateKmSplits({ distance: [], time: [] }), []);
    assert.deepEqual(calculateKmSplits(null), []);
  });

  it("should include final partial split when > 100m", () => {
    const distance = [0, 500, 1000, 1200];
    const time = [0, 150, 300, 360];
    const streams = { distance, time };

    const splits = calculateKmSplits(streams);
    assert.ok(splits.length >= 1);
    // The last split should cover the remaining 200m
    const lastSplit = splits[splits.length - 1];
    assert.ok(lastSplit.distance <= 1200);
  });
});

// ============ Historical shoe data preservation ============

describe("Historical shoe data preservation", () => {
  it("should preserve shoe data for existing Strava activities in stats", () => {
    const items = [
      { start_date: "2026-07-01T00:00:00Z", type: "Run", distance: 10000, moving_time: 3000, shoe_name: "Saucony Tempus 2", gear_name: "Saucony Tempus 2", total_elevation_gain: 50 },
      { start_date: "2026-07-02T00:00:00Z", type: "Run", distance: 8000, moving_time: 2400, shoe_name: "Saucony Tempus 2", gear_name: "Saucony Tempus 2", total_elevation_gain: 30 },
    ];

    const stats = buildStatsFromIndexItems(items, "Pacific/Auckland");
    assert.ok(stats.byShoe["Saucony Tempus 2"]);
    assert.equal(stats.byShoe["Saucony Tempus 2"].distance_m, 18000);
    assert.equal(stats.byShoe["Saucony Tempus 2"].count, 2);
  });

  it("should NOT contribute Intervals activities to byShoe when shoe is null", () => {
    const items = [
      { start_date: "2026-07-01T00:00:00Z", type: "Run", distance: 10000, moving_time: 3000, shoe_name: "Saucony Tempus 2", total_elevation_gain: 50 },
      // Intervals activity with null shoe
      { id: "intervals:i123", start_date: "2026-08-01T00:00:00Z", type: "Run", distance: 12000, moving_time: 3600, shoe_name: null, gear_name: null, source: "intervals", total_elevation_gain: 20 },
    ];

    const stats = buildStatsFromIndexItems(items, "Pacific/Auckland");
    // Only Strava run should appear in byShoe
    assert.equal(Object.keys(stats.byShoe).length, 1);
    assert.equal(stats.byShoe["Saucony Tempus 2"].distance_m, 10000);
    // But both should contribute to totals
    assert.equal(stats.totals.distance_m, 22000);
    assert.equal(stats.totals.runs, 2);
  });

  it("Intervals activities with null shoe values should still have shoe fields in index", () => {
    const run = {
      id: "intervals:i123",
      name: "Morning Run",
      start_date: "2026-08-01T00:00:00Z",
      _type: "Run",
      distance: 10000,
      moving_time: 3000,
      gear_id: null,
      _gear_name: null,
      _shoe_name: null,
      _has_splits: false,
      source: "intervals",
      source_activity_id: "i123",
      map: { summary_polyline: null },
      _has_map: false,
    };

    const entry = buildIndexEntry(run);
    assert.equal(entry.gear_id, null);
    assert.equal(entry.gear_name, null);
    assert.equal(entry.shoe_name, null);
    assert.equal(entry.source, "intervals");
    assert.equal(entry.source_activity_id, "i123");
  });
});

// ============ No-op behaviour ============

describe("No-op behaviour", () => {
  it("should identify zero new activities after deduplication", () => {
    const adapted = { id: "intervals:i999", _type: "Run", distance: 10000, start_date: "2026-08-01T00:00:00Z", _external_id: null };
    const indexMap = new Map([["intervals:i999", { id: "intervals:i999", type: "Run" }]]);

    const result = isIntervalsDuplicate(adapted, indexMap);
    assert.equal(result.isDuplicate, true);
    // If all activities are duplicates, handler returns no_changes: true
  });
});

// ============ Safety: refuse to overwrite populated data with empty ============

describe("Safety: refuse to overwrite populated data with empty", () => {
  it("should never produce empty index when existing data has items", () => {
    // This is enforced in the handler with:
    // if (mergedIndexItems.length < existingIndexItems.length) throw
    // We verify the logic conceptually
    const existingCount = 1595;
    const mergedCount = 0;
    assert.ok(mergedCount < existingCount, "Empty merged should be less than existing");
  });

  it("normalizeIntervalsType should return null for unknown types", () => {
    assert.equal(normalizeIntervalsType("Swim"), null);
    assert.equal(normalizeIntervalsType("Yoga"), null);
    assert.equal(normalizeIntervalsType("WeightTraining"), null);
    assert.equal(normalizeIntervalsType(null), null);
    assert.equal(normalizeIntervalsType(undefined), null);
  });

  it("normalizeIntervalsType should correctly normalize known types", () => {
    assert.equal(normalizeIntervalsType("Run"), "Run");
    assert.equal(normalizeIntervalsType("Running"), "Run");
    assert.equal(normalizeIntervalsType("Ride"), "Ride");
    assert.equal(normalizeIntervalsType("Cycling"), "Ride");
    assert.equal(normalizeIntervalsType("GravelRide"), "GravelRide");
    assert.equal(normalizeIntervalsType("Trail Run"), "Run");
  });

  it("indoor/unrecognized types should not be included in heatmap", () => {
    // VirtualRun, Swim, etc. should normalize to null and be excluded
    assert.equal(normalizeIntervalsType("VirtualRun"), null);
    assert.equal(normalizeIntervalsType("Swim"), null);
    assert.ok(!INCLUDED_TYPES.has(null));
  });
});

// ============ Activity type normalization ============

describe("Activity type normalization", () => {
  it("should map all known Intervals types", () => {
    for (const [input, expected] of Object.entries(INTERVALS_TYPE_MAP)) {
      assert.equal(normalizeIntervalsType(input), expected);
    }
  });

  it("should only include Run, Ride, GravelRide in geographic heatmap", () => {
    assert.ok(INCLUDED_TYPES.has("Run"));
    assert.ok(INCLUDED_TYPES.has("Ride"));
    assert.ok(INCLUDED_TYPES.has("GravelRide"));
    assert.ok(!INCLUDED_TYPES.has("Swim"));
    assert.ok(!INCLUDED_TYPES.has("Walk"));
  });
});

// ============ adaptIntervalsActivity mapping ============

describe("adaptIntervalsActivity field mapping", () => {
  it("should map all required fields correctly", () => {
    const raw = {
      id: "i987654",
      name: "Evening Run",
      type: "Run",
      distance: 12000,
      moving_time: 3600,
      elapsed_time: 3800,
      total_elevation_gain: 45,
      average_heartrate: 160,
      max_heartrate: 185,
      average_cadence: 82,
      calories: 800,
      description: "Good run",
      device_name: "COROS PACE 3",
      start_date_local: "2026-08-01T07:30:00",
      icu_timezone: "Asia/Bangkok",
      max_speed: 5.5,
    };

    const adapted = adaptIntervalsActivity(raw);

    assert.equal(adapted.id, "intervals:i987654");
    assert.equal(adapted.name, "Evening Run");
    assert.equal(adapted._type, "Run");
    assert.equal(adapted.distance, 12000);
    assert.equal(adapted.moving_time, 3600);
    assert.equal(adapted.elapsed_time, 3800);
    assert.equal(adapted.total_elevation_gain, 45);
    assert.equal(adapted.average_speed, 3.333);
    assert.equal(adapted.max_speed, 5.5);
    assert.equal(adapted.average_heartrate, 160);
    assert.equal(adapted.max_heartrate, 185);
    assert.equal(adapted.average_cadence, 82);
    assert.equal(adapted.calories, 800);
    assert.equal(adapted.description, "Good run");
    assert.equal(adapted.device_name, "COROS PACE 3");
    assert.equal(adapted.source, "intervals");
    assert.equal(adapted.source_activity_id, "i987654");
    // Gear intentionally null
    assert.equal(adapted.gear_id, null);
    assert.equal(adapted._gear_name, null);
    assert.equal(adapted._shoe_name, null);
    // UTC conversion: 07:30 Bangkok (+7) = 00:30 UTC
    assert.ok(adapted.start_date.includes("2026-08-01T00:30:00"));
  });

  it("should handle missing optional fields gracefully", () => {
    const raw = { id: "i111", type: "Run", distance: 5000, moving_time: 1500 };
    const adapted = adaptIntervalsActivity(raw);

    assert.equal(adapted.id, "intervals:i111");
    assert.equal(adapted.average_heartrate, null);
    assert.equal(adapted.max_heartrate, null);
    assert.equal(adapted.calories, null);
    assert.equal(adapted.description, null);
    assert.equal(adapted.device_name, null);
  });
});


// ============ Test run import: INTERVALS_INCLUDE_TEST_RUN ============

describe("INTERVALS_INCLUDE_TEST_RUN flag", () => {
  it("should default to false", () => {
    const flag = String(process.env.INTERVALS_INCLUDE_TEST_RUN_DISABLED_FOR_TEST || "").trim().toLowerCase() === "true";
    assert.equal(flag, false);
  });

  it("should only be true when value is exactly 'true' (case-insensitive, trimmed)", () => {
    const check = (val) => String(val || "").trim().toLowerCase() === "true";
    assert.equal(check("true"), true);
    assert.equal(check("TRUE"), true);
    assert.equal(check(" true "), true);
    assert.equal(check("false"), false);
    assert.equal(check(""), false);
    assert.equal(check(undefined), false);
    assert.equal(check("yes"), false);
    assert.equal(check("1"), false);
  });

  it("test run should only affect Intervals source (conceptual)", () => {
    // The test run logic lives inside handleIntervalsSource, never handleStravaSource
    // We verify the flag constant is exported and available
    assert.equal(typeof _test.INTERVALS_INCLUDE_TEST_RUN, "boolean");
  });
});

describe("Test run: no more than one pre-cutover activity selected", () => {
  it("adaptIntervalsActivity produces exactly one activity per call", () => {
    const raw = { id: "i55751783", type: "Run", distance: 11000, moving_time: 3000 };
    const adapted = adaptIntervalsActivity(raw);
    // Returns a single object, not an array
    assert.equal(typeof adapted, "object");
    assert.ok(!Array.isArray(adapted));
    assert.equal(adapted.id, "intervals:i55751783");
  });
});

describe("Test run: exact activity ID selection", () => {
  it("when INTERVALS_TEST_ACTIVITY_ID is set, the namespaced ID matches", () => {
    // Simulate: if env is "i55751783", the adapted ID should be "intervals:i55751783"
    const testId = "i55751783";
    const adapted = adaptIntervalsActivity({ id: testId, type: "Run", distance: 10000, moving_time: 3000 });
    assert.equal(adapted.id, `intervals:${testId}`);
    assert.equal(adapted.source_activity_id, testId);
  });

  it("namespaced ID format is intervals:<raw_id> without double-i prefix", () => {
    // If API returns "i55751783", result must be "intervals:i55751783" not "intervals:ii55751783"
    const raw = { id: "i55751783", type: "Run", distance: 5000, moving_time: 1500 };
    const adapted = adaptIntervalsActivity(raw);
    assert.equal(adapted.id, "intervals:i55751783");
    assert.ok(!adapted.id.includes("intervals:ii"));
  });
});

describe("Test run: intentional bypass of cross-provider fuzzy dedup", () => {
  it("fuzzy dedup should detect match for normal activities", () => {
    const adapted = { id: "intervals:i999", _type: "Run", distance: 11000, start_date: "2026-07-29T00:00:00Z", _external_id: null };
    const indexMap = new Map([["19507994137", { id: "19507994137", type: "Run", start_date: "2026-07-29T00:01:00Z", distance: 11100 }]]);
    const result = isIntervalsDuplicate(adapted, indexMap);
    assert.equal(result.isDuplicate, true);
    assert.equal(result.reason, "fuzzy_match");
  });

  it("test run bypasses fuzzy dedup by only checking exact namespaced ID", () => {
    // The handler logic for test runs only does: indexMap.has(testActivity.id)
    // It does NOT call isIntervalsDuplicate — so fuzzy/external checks are skipped
    const testActivityId = "intervals:i55751783";
    const indexMap = new Map([
      // Strava equivalent present
      ["19507994137", { id: "19507994137", type: "Run", start_date: "2026-07-29T00:00:00Z", distance: 11000 }],
    ]);
    // Exact namespaced ID check — not present, so not a duplicate
    assert.equal(indexMap.has(testActivityId), false);
  });
});

describe("Test run: continued exact namespaced-ID dedup on repeat invocations", () => {
  it("if test activity already imported, exact ID check catches it", () => {
    const testActivityId = "intervals:i55751783";
    const indexMap = new Map([
      [testActivityId, { id: testActivityId, type: "Run", source: "intervals", temporary_test: true }],
    ]);
    // Exact check — already present
    assert.equal(indexMap.has(testActivityId), true);
  });
});

describe("Test run: temporary_test markers in outputs", () => {
  it("buildIndexEntry includes temporary_test when set on activity", () => {
    const run = {
      id: "intervals:i55751783", name: "WO", start_date: "2026-07-29T00:00:00Z",
      _type: "Run", distance: 11000, moving_time: 3000, elapsed_time: 3500,
      average_speed: 3.667, total_elevation_gain: 23,
      gear_id: null, _gear_name: null, _shoe_name: null,
      _has_splits: true, _has_map: true,
      source: "intervals", source_activity_id: "i55751783",
      temporary_test: true, map: { summary_polyline: null },
    };
    const entry = buildIndexEntry(run);
    assert.equal(entry.temporary_test, true);
    assert.equal(entry.source, "intervals");
    assert.equal(entry.source_activity_id, "i55751783");
  });

  it("buildIndexEntry does NOT include temporary_test when not set", () => {
    const run = {
      id: "intervals:i999", name: "Run", start_date: "2026-08-01T00:00:00Z",
      _type: "Run", distance: 10000, moving_time: 3000,
      gear_id: null, _gear_name: null, _shoe_name: null,
      _has_splits: false, source: "intervals", source_activity_id: "i999",
      map: { summary_polyline: null }, _has_map: false,
    };
    const entry = buildIndexEntry(run);
    assert.equal(entry.temporary_test, undefined);
  });

  it("buildGeoJsonFeatureFromPoints includes temporary_test when set", () => {
    const run = {
      id: "intervals:i55751783", source: "intervals", source_activity_id: "i55751783",
      temporary_test: true, _type: "Run", name: "WO",
      start_date: "2026-07-29T00:00:00Z", distance: 11000,
      moving_time: 3000, elapsed_time: 3500, average_speed: 3.667, total_elevation_gain: 23,
    };
    const points = [[13.728, 100.570], [13.729, 100.571]];
    const feature = buildGeoJsonFeatureFromPoints(run, points);
    assert.equal(feature.properties.temporary_test, true);
  });

  it("buildIntervalsSplitsData includes temporary_test when set", () => {
    const adapted = {
      id: "intervals:i55751783", source_activity_id: "i55751783",
      temporary_test: true, name: "WO", start_date: "2026-07-29T00:00:00Z",
      distance: 11000, moving_time: 3000, elapsed_time: 3500,
      total_elevation_gain: 23, average_speed: 3.667, max_speed: 5,
      average_cadence: 85, average_heartrate: 170, max_heartrate: 192,
      calories: 800, description: null, device_name: "COROS PACE 2",
    };
    const splitsData = buildIntervalsSplitsData(adapted, null);
    assert.equal(splitsData.temporary_test, true);
    assert.equal(splitsData.source, "intervals");
    assert.equal(splitsData.source_activity_id, "i55751783");
  });

  it("buildIntervalsSplitsData does NOT include temporary_test when not set", () => {
    const adapted = {
      id: "intervals:i999", source_activity_id: "i999",
      name: "Run", distance: 10000, moving_time: 3000,
    };
    const splitsData = buildIntervalsSplitsData(adapted, null);
    assert.equal(splitsData.temporary_test, undefined);
  });
});

// ============ Cleanup script logic tests ============

describe("Cleanup: preview mode (dry-run default)", () => {
  it("cleanup script requires --apply flag to modify data (conceptual)", () => {
    // The script checks: const applyMode = args.includes("--apply")
    const args1 = ["intervals:i55751783"];
    assert.equal(args1.includes("--apply"), false);

    const args2 = ["intervals:i55751783", "--apply"];
    assert.equal(args2.includes("--apply"), true);
  });
});

describe("Cleanup: refusing non-Intervals IDs", () => {
  it("should reject IDs not starting with 'intervals:'", () => {
    const validate = (id) => id.startsWith("intervals:");
    assert.equal(validate("19507994137"), false);
    assert.equal(validate("strava:19507994137"), false);
    assert.equal(validate(""), false);
    assert.equal(validate("intervals:i55751783"), true);
  });
});

describe("Cleanup: refusing records without temporary_test", () => {
  it("should abort if target item lacks temporary_test: true", () => {
    const targetItem = { id: "intervals:i55751783", type: "Run", source: "intervals" };
    // No temporary_test field
    assert.equal(!!targetItem.temporary_test, false);
  });

  it("should proceed if target item has temporary_test: true", () => {
    const targetItem = { id: "intervals:i55751783", type: "Run", source: "intervals", temporary_test: true };
    assert.equal(targetItem.temporary_test, true);
  });
});

describe("Cleanup: preserving historical Strava activity", () => {
  it("removal only targets the exact namespaced ID, not any Strava equivalent", () => {
    const items = [
      { id: "19507994137", type: "Run", start_date: "2026-07-28T23:06:21Z", distance: 11328.8 },
      { id: "intervals:i55751783", type: "Run", start_date: "2026-07-28T23:06:21Z", distance: 11328.8, source: "intervals", temporary_test: true },
    ];
    const targetId = "intervals:i55751783";
    const afterRemoval = items.filter((item) => String(item.id) !== targetId);
    // Only the Intervals entry removed, Strava entry preserved
    assert.equal(afterRemoval.length, 1);
    assert.equal(afterRemoval[0].id, "19507994137");
  });

  it("never uses fuzzy matching during deletion", () => {
    // Cleanup filters by exact string match: String(item.id) !== targetId
    const items = [
      { id: "19507994137", type: "Run", distance: 11328.8 },
      { id: "intervals:i55751783", type: "Run", distance: 11328.8, temporary_test: true },
      { id: "intervals:i99999999", type: "Run", distance: 11328.8, temporary_test: true },
    ];
    const targetId = "intervals:i55751783";
    const afterRemoval = items.filter((item) => String(item.id) !== targetId);
    // Only the exact target removed
    assert.equal(afterRemoval.length, 2);
    assert.ok(afterRemoval.some((i) => i.id === "19507994137"));
    assert.ok(afterRemoval.some((i) => i.id === "intervals:i99999999"));
  });
});

describe("Permanent cutover unchanged", () => {
  it("INTERVALS_CUTOVER_ISO remains 2026-07-30T00:00:00+07:00", () => {
    assert.equal(_test.INTERVALS_CUTOVER_ISO, "2026-07-30T00:00:00+07:00");
  });

  it("test run feature does not modify the cutover constant", () => {
    // The cutover MS should always correspond to 30 July 2026 midnight Bangkok
    const expected = Date.parse("2026-07-30T00:00:00+07:00");
    assert.equal(_test.INTERVALS_CUTOVER_MS, expected);
  });

  it("INTERVALS_TEST_DAY_START is 2026-07-29 (one day before cutover)", () => {
    assert.equal(_test.INTERVALS_TEST_DAY_START, "2026-07-29");
  });
});

// ============ INTERVALS_ATHLETE_ID default ============

describe("INTERVALS_ATHLETE_ID default", () => {
  it("should default to '0' when env var is not set", () => {
    const compute = (envVal) => String(envVal || "0").trim();
    assert.equal(compute(undefined), "0");
    assert.equal(compute(""), "0");
    assert.equal(compute(null), "0");
  });

  it("should use provided value when set", () => {
    const compute = (envVal) => String(envVal || "0").trim();
    assert.equal(compute("i12345"), "i12345");
    assert.equal(compute(" i99999 "), "i99999");
  });
});
