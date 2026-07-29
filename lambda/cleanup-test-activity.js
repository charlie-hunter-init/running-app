#!/usr/bin/env node
// cleanup-test-activity.js
//
// Removes a single temporary Intervals.icu test activity from all S3 outputs.
// Defaults to dry-run/preview mode. Pass --apply to actually modify S3.
//
// Usage:
//   node cleanup-test-activity.js intervals:i55751783
//   node cleanup-test-activity.js intervals:i55751783 --apply
//
// Required env vars:
//   BUCKET — S3 bucket name
//
// Optional env vars:
//   KEY=runs.geojson
//   INDEX_KEY=runs_index.json
//   STATS_KEY=stats.json
//   CACHE_KEY=activities_cache.json
//   SPLITS_STATE_KEY=splits_state.json
//   SPLITS_PREFIX=splits/
//   TIMEZONE=Pacific/Auckland
//   AWS_REGION=ap-southeast-2

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
} from "@aws-sdk/client-s3";

import { DateTime } from "luxon";

const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "ap-southeast-2";
const BUCKET = process.env.BUCKET;
const KEY = process.env.KEY || "runs.geojson";
const INDEX_KEY = process.env.INDEX_KEY || "runs_index.json";
const STATS_KEY = process.env.STATS_KEY || "stats.json";
const CACHE_KEY = process.env.CACHE_KEY || "activities_cache.json";
const SPLITS_STATE_KEY = process.env.SPLITS_STATE_KEY || "splits_state.json";
const SPLITS_PREFIX = process.env.SPLITS_PREFIX || "splits/";
const TIMEZONE = process.env.TIMEZONE || "Pacific/Auckland";

const s3 = new S3Client({ region: REGION });

// --- Helpers ---

async function streamToString(stream) {
  return await new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
  });
}

async function loadJson(key) {
  const resp = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const body = await streamToString(resp.Body);
  return JSON.parse(body);
}

async function putJson(key, body) {
  const json = JSON.stringify(body);
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET, Key: key, Body: json,
    ContentType: "application/json", CacheControl: "max-age=300",
  }));
  return Buffer.byteLength(json, "utf-8");
}

async function backupObject(key) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupKey = `_backups/${ts}/${key}`;
  try {
    await s3.send(new CopyObjectCommand({
      Bucket: BUCKET, Key: backupKey,
      CopySource: `${BUCKET}/${key}`,
    }));
    console.log(`  Backed up: s3://${BUCKET}/${key} → s3://${BUCKET}/${backupKey}`);
    return backupKey;
  } catch (err) {
    if (err.name === "NoSuchKey") {
      console.log(`  Backup skipped (not found): ${key}`);
      return null;
    }
    throw err;
  }
}

async function deleteObject(key) {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

function weekKey(isoDate, zone) {
  const dt = DateTime.fromISO(isoDate, { zone });
  return `${dt.weekYear}-${String(dt.weekNumber).padStart(2, "0")}`;
}

function buildStatsFromIndexItems(indexItems, timezone, overrides = {}) {
  const weekly = {};
  const byShoe = {};
  const byYear = {};
  const byDayOfWeek = {};
  const now = DateTime.now().setZone(timezone);
  const currentYear = now.year;
  const ytd = { distance_m: 0, count: 0 };
  let totalDistanceM = 0, totalMovingTimeS = 0, totalElevationM = 0;

  for (const item of indexItems) {
    if (!item.start_date) continue;
    if (item.type !== "Run") continue;
    const dist = Number(item.distance || 0);
    const moving = Number(item.moving_time || 0);
    const elevation = Number(item.total_elevation_gain || 0);
    totalDistanceM += dist;
    totalMovingTimeS += moving;
    totalElevationM += elevation;
    const dt = DateTime.fromISO(item.start_date, { zone: timezone });
    if (!dt.isValid) continue;
    const year = dt.year;
    const wk = weekKey(item.start_date, timezone);
    const day = dt.weekdayLong;
    weekly[wk] ||= { distance_m: 0, count: 0, moving_time_s: 0 };
    weekly[wk].distance_m += dist; weekly[wk].count += 1; weekly[wk].moving_time_s += moving;
    byYear[year] ||= { distance_m: 0, count: 0, moving_time_s: 0 };
    byYear[year].distance_m += dist; byYear[year].count += 1; byYear[year].moving_time_s += moving;
    byDayOfWeek[day] ||= { distance_m: 0, count: 0, moving_time_s: 0 };
    byDayOfWeek[day].distance_m += dist; byDayOfWeek[day].count += 1; byDayOfWeek[day].moving_time_s += moving;
    const shoe = item.shoe_name || item.gear_name || null;
    const override = overrides[String(item.id)];
    if (override && Array.isArray(override.segments)) {
      for (const segment of override.segments) {
        const segShoe = segment.shoe_name;
        if (!segShoe) continue;
        byShoe[segShoe] ||= { distance_m: 0, count: 0, moving_time_s: 0, last_date: null };
        byShoe[segShoe].distance_m += segment.distance_m;
        byShoe[segShoe].count += 1;
        byShoe[segShoe].moving_time_s += dist > 0 ? Math.round(moving * (segment.distance_m / dist)) : 0;
        if (!byShoe[segShoe].last_date || item.start_date > byShoe[segShoe].last_date) byShoe[segShoe].last_date = item.start_date;
      }
    } else if (shoe) {
      byShoe[shoe] ||= { distance_m: 0, count: 0, moving_time_s: 0, last_date: null };
      byShoe[shoe].distance_m += dist; byShoe[shoe].count += 1; byShoe[shoe].moving_time_s += moving;
      if (!byShoe[shoe].last_date || item.start_date > byShoe[shoe].last_date) byShoe[shoe].last_date = item.start_date;
    }
    if (year === currentYear) { ytd.distance_m += dist; ytd.count += 1; }
  }

  return {
    generated_at: new Date().toISOString(), timezone,
    totals: { runs: indexItems.length, distance_m: totalDistanceM, moving_time_s: totalMovingTimeS, elevation_gain_m: totalElevationM },
    ytd, weekly, byShoe, byYear, byDayOfWeek,
  };
}

// --- Main ---

async function main() {
  const args = process.argv.slice(2);
  const applyMode = args.includes("--apply");
  const targetId = args.find((a) => !a.startsWith("--"));

  if (!targetId) {
    console.error("Usage: node cleanup-test-activity.js <namespaced-id> [--apply]");
    console.error("Example: node cleanup-test-activity.js intervals:i55751783 --apply");
    process.exit(1);
  }

  if (!BUCKET) {
    console.error("Missing BUCKET env var.");
    process.exit(1);
  }

  // 1. Validate ID format
  if (!targetId.startsWith("intervals:")) {
    console.error(`ERROR: Target ID must begin with "intervals:". Got: ${targetId}`);
    console.error("Refusing to operate on non-Intervals IDs.");
    process.exit(1);
  }

  console.log(`\n=== Cleanup Test Activity ===`);
  console.log(`Target: ${targetId}`);
  console.log(`Bucket: ${BUCKET}`);
  console.log(`Mode: ${applyMode ? "APPLY (will modify S3)" : "DRY RUN (preview only)"}\n`);

  // 2. Load existing data
  console.log("Loading existing S3 data...");
  let index, geojson, splitsState, cacheData;

  try {
    index = await loadJson(INDEX_KEY);
  } catch (err) {
    console.error(`Failed to load ${INDEX_KEY}: ${err.message}`);
    process.exit(1);
  }

  try {
    geojson = await loadJson(KEY);
  } catch (err) {
    console.error(`Failed to load ${KEY}: ${err.message}`);
    process.exit(1);
  }

  try {
    splitsState = await loadJson(SPLITS_STATE_KEY);
  } catch {
    splitsState = null;
  }

  try {
    cacheData = await loadJson(CACHE_KEY);
  } catch {
    cacheData = null;
  }

  // 3. Find the target in runs_index.json
  const indexItems = Array.isArray(index.items) ? index.items : [];
  const targetItem = indexItems.find((item) => String(item.id) === targetId);

  if (!targetItem) {
    console.error(`ERROR: Activity "${targetId}" not found in ${INDEX_KEY}.`);
    console.error("Nothing to clean up.");
    process.exit(1);
  }

  // 4. Verify temporary_test marker
  if (!targetItem.temporary_test) {
    console.error(`ERROR: Activity "${targetId}" does NOT have temporary_test: true.`);
    console.error("Refusing to remove non-test activities. Aborting.");
    process.exit(1);
  }

  // 5. Validate exactly one match
  const matchCount = indexItems.filter((item) => String(item.id) === targetId).length;
  if (matchCount !== 1) {
    console.error(`ERROR: Found ${matchCount} entries for "${targetId}". Expected exactly 1. Aborting.`);
    process.exit(1);
  }

  // 6. Show what will be removed
  console.log("--- Target Activity ---");
  console.log(JSON.stringify(targetItem, null, 2));
  console.log("");

  const features = Array.isArray(geojson.features) ? geojson.features : [];
  const targetFeature = features.find((f) => f?.properties?.id === targetId);
  const splitsKey = `${SPLITS_PREFIX}${targetId}.json`;

  const beforeCounts = {
    index_items: indexItems.length,
    geojson_features: features.length,
  };

  console.log("--- Planned Changes ---");
  console.log(`  ${INDEX_KEY}: Remove 1 item (${beforeCounts.index_items} → ${beforeCounts.index_items - 1})`);
  console.log(`  ${KEY}: ${targetFeature ? "Remove 1 feature" : "No matching feature"} (${beforeCounts.geojson_features} → ${beforeCounts.geojson_features - (targetFeature ? 1 : 0)})`);
  console.log(`  ${splitsKey}: Delete object`);
  console.log(`  ${STATS_KEY}: Recalculate from remaining dataset`);
  if (splitsState && Array.isArray(splitsState.recent_ids) && splitsState.recent_ids.includes(targetId)) {
    console.log(`  ${SPLITS_STATE_KEY}: Remove ID from recent_ids`);
  }
  if (cacheData && cacheData[targetId]) {
    console.log(`  ${CACHE_KEY}: Remove entry`);
  }
  console.log("");

  // Check that original Strava copy is preserved
  const stravaEquivalent = indexItems.find((item) =>
    String(item.id) !== targetId && !String(item.id).startsWith("intervals:")
    && item.type === targetItem.type
  );
  if (stravaEquivalent) {
    console.log(`  ✓ Historical Strava data preserved (${indexItems.length - 1} non-test items remain)`);
  }

  if (!applyMode) {
    console.log("\n--- DRY RUN --- No changes applied. Pass --apply to execute.\n");
    process.exit(0);
  }

  // 7. Create backups before modifying
  console.log("\nCreating backups...");
  await backupObject(INDEX_KEY);
  await backupObject(KEY);
  await backupObject(STATS_KEY);
  await backupObject(SPLITS_STATE_KEY);
  if (cacheData && cacheData[targetId]) await backupObject(CACHE_KEY);

  // 8. Remove from index
  console.log("\nApplying changes...");
  const newItems = indexItems.filter((item) => String(item.id) !== targetId);
  index.items = newItems;
  index.count = newItems.length;
  index.generated_at = new Date().toISOString();
  await putJson(INDEX_KEY, index);
  console.log(`  ✓ ${INDEX_KEY}: ${beforeCounts.index_items} → ${newItems.length} items`);

  // 9. Remove from GeoJSON
  if (targetFeature) {
    const newFeatures = features.filter((f) => f?.properties?.id !== targetId);
    geojson.features = newFeatures;
    await putJson(KEY, geojson);
    console.log(`  ✓ ${KEY}: ${beforeCounts.geojson_features} → ${newFeatures.length} features`);
  } else {
    console.log(`  - ${KEY}: No feature to remove`);
  }

  // 10. Delete splits file
  try {
    await deleteObject(splitsKey);
    console.log(`  ✓ ${splitsKey}: Deleted`);
  } catch (err) {
    console.log(`  - ${splitsKey}: ${err.name === "NoSuchKey" ? "Not found" : err.message}`);
  }

  // 11. Update splits state
  if (splitsState && Array.isArray(splitsState.recent_ids)) {
    const before = splitsState.recent_ids.length;
    splitsState.recent_ids = splitsState.recent_ids.filter((id) => id !== targetId);
    if (splitsState.recent_ids.length < before) {
      await putJson(SPLITS_STATE_KEY, splitsState);
      console.log(`  ✓ ${SPLITS_STATE_KEY}: Removed ID from recent_ids`);
    }
  }

  // 12. Update cache
  if (cacheData && cacheData[targetId]) {
    delete cacheData[targetId];
    await putJson(CACHE_KEY, cacheData);
    console.log(`  ✓ ${CACHE_KEY}: Removed entry`);
  }

  // 13. Recalculate stats
  let shoeOverrides = {};
  try {
    shoeOverrides = await loadJson("shoe_overrides.json");
  } catch { /* no overrides */ }

  const newStats = buildStatsFromIndexItems(newItems, TIMEZONE, shoeOverrides);
  await putJson(STATS_KEY, newStats);
  console.log(`  ✓ ${STATS_KEY}: Recalculated from ${newItems.length} items`);

  // 14. Final summary
  console.log(`\n=== Cleanup Complete ===`);
  console.log(`  Before: ${beforeCounts.index_items} index items, ${beforeCounts.geojson_features} features`);
  console.log(`  After:  ${newItems.length} index items, ${geojson.features.length} features`);
  console.log(`  Removed: ${targetId}`);
  console.log(`  Historical Strava data: preserved\n`);
}

main().catch((err) => {
  console.error("Cleanup failed:", err.message);
  process.exit(1);
});
