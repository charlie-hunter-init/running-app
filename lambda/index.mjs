// index.js — Strava/Intervals.icu -> S3 heatmap exporter
// Incremental mode:
// - Reads existing runs_index.json from S3
// - Finds newest activity start_date already in the bucket
// - Fetches activities from the selected source (Strava or Intervals.icu)
// - Merges/dedupes by activity id
// - Writes runs.geojson, runs_index.json, stats.json
// - Fetches per-km splits for new runs and writes splits/{id}.json
// - Maintains splits_state.json to track which runs have splits fetched
//
// Required env vars:
// - BUCKET
//
// Optional env vars:
// - USE_STRAVA          — "true" to use Strava; absent/empty/other uses Intervals.icu
// - KEY=runs.geojson
// - INDEX_KEY=runs_index.json
// - STATS_KEY=stats.json
// - CACHE_KEY=activities_cache.json
// - SPLITS_STATE_KEY=splits_state.json
// - SPLITS_PREFIX=splits/
// - TIMEZONE=Pacific/Auckland
// - MAX_PAGES=50
// - DRY_RUN=false
// - FORCE_FULL_REFRESH=false
// - INCREMENTAL_LOOKBACK_SECONDS=172800
// - INTERVALS_ATHLETE_ID — Intervals.icu athlete ID (defaults to "0" for the personal API key owner)
//
// Required SSM parameters (Strava):
// - /strava/client_id
// - /strava/secret
// - /strava/refresh
//
// Required SSM parameters (Intervals.icu):
// - intervalsAPI  (SecureString, ARN: arn:aws:ssm:ap-southeast-2:598945436007:parameter/intervalsAPI)
//
// Recommended Lambda timeout:
// - 300 to 900 seconds

import axios from "axios";
import polyline from "@mapbox/polyline";

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";

import {
  SSMClient,
  GetParametersCommand,
  GetParameterCommand,
  PutParameterCommand,
} from "@aws-sdk/client-ssm";

import { DateTime } from "luxon";

const REGION =
  process.env.AWS_REGION ||
  process.env.AWS_DEFAULT_REGION ||
  "ap-southeast-2";

const BUCKET = process.env.BUCKET;
const KEY = process.env.KEY || "runs.geojson";
const STATS_KEY = process.env.STATS_KEY || "stats.json";
const INDEX_KEY = process.env.INDEX_KEY || "runs_index.json";
const CACHE_KEY = process.env.CACHE_KEY || "activities_cache.json";
const SPLITS_STATE_KEY = process.env.SPLITS_STATE_KEY || "splits_state.json";
const SPLITS_PREFIX = process.env.SPLITS_PREFIX || "splits/";
const TIMEZONE = process.env.TIMEZONE || "Pacific/Auckland";

const PER_PAGE = 200;
const MAX_PAGES = Number(process.env.MAX_PAGES || 50);
const MIN_MS_LEFT = 10_000;

const DRY_RUN =
  String(process.env.DRY_RUN || "false").toLowerCase() === "true";

const FORCE_FULL_REFRESH =
  String(process.env.FORCE_FULL_REFRESH || "false").toLowerCase() === "true";

const INCREMENTAL_LOOKBACK_SECONDS = Number(
  process.env.INCREMENTAL_LOOKBACK_SECONDS || 172800
);

// --- Source selection ---
// Normalize: trim whitespace, lowercase. Only exactly "true" selects Strava.
const USE_STRAVA =
  String(process.env.USE_STRAVA || "").trim().toLowerCase() === "true";

const ACTIVITY_SOURCE = USE_STRAVA ? "strava" : "intervals";

// --- Intervals.icu configuration ---
// The fixed cutover date: only import Intervals activities starting from this point.
// 30 July 2026 at midnight in Thailand (UTC+7).
const INTERVALS_CUTOVER_ISO = "2026-07-30T00:00:00+07:00";
const INTERVALS_CUTOVER_MS = Date.parse(INTERVALS_CUTOVER_ISO);

// Intervals.icu uses athlete ID "0" for the athlete belonging to the personal API key.
const INTERVALS_ATHLETE_ID =
  String(process.env.INTERVALS_ATHLETE_ID || "0").trim();
const INTERVALS_API_BASE = "https://intervals.icu/api/v1";
const INTERVALS_USER_AGENT = "Charlie-Running-Heatmap/1.0";

// Intervals.icu activity type normalization map
const INTERVALS_TYPE_MAP = {
  "Run": "Run",
  "Running": "Run",
  "Ride": "Ride",
  "Cycling": "Ride",
  "GravelRide": "GravelRide",
  "Gravel Ride": "GravelRide",
  "VirtualRide": "Ride",
  "TrailRun": "Run",
  "Trail Run": "Run",
};

// Intervals activity types that should be included (after normalization)
const INCLUDED_TYPES = new Set(["Run", "Ride", "GravelRide"]);

// Types that typically lack GPS and should not produce map features
const INDOOR_INDICATORS = new Set(["VirtualRun", "VirtualRide", "Treadmill"]);

// --- Temporary test run import ---
// When INTERVALS_INCLUDE_TEST_RUN is exactly "true", import at most one
// pre-cutover Intervals activity from 29 July 2026 for comparison testing.
// The test activity intentionally duplicates its Strava equivalent.
const INTERVALS_INCLUDE_TEST_RUN =
  String(process.env.INTERVALS_INCLUDE_TEST_RUN || "").trim().toLowerCase() === "true";

// Optional: specify the exact Intervals activity ID to import as the test run.
// If not set, the newest valid Run from 29 July 2026 is selected.
const INTERVALS_TEST_ACTIVITY_ID =
  (process.env.INTERVALS_TEST_ACTIVITY_ID || "").trim() || null;

// The test day: 29 July 2026 in Thailand time
const INTERVALS_TEST_DAY_START = "2026-07-29"; // YYYY-MM-DD for API query

// Weather enrichment env vars
const WEATHER_ENABLED =
  String(process.env.WEATHER_ENABLED || "true").toLowerCase() === "true";
const WEATHER_INTERVAL_SECONDS = Number(process.env.WEATHER_INTERVAL_SECONDS || 600);
const WEATHER_COORD_DECIMALS = Number(process.env.WEATHER_COORD_DECIMALS || 2);
const WEATHER_CACHE_KEY = process.env.WEATHER_CACHE_KEY || "weather_cache.json";

const s3 = new S3Client({ region: REGION });
const ssm = new SSMClient({ region: REGION });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function logObject(label, obj) {
  console.log(`${label}: ${JSON.stringify(obj)}`);
}

function shouldRetry(status) {
  return status === 429 || (status >= 500 && status < 600);
}

async function streamToString(stream) {
  return await new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
  });
}

async function getWithRetry(http, url, options = {}, maxAttempts = 4) {
  let attempt = 0;
  let lastErr;

  while (attempt < maxAttempts) {
    try {
      return await http.get(url, options);
    } catch (err) {
      lastErr = err;
      const status = err.response?.status;

      if (!shouldRetry(status)) {
        throw err;
      }

      // Respect Retry-After header if present
      const retryAfter = err.response?.headers?.["retry-after"];
      let backoffMs;
      if (retryAfter && Number.isFinite(Number(retryAfter))) {
        backoffMs = Math.min(Number(retryAfter) * 1000, 30000);
      } else {
        backoffMs = Math.min(1000 * Math.pow(2, attempt), 8000);
      }

      console.log(
        `Retryable error. url=${url}, status=${status}, attempt=${attempt + 1}, waiting_ms=${backoffMs}`
      );

      await sleep(backoffMs);
    }

    attempt += 1;
  }

  throw lastErr;
}

// ---------- Intervals.icu API helpers ----------

/**
 * Fetch the Intervals.icu API key from SSM Parameter Store.
 * Returns the decrypted API key string.
 */
async function getIntervalsApiKey() {
  const resp = await ssm.send(
    new GetParameterCommand({
      Name: "intervalsAPI",
      WithDecryption: true,
    })
  );

  const value = resp.Parameter?.Value;
  if (!value) {
    throw new Error("Missing or empty SSM parameter: intervalsAPI");
  }

  return value;
}

/**
 * Create an axios instance configured for Intervals.icu API.
 * Uses HTTP Basic Auth: username=API_KEY, password=<api_key_value>
 */
function createIntervalsHttpClient(apiKey) {
  const basicAuth = Buffer.from(`API_KEY:${apiKey}`).toString("base64");

  return axios.create({
    baseURL: INTERVALS_API_BASE,
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "User-Agent": INTERVALS_USER_AGENT,
    },
    timeout: 20000,
  });
}

/**
 * Normalize an Intervals.icu activity type to our internal type values.
 * Returns null if the type is not recognized/included.
 */
function normalizeIntervalsType(rawType) {
  if (!rawType) return null;
  const normalized = INTERVALS_TYPE_MAP[rawType] || null;
  return normalized;
}

/**
 * Determine the "after" date for Intervals fetches.
 * Uses the later of: the fixed cutover date, or the newest Intervals activity already imported.
 * Applies the lookback buffer for overlap/deduplication.
 */
function getIntervalsAfterDate(existingIndex) {
  const items = Array.isArray(existingIndex?.items) ? existingIndex.items : [];

  // Find the newest Intervals activity already in the index
  let newestIntervalsMs = 0;
  for (const item of items) {
    if (!item?.start_date) continue;
    if (!item?.source || item.source !== "intervals") continue;
    const ms = Date.parse(item.start_date);
    if (Number.isFinite(ms) && ms > newestIntervalsMs) {
      newestIntervalsMs = ms;
    }
  }

  // Use the later of: cutover date, or newest intervals activity (with lookback)
  let afterMs;
  if (newestIntervalsMs > 0) {
    afterMs = Math.max(
      INTERVALS_CUTOVER_MS,
      newestIntervalsMs - (INCREMENTAL_LOOKBACK_SECONDS * 1000)
    );
  } else {
    afterMs = INTERVALS_CUTOVER_MS;
  }

  return new Date(afterMs).toISOString().slice(0, 10); // YYYY-MM-DD for Intervals API
}

/**
 * Fetch activities from Intervals.icu.
 * The API uses date range queries: oldest=YYYY-MM-DD&newest=YYYY-MM-DD
 */
async function fetchIntervalsActivities(http, athleteId, afterDate, context) {
  const today = new Date().toISOString().slice(0, 10);

  console.log(`Fetching Intervals.icu activities for athlete ${athleteId} from ${afterDate} to ${today}...`);

  const resp = await getWithRetry(http, `/athlete/${athleteId}/activities`, {
    params: {
      oldest: afterDate,
      newest: today,
    },
  });

  const data = Array.isArray(resp.data) ? resp.data : [];

  logObject("Intervals fetch result", {
    count: data.length,
    first_id: data[0]?.id || null,
    last_id: data[data.length - 1]?.id || null,
    first_start: data[0]?.start_date_local || null,
    last_start: data[data.length - 1]?.start_date_local || null,
  });

  return data;
}

/**
 * Convert an Intervals.icu activity into our internal activity format.
 * This adapter ensures Intervals activities look identical to Strava activities
 * from the perspective of downstream processing.
 */
function adaptIntervalsActivity(activity) {
  const rawType = activity.type || null;
  const normalizedType = normalizeIntervalsType(rawType);

  // Calculate average_speed safely
  const distance = Number(activity.distance || 0);
  const movingTime = Number(activity.moving_time || 0);
  let averageSpeed = null;
  if (movingTime > 0 && distance > 0) {
    averageSpeed = Math.round((distance / movingTime) * 1000) / 1000;
  }

  // Protect against invalid speed values
  let maxSpeed = activity.max_speed != null ? Number(activity.max_speed) : null;
  if (maxSpeed != null && (!Number.isFinite(maxSpeed) || maxSpeed < 0)) {
    maxSpeed = null;
  }

  // Build a stable internal ID that cannot collide with Strava numeric IDs
  const intervalsId = String(activity.id);
  const stableId = `intervals:${intervalsId}`;

  // Use start_date_local and icu_timezone to construct UTC start_date
  // Intervals may provide start_date_local or start_date
  let startDateUtc = null;
  if (activity.start_date_local && activity.icu_timezone) {
    const dt = DateTime.fromISO(activity.start_date_local, { zone: activity.icu_timezone });
    if (dt.isValid) {
      startDateUtc = dt.toUTC().toISO();
    }
  }
  // Fallback to start_date if available
  if (!startDateUtc && activity.start_date) {
    startDateUtc = activity.start_date;
  }
  if (!startDateUtc && activity.start_date_local) {
    // Last resort: treat as UTC
    startDateUtc = activity.start_date_local;
  }

  return {
    id: stableId,
    name: activity.name || null,
    start_date: startDateUtc,
    distance: distance,
    moving_time: movingTime,
    elapsed_time: Number(activity.elapsed_time || activity.moving_time || 0),
    total_elevation_gain: Number(activity.total_elevation_gain || 0),
    average_speed: averageSpeed,
    max_speed: maxSpeed,
    average_heartrate: activity.average_heartrate ?? null,
    max_heartrate: activity.max_heartrate ?? null,
    average_cadence: activity.average_cadence ?? null,
    calories: activity.calories ?? null,
    description: activity.description || null,
    device_name: activity.device_name || null,
    // Gear: intentionally deferred for Intervals.icu
    // Intervals.icu does not currently provide the shoe data needed by this project.
    gear_id: null,
    _gear_name: null,
    _shoe_name: null,
    _type: normalizedType,
    _has_splits: false,
    // Source metadata
    source: "intervals",
    source_activity_id: intervalsId,
    // External ID for cross-reference deduplication with Strava
    _external_id: activity.external_id || activity.strava_id || null,
    // Map placeholder — will be populated after map fetch
    map: { summary_polyline: null },
    // Raw Intervals type for logging
    _raw_type: rawType,
  };
}

/**
 * Fetch GPS map data for an Intervals activity.
 * Returns an array of [lat, lng] points or null if unavailable.
 */
async function fetchIntervalsMap(http, intervalsActivityId) {
  try {
    const resp = await getWithRetry(http, `/activity/${intervalsActivityId}/map`);
    const data = resp.data;

    // Intervals map response: { bounds: [...], latlngs: [[lat, lng], null, ...] }
    // The latlngs array may contain null entries for GPS gaps — filter them out.
    if (data && data.latlngs && Array.isArray(data.latlngs)) {
      const points = data.latlngs
        .filter((p) => Array.isArray(p) && p.length >= 2 && p[0] != null && p[1] != null)
        .map((p) => [Number(p[0]), Number(p[1])]);
      return points.length >= 2 ? points : null;
    }

    // Fallback: check singular "latlng" field
    if (data && data.latlng && Array.isArray(data.latlng)) {
      const points = data.latlng
        .filter((p) => Array.isArray(p) && p.length >= 2 && p[0] != null && p[1] != null)
        .map((p) => [Number(p[0]), Number(p[1])]);
      return points.length >= 2 ? points : null;
    }

    // Fallback: top-level array of objects [{lat, lng}, ...]
    if (Array.isArray(data) && data.length > 0) {
      if (typeof data[0] === "object" && !Array.isArray(data[0])) {
        const points = data
          .filter((p) => p && p.lat != null && p.lng != null)
          .map((p) => [Number(p.lat), Number(p.lng)]);
        return points.length >= 2 ? points : null;
      }
      // Array of arrays [[lat, lng], ...]
      if (Array.isArray(data[0])) {
        const points = data
          .filter((p) => Array.isArray(p) && p.length >= 2 && p[0] != null)
          .map((p) => [Number(p[0]), Number(p[1])]);
        return points.length >= 2 ? points : null;
      }
    }

    return null;
  } catch (err) {
    const status = err.response?.status;
    if (status === 404) {
      return null; // No map data available
    }
    console.log(`  [map] Failed for ${intervalsActivityId}: status=${status}, ${err.message}`);
    return null;
  }
}

/**
 * Build a GeoJSON Feature from Intervals map points.
 * Points are in [lat, lng] format; GeoJSON needs [lng, lat].
 */
function buildGeoJsonFeatureFromPoints(run, mapPoints) {
  if (!mapPoints || mapPoints.length < 2) {
    return null;
  }

  // Convert [lat, lng] to GeoJSON [lng, lat]
  const coords = mapPoints.map(([lat, lng]) => [lng, lat]);

  return {
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: coords,
    },
    properties: {
      id: run.id,
      source: "intervals",
      source_activity_id: run.source_activity_id,
      ...(run.temporary_test ? { temporary_test: true } : {}),
      name: run.name || null,
      type: run._type || null,
      start_date: run.start_date || null,
      year: run.start_date
        ? new Date(run.start_date).getUTCFullYear().toString()
        : null,
      distance_m: run.distance || 0,
      moving_time: run.moving_time || null,
      elapsed_time: run.elapsed_time || null,
      average_speed: run.average_speed || null,
      total_elevation_gain: run.total_elevation_gain || null,
      gear_id: null,
      gear_name: null,
      shoe_name: null,
    },
  };
}

/**
 * Fetch detailed streams from Intervals.icu.
 * Returns normalized streams object compatible with existing schema, or null.
 *
 * Intervals represents latlng specially:
 * - latitude values are in `data`
 * - longitude values are in `data2`
 */
async function fetchIntervalsStreams(http, intervalsActivityId) {
  try {
    const resp = await getWithRetry(http, `/activity/${intervalsActivityId}/streams.json`);
    const raw = resp.data;

    if (!Array.isArray(raw) || raw.length === 0) {
      return null;
    }

    const streams = {};

    for (const stream of raw) {
      if (!stream || !stream.type) continue;

      switch (stream.type) {
        case "latlng": {
          // Intervals: data = latitudes, data2 = longitudes
          const lats = stream.data;
          const lngs = stream.data2;
          if (Array.isArray(lats) && Array.isArray(lngs)) {
            const minLen = Math.min(lats.length, lngs.length);
            streams.latlng = [];
            for (let i = 0; i < minLen; i++) {
              if (lats[i] != null && lngs[i] != null) {
                streams.latlng.push([Number(lats[i]), Number(lngs[i])]);
              } else {
                streams.latlng.push([0, 0]); // placeholder for alignment
              }
            }
          }
          break;
        }
        case "velocity_smooth":
          if (Array.isArray(stream.data)) {
            // Ensure all values are valid numbers, protect against negatives
            streams.velocity_smooth = stream.data.map((v) => {
              const n = Number(v);
              return Number.isFinite(n) && n >= 0 ? n : 0;
            });
          }
          break;
        case "distance":
          if (Array.isArray(stream.data)) streams.distance = stream.data;
          break;
        case "time":
          if (Array.isArray(stream.data)) streams.time = stream.data;
          break;
        case "heartrate":
          if (Array.isArray(stream.data)) streams.heartrate = stream.data;
          break;
        case "altitude":
          if (Array.isArray(stream.data)) streams.altitude = stream.data;
          break;
        case "cadence":
          if (Array.isArray(stream.data)) streams.cadence = stream.data;
          break;
        case "temp":
          // Device temperature — stored separately, does NOT replace Open-Meteo weather_samples
          if (Array.isArray(stream.data)) streams.temp = stream.data;
          break;
        default:
          break;
      }
    }

    if (Object.keys(streams).length === 0) return null;

    return streams;
  } catch (err) {
    const status = err.response?.status;
    console.log(`  [streams] FAILED for intervals:${intervalsActivityId}: status=${status}, ${err.message}`);
    return null;
  }
}

/**
 * Calculate per-kilometre splits from stream data.
 * Uses interpolation where a 1km boundary falls between stream points.
 */
function calculateKmSplits(streams) {
  const distArr = streams?.distance;
  const timeArr = streams?.time;

  if (!distArr || !timeArr || distArr.length < 2 || timeArr.length < 2) {
    return [];
  }

  const minLen = Math.min(distArr.length, timeArr.length);
  const hrArr = streams?.heartrate;
  const altArr = streams?.altitude;
  const cadArr = streams?.cadence;
  const velArr = streams?.velocity_smooth;

  const totalDist = distArr[minLen - 1];
  if (!totalDist || totalDist <= 0) return [];

  const numFullKm = Math.floor(totalDist / 1000);
  const splits = [];

  let prevIdx = 0;
  let prevKmDist = 0;

  for (let km = 1; km <= numFullKm + 1; km++) {
    const targetDist = km <= numFullKm ? km * 1000 : totalDist;

    // Find the index where distance crosses the target
    let crossIdx = prevIdx;
    while (crossIdx < minLen - 1 && distArr[crossIdx] < targetDist) {
      crossIdx++;
    }

    if (crossIdx <= prevIdx && km <= numFullKm) continue;

    // Interpolate time at the exact km boundary
    let timeAtBoundary;
    if (crossIdx > 0 && distArr[crossIdx] !== distArr[crossIdx - 1]) {
      const frac = (targetDist - distArr[crossIdx - 1]) / (distArr[crossIdx] - distArr[crossIdx - 1]);
      timeAtBoundary = timeArr[crossIdx - 1] + frac * (timeArr[crossIdx] - timeArr[crossIdx - 1]);
    } else {
      timeAtBoundary = timeArr[crossIdx];
    }

    const timeAtPrevBoundary = km === 1 ? timeArr[0] : splits[splits.length - 1]?._endTime || timeArr[prevIdx];
    const splitTime = timeAtBoundary - timeAtPrevBoundary;
    const splitDist = targetDist - prevKmDist;

    // Elevation difference
    let elevDiff = null;
    if (altArr && altArr.length > crossIdx && altArr.length > prevIdx) {
      elevDiff = (altArr[crossIdx] || 0) - (altArr[prevIdx] || 0);
    }

    // Average speed for the split
    let avgSpeed = null;
    if (splitTime > 0 && splitDist > 0) {
      avgSpeed = Math.round((splitDist / splitTime) * 1000) / 1000;
      // Protect against invalid speed
      if (!Number.isFinite(avgSpeed) || avgSpeed <= 0) avgSpeed = null;
    }

    // Average and max heartrate for the split
    let avgHr = null;
    let maxHr = null;
    if (hrArr && hrArr.length >= minLen) {
      let hrSum = 0;
      let hrCount = 0;
      let hrMax = 0;
      for (let i = prevIdx; i <= Math.min(crossIdx, hrArr.length - 1); i++) {
        if (hrArr[i] != null && hrArr[i] > 0) {
          hrSum += hrArr[i];
          hrCount++;
          if (hrArr[i] > hrMax) hrMax = hrArr[i];
        }
      }
      if (hrCount > 0) {
        avgHr = hrSum / hrCount;
        maxHr = hrMax;
      }
    }

    // Average cadence for the split
    let avgCad = null;
    if (cadArr && cadArr.length >= minLen) {
      let cadSum = 0;
      let cadCount = 0;
      for (let i = prevIdx; i <= Math.min(crossIdx, cadArr.length - 1); i++) {
        if (cadArr[i] != null && cadArr[i] > 0) {
          cadSum += cadArr[i];
          cadCount++;
        }
      }
      if (cadCount > 0) avgCad = cadSum / cadCount;
    }

    // Only include if we have a meaningful split (at least partial km or final)
    const isFinalPartial = km > numFullKm;
    if (isFinalPartial && splitDist < 100) {
      // Skip trivially small final partial
      break;
    }

    splits.push({
      split: km,
      distance: Math.round(splitDist * 10) / 10,
      moving_time: Math.round(splitTime),
      elapsed_time: Math.round(splitTime),
      elevation_difference: elevDiff != null ? Math.round(elevDiff * 10) / 10 : null,
      average_speed: avgSpeed,
      average_heartrate: avgHr,
      max_heartrate: maxHr,
      average_cadence: avgCad != null ? Math.round(avgCad * 10) / 10 : null,
      // pace_zone: not reliably available from Intervals, use null
      pace_zone: null,
      _endTime: timeAtBoundary,
    });

    prevIdx = crossIdx;
    prevKmDist = targetDist;
  }

  // Remove internal _endTime property
  return splits.map(({ _endTime, ...rest }) => rest);
}

/**
 * Check if an Intervals activity is a potential duplicate of an existing activity.
 * Uses namespaced ID as primary check, then secondary checks on start_time/distance/type.
 */
function isIntervalsDuplicate(adapted, existingIndexMap) {
  // Primary: exact namespaced ID match
  if (existingIndexMap.has(adapted.id)) {
    return { isDuplicate: true, reason: "exact_id" };
  }

  // Secondary: check if this activity's external/strava ID matches an existing Strava activity
  if (adapted._external_id) {
    const stravaId = String(adapted._external_id);
    if (existingIndexMap.has(stravaId)) {
      return { isDuplicate: true, reason: "external_id_match", matchedId: stravaId };
    }
  }

  // Tertiary: fuzzy match on start_time + type + distance
  if (adapted.start_date && adapted._type && adapted.distance > 0) {
    const adaptedMs = Date.parse(adapted.start_date);
    if (Number.isFinite(adaptedMs)) {
      for (const [, item] of existingIndexMap) {
        if (!item.start_date || !item.type) continue;
        if (item.type !== adapted._type) continue;

        const itemMs = Date.parse(item.start_date);
        if (!Number.isFinite(itemMs)) continue;

        // Within 5 minutes
        if (Math.abs(adaptedMs - itemMs) > 300_000) continue;

        // Distance within 10%
        const itemDist = Number(item.distance || 0);
        if (itemDist <= 0) continue;
        const distRatio = Math.abs(adapted.distance - itemDist) / itemDist;
        if (distRatio < 0.10) {
          return {
            isDuplicate: true,
            reason: "fuzzy_match",
            matchedId: String(item.id),
            timeDiff: Math.abs(adaptedMs - itemMs),
            distRatio,
          };
        }
      }
    }
  }

  return { isDuplicate: false };
}

/**
 * Fetch and select a single pre-cutover test activity from Intervals.icu.
 * Used only when INTERVALS_INCLUDE_TEST_RUN is true.
 *
 * If INTERVALS_TEST_ACTIVITY_ID is set, fetches that exact activity.
 * Otherwise, queries 29 July 2026 activities and picks the newest Run.
 *
 * Returns a single adapted activity with temporary_test: true, or null.
 */
async function fetchTestRunActivity(http, athleteId) {
  if (INTERVALS_TEST_ACTIVITY_ID) {
    // Fetch by exact ID
    console.log(`[TEST RUN] Fetching exact test activity: ${INTERVALS_TEST_ACTIVITY_ID}`);
    try {
      const resp = await getWithRetry(http, `/activity/${INTERVALS_TEST_ACTIVITY_ID}`);
      const raw = resp.data;
      if (!raw || !raw.id) return null;

      const adapted = adaptIntervalsActivity(raw);
      adapted.temporary_test = true;
      return adapted;
    } catch (err) {
      console.log(`[TEST RUN] Failed to fetch ${INTERVALS_TEST_ACTIVITY_ID}: ${err.message}`);
      return null;
    }
  }

  // No exact ID — query 29 July 2026 and pick newest Run
  console.log(`[TEST RUN] Searching for newest Run on ${INTERVALS_TEST_DAY_START}...`);
  try {
    const resp = await getWithRetry(http, `/athlete/${athleteId}/activities`, {
      params: { oldest: INTERVALS_TEST_DAY_START, newest: INTERVALS_TEST_DAY_START },
    });
    const data = Array.isArray(resp.data) ? resp.data : [];

    // Filter to Runs only, sort by start time descending
    const runs = data
      .filter((a) => {
        const norm = normalizeIntervalsType(a.type);
        return norm === "Run";
      })
      .sort((a, b) => {
        const aMs = Date.parse(a.start_date_local || a.start_date || 0);
        const bMs = Date.parse(b.start_date_local || b.start_date || 0);
        return bMs - aMs;
      });

    if (runs.length === 0) {
      console.log(`[TEST RUN] No Runs found on ${INTERVALS_TEST_DAY_START}.`);
      return null;
    }

    const selected = runs[0];
    console.log(`[TEST RUN] Selected newest Run: id=${selected.id}, name=${selected.name || "?"}`);

    const adapted = adaptIntervalsActivity(selected);
    adapted.temporary_test = true;
    return adapted;
  } catch (err) {
    console.log(`[TEST RUN] Failed to fetch test day activities: ${err.message}`);
    return null;
  }
}

/**
 * Build the detailed splits data file for an Intervals activity.
 * Matches the exact schema of Strava splits/{id}.json files.
 */
function buildIntervalsSplitsData(adapted, streams) {
  const hasHr = !!(adapted.average_heartrate || (streams?.heartrate && streams.heartrate.some((v) => v > 0)));

  // Calculate per-km splits from streams
  const kmSplits = calculateKmSplits(streams);

  return {
    activity_id: adapted.id,
    source: "intervals",
    source_activity_id: adapted.source_activity_id || null,
    ...(adapted.temporary_test ? { temporary_test: true } : {}),
    name: adapted.name || null,
    start_date: adapted.start_date || null,
    distance: adapted.distance || null,
    moving_time: adapted.moving_time || null,
    elapsed_time: adapted.elapsed_time || null,
    total_elevation_gain: adapted.total_elevation_gain || null,
    average_speed: adapted.average_speed || null,
    max_speed: adapted.max_speed || null,
    average_cadence: adapted.average_cadence ?? null,
    average_heartrate: adapted.average_heartrate ?? null,
    max_heartrate: adapted.max_heartrate ?? null,
    has_heartrate: hasHr,
    suffer_score: null, // Not available from Intervals
    calories: adapted.calories ?? null,
    perceived_exertion: null,
    elev_high: null,
    elev_low: null,
    workout_type: null,
    description: adapted.description || null,
    device_name: adapted.device_name || null,
    // Laps: map from Intervals intervals/laps if available, otherwise empty
    laps: [],
    // Best efforts: not reliably available from Intervals, use empty array
    best_efforts: [],
    splits: kmSplits,
    streams: streams || null,
    weather_samples: [], // Populated by weather enrichment below
  };
}

async function getSsmParams() {
  const names = ["/strava/client_id", "/strava/secret", "/strava/refresh"];

  const resp = await ssm.send(
    new GetParametersCommand({
      Names: names,
      WithDecryption: true,
    })
  );

  const found = Object.fromEntries(
    (resp.Parameters || []).map((p) => [p.Name, p.Value])
  );

  const missing = names.filter((name) => !found[name]);

  if (missing.length > 0) {
    throw new Error(`Missing SSM parameter(s): ${missing.join(", ")}`);
  }

  return {
    client_id: found["/strava/client_id"],
    client_secret: found["/strava/secret"],
    refresh_token: found["/strava/refresh"],
  };
}

async function updateStoredRefreshTokenIfChanged(oldRefreshToken, newRefreshToken) {
  if (!newRefreshToken || newRefreshToken === oldRefreshToken) {
    return false;
  }

  try {
    await ssm.send(
      new PutParameterCommand({
        Name: "/strava/refresh",
        Type: "SecureString",
        Value: newRefreshToken,
        Overwrite: true,
      })
    );

    console.log("Updated /strava/refresh in SSM with new refresh token.");
    return true;
  } catch (err) {
    console.warn(
      "Could not update /strava/refresh in SSM. Add ssm:PutParameter permission if future token refreshes fail.",
      JSON.stringify({
        message: err.message,
        name: err.name,
      })
    );

    return false;
  }
}

async function getStravaAccessToken({ client_id, client_secret, refresh_token }) {
  try {
    const resp = await axios.post(
      "https://www.strava.com/api/v3/oauth/token",
      {
        client_id,
        client_secret,
        grant_type: "refresh_token",
        refresh_token,
      },
      { timeout: 15000 }
    );

    if (!resp.data?.access_token) {
      throw new Error("Strava token response did not contain access_token.");
    }

    await updateStoredRefreshTokenIfChanged(
      refresh_token,
      resp.data.refresh_token
    );

    return {
      access_token: resp.data.access_token,
      expires_at: resp.data.expires_at,
      refresh_token: resp.data.refresh_token,
    };
  } catch (err) {
    const status = err.response?.status;
    const body = err.response?.data;

    console.error(
      "Failed to exchange Strava refresh token.",
      JSON.stringify({ status, body })
    );

    throw new Error(
      `Strava auth failed. Check /strava/client_id, /strava/secret, and /strava/refresh. Status=${status || "unknown"}`
    );
  }
}

async function loadJsonFromS3OrDefault(key, defaultValue) {
  try {
    const resp = await s3.send(
      new GetObjectCommand({
        Bucket: BUCKET,
        Key: key,
      })
    );

    const body = await streamToString(resp.Body);
    return JSON.parse(body);
  } catch (err) {
    console.log(`No readable S3 JSON found at s3://${BUCKET}/${key}. Error: ${err.name}: ${err.message}. Continuing.`);
    return defaultValue;
  }
}

async function headExistingObject(key) {
  try {
    const resp = await s3.send(
      new HeadObjectCommand({
        Bucket: BUCKET,
        Key: key,
      })
    );

    return {
      exists: true,
      size: resp.ContentLength || 0,
      last_modified: resp.LastModified?.toISOString?.() || null,
      etag: resp.ETag || null,
    };
  } catch {
    return {
      exists: false,
      size: 0,
      last_modified: null,
      etag: null,
    };
  }
}

async function putJson(key, body, contentType = "application/json") {
  const json = JSON.stringify(body);

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: json,
      ContentType: contentType,
      CacheControl: "max-age=300",
    })
  );

  return Buffer.byteLength(json, "utf-8");
}

function isRunActivity(activity) {
  const type = activity.sport_type || activity.type;
  return type === "Run";
}

function isIncludedActivity(activity) {
  const type = activity.sport_type || activity.type;
  return type === "Run" || type === "Ride" || type === "GravelRide";
}

function getActivityType(activity) {
  return activity.sport_type || activity.type || null;
}

function weekKey(isoDate, zone) {
  const dt = DateTime.fromISO(isoDate, { zone });
  return `${dt.weekYear}-${String(dt.weekNumber).padStart(2, "0")}`;
}

function getNewestStartDateFromIndex(index) {
  const items = Array.isArray(index?.items) ? index.items : [];

  let newestMs = 0;
  let newestIso = null;

  for (const item of items) {
    if (!item?.start_date) continue;

    const ms = Date.parse(item.start_date);

    if (Number.isFinite(ms) && ms > newestMs) {
      newestMs = ms;
      newestIso = item.start_date;
    }
  }

  return {
    newestIso,
    newestMs,
  };
}

function indexItemsToMap(index) {
  const map = new Map();

  const items = Array.isArray(index?.items) ? index.items : [];

  for (const item of items) {
    if (!item?.id) continue;
    map.set(String(item.id), item);
  }

  return map;
}

function featureCollectionToMap(geojson) {
  const map = new Map();

  const features = Array.isArray(geojson?.features) ? geojson.features : [];

  for (const feature of features) {
    const id = feature?.properties?.id;

    if (!id) continue;

    map.set(String(id), feature);
  }

  return map;
}

function buildIndexEntry(run) {
  const hasPolyline = !!run.map?.summary_polyline;
  // For Intervals activities, has_map is set during map fetch
  const hasMap = run._has_map != null ? run._has_map : hasPolyline;

  return {
    id: run.id,
    name: run.name || null,
    start_date: run.start_date || null,
    type: run._type || null,
    distance: run.distance ?? null,
    moving_time: run.moving_time ?? null,
    elapsed_time: run.elapsed_time ?? null,
    average_speed: run.average_speed ?? null,
    total_elevation_gain: run.total_elevation_gain ?? null,
    gear_id: run.gear_id ?? null,
    gear_name: run._gear_name ?? null,
    shoe_name: run._shoe_name ?? null,
    has_map: hasMap,
    has_splits: run._has_splits || false,
    // Source metadata (present for Intervals activities)
    ...(run.source ? { source: run.source } : {}),
    ...(run.source_activity_id ? { source_activity_id: run.source_activity_id } : {}),
    ...(run.temporary_test ? { temporary_test: true } : {}),
  };
}

function buildGeoJsonFeature(run) {
  if (!run.map?.summary_polyline) {
    return null;
  }

  let coords;

  try {
    coords = polyline
      .decode(run.map.summary_polyline)
      .map(([lat, lon]) => [lon, lat]);
  } catch (err) {
    console.log(`Could not decode polyline for activity ${run.id}. Skipping map feature.`);
    return null;
  }

  if (!coords || coords.length < 2) {
    return null;
  }

  return {
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: coords,
    },
    properties: {
      id: run.id,
      ...(run.source ? { source: run.source } : {}),
      ...(run.source_activity_id ? { source_activity_id: run.source_activity_id } : {}),
      ...(run.temporary_test ? { temporary_test: true } : {}),
      name: run.name || null,
      type: run._type || null,
      start_date: run.start_date || null,
      year: run.start_date
        ? new Date(run.start_date).getUTCFullYear().toString()
        : null,
      distance_m: run.distance || 0,
      moving_time: run.moving_time || null,
      elapsed_time: run.elapsed_time || null,
      average_speed: run.average_speed || null,
      total_elevation_gain: run.total_elevation_gain || null,
      gear_id: run.gear_id || null,
      gear_name: run._gear_name || null,
      shoe_name: run._shoe_name || null,
    },
  };
}

function buildStatsFromIndexItems(indexItems, timezone, overrides = {}) {
  const weekly = {};
  const byShoe = {};
  const byYear = {};
  const byDayOfWeek = {};

  const now = DateTime.now().setZone(timezone);
  const currentYear = now.year;
  const ytd = { distance_m: 0, count: 0 };

  let totalDistanceM = 0;
  let totalMovingTimeS = 0;
  let totalElevationM = 0;

  for (const item of indexItems) {
    if (!item.start_date) continue;
    if (item.type !== "Run") continue; // stats are run-only

    const dist = Number(item.distance || 0);
    const moving = Number(item.moving_time || 0);
    const elevation = Number(item.total_elevation_gain || 0);

    totalDistanceM += dist;
    totalMovingTimeS += moving;
    totalElevationM += elevation;

    const dt = DateTime.fromISO(item.start_date, { zone: timezone });

    if (!dt.isValid) {
      continue;
    }

    const year = dt.year;
    const wk = weekKey(item.start_date, timezone);
    const day = dt.weekdayLong;

    weekly[wk] ||= { distance_m: 0, count: 0, moving_time_s: 0 };
    weekly[wk].distance_m += dist;
    weekly[wk].count += 1;
    weekly[wk].moving_time_s += moving;

    byYear[year] ||= { distance_m: 0, count: 0, moving_time_s: 0 };
    byYear[year].distance_m += dist;
    byYear[year].count += 1;
    byYear[year].moving_time_s += moving;

    byDayOfWeek[day] ||= { distance_m: 0, count: 0, moving_time_s: 0 };
    byDayOfWeek[day].distance_m += dist;
    byDayOfWeek[day].count += 1;
    byDayOfWeek[day].moving_time_s += moving;

    const shoe = item.shoe_name || item.gear_name || null;
    const override = overrides[String(item.id)];

    if (override && Array.isArray(override.segments)) {
      // Apply override: distribute distance/time across segments
      for (const segment of override.segments) {
        const segShoe = segment.shoe_name;
        if (!segShoe) continue;

        byShoe[segShoe] ||= {
          distance_m: 0,
          count: 0,
          moving_time_s: 0,
          last_date: null,
        };

        byShoe[segShoe].distance_m += segment.distance_m;
        byShoe[segShoe].count += 1;
        byShoe[segShoe].moving_time_s += dist > 0
          ? Math.round(moving * (segment.distance_m / dist))
          : 0;

        if (!byShoe[segShoe].last_date || item.start_date > byShoe[segShoe].last_date) {
          byShoe[segShoe].last_date = item.start_date;
        }
      }
    } else if (shoe) {
      // Only contribute to byShoe if shoe is known (not null).
      // New Intervals activities have null shoe and intentionally do NOT
      // contribute to byShoe unless a valid manual override exists above.
      byShoe[shoe] ||= {
        distance_m: 0,
        count: 0,
        moving_time_s: 0,
        last_date: null,
      };

      byShoe[shoe].distance_m += dist;
      byShoe[shoe].count += 1;
      byShoe[shoe].moving_time_s += moving;

      if (!byShoe[shoe].last_date || item.start_date > byShoe[shoe].last_date) {
        byShoe[shoe].last_date = item.start_date;
      }
    }
    // else: Intervals activities without shoe assignment — contribute to totals
    // but NOT to byShoe. Intervals shoe mapping is intentionally deferred.

    if (year === currentYear) {
      ytd.distance_m += dist;
      ytd.count += 1;
    }
  }

  return {
    generated_at: new Date().toISOString(),
    timezone,
    totals: {
      runs: indexItems.length,
      distance_m: totalDistanceM,
      moving_time_s: totalMovingTimeS,
      elevation_gain_m: totalElevationM,
    },
    ytd,
    weekly,
    byShoe,
    byYear,
    byDayOfWeek,
  };
}

async function fetchActivities(http, context, afterUnix) {
  const allActivities = [];
  let page = 1;
  let lastFirstId = null;

  while (page <= MAX_PAGES) {
    const remainingMs = context?.getRemainingTimeInMillis?.() || 999999;

    if (remainingMs < MIN_MS_LEFT) {
      console.log(
        `Stopping pagination because Lambda has only ${remainingMs}ms remaining.`
      );
      break;
    }

    const params = {
      page,
      per_page: PER_PAGE,
    };

    if (afterUnix && afterUnix > 0) {
      params.after = afterUnix;
    }

    console.log(
      `Fetching Strava activities page ${page}${afterUnix ? ` after=${afterUnix}` : ""}...`
    );

    const resp = await getWithRetry(http, "/athlete/activities", { params });
    const data = Array.isArray(resp.data) ? resp.data : [];

    logObject("Fetched page", {
      page,
      count: data.length,
      first_id: data[0]?.id || null,
      last_id: data[data.length - 1]?.id || null,
      first_start_date: data[0]?.start_date || null,
      last_start_date: data[data.length - 1]?.start_date || null,
    });

    if (data.length === 0) {
      break;
    }

    const firstId = data[0]?.id;

    if (firstId && firstId === lastFirstId) {
      console.log(`Stopping pagination because page ${page} repeated first id ${firstId}.`);
      break;
    }

    lastFirstId = firstId;
    allActivities.push(...data);

    if (data.length < PER_PAGE) {
      break;
    }

    page += 1;
  }

  return {
    allActivities,
    pagesAttempted: page,
  };
}

// ---------- Splits fetching ----------

async function loadSplitsState() {
  return await loadJsonFromS3OrDefault(SPLITS_STATE_KEY, {
    last_run_at: null,
    recent_ids: [],
  });
}

async function saveSplitsState(state) {
  await putJson(SPLITS_STATE_KEY, state, "application/json");
}

// ---- Weather enrichment helpers ----

function roundCoord(value, decimals) {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function weatherCacheKey(lat, lng, date) {
  return `${lat},${lng}:${date}`;
}

async function loadWeatherCache() {
  return await loadJsonFromS3OrDefault(WEATHER_CACHE_KEY, {});
}

async function saveWeatherCache(cache) {
  if (!DRY_RUN) {
    await putJson(WEATHER_CACHE_KEY, cache, "application/json");
  }
}

/**
 * Fetch hourly weather from Open-Meteo Historical Weather API.
 * Returns { temperature_2m: [...], apparent_temperature: [...], time: [...] } or null on failure.
 */
async function fetchOpenMeteoWeather(lat, lng, date) {
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lng}&start_date=${date}&end_date=${date}&hourly=temperature_2m,apparent_temperature&timezone=UTC`;
  try {
    const resp = await axios.get(url, { timeout: 10000 });
    const hourly = resp.data?.hourly;
    if (!hourly || !hourly.time || !hourly.temperature_2m) return null;
    return hourly;
  } catch (err) {
    console.log(`  [weather] Open-Meteo fetch failed for ${lat},${lng} on ${date}: ${err.message}`);
    return null;
  }
}

/**
 * Build sample points every WEATHER_INTERVAL_SECONDS from streams.
 * Returns array of { elapsed_seconds, timestamp, lat, lng } or [] if data missing.
 */
function buildWeatherSamplePoints(activity, streams) {
  const timeArr = streams?.time;
  const latlngArr = streams?.latlng;

  if (!timeArr || !latlngArr || !timeArr.length || !latlngArr.length) return [];
  if (!activity.start_date) return [];

  const startMs = Date.parse(activity.start_date);
  if (!Number.isFinite(startMs)) return [];

  const totalElapsed = timeArr[timeArr.length - 1];
  const samples = [];

  for (let targetSec = 0; targetSec <= totalElapsed; targetSec += WEATHER_INTERVAL_SECONDS) {
    // Find closest stream index to target elapsed time
    let closestIdx = 0;
    let closestDiff = Math.abs(timeArr[0] - targetSec);
    for (let i = 1; i < timeArr.length; i++) {
      const diff = Math.abs(timeArr[i] - targetSec);
      if (diff < closestDiff) {
        closestDiff = diff;
        closestIdx = i;
      }
      if (timeArr[i] > targetSec) break; // time is monotonic, no need to continue
    }

    const latlng = latlngArr[closestIdx];
    if (!latlng || latlng.length < 2) continue;

    samples.push({
      elapsed_seconds: targetSec,
      timestamp: new Date(startMs + targetSec * 1000).toISOString(),
      lat: latlng[0],
      lng: latlng[1],
    });
  }

  return samples;
}

/**
 * Enrich sample points with weather data from Open-Meteo, using a cache.
 * Mutates weatherCache in-place. Returns enriched samples array.
 */
async function enrichSamplesWithWeather(samples, weatherCache) {
  if (!samples.length) return [];

  // Group samples by rounded coord + date for efficient fetching
  const fetchNeeded = new Map(); // cacheKey -> { lat, lng, date }

  for (const sample of samples) {
    const lat = roundCoord(sample.lat, WEATHER_COORD_DECIMALS);
    const lng = roundCoord(sample.lng, WEATHER_COORD_DECIMALS);
    const date = sample.timestamp.slice(0, 10); // YYYY-MM-DD
    const key = weatherCacheKey(lat, lng, date);

    if (!weatherCache[key] && !fetchNeeded.has(key)) {
      fetchNeeded.set(key, { lat, lng, date });
    }
  }

  // Fetch missing weather data
  for (const [key, { lat, lng, date }] of fetchNeeded) {
    const hourly = await fetchOpenMeteoWeather(lat, lng, date);
    if (hourly) {
      weatherCache[key] = hourly;
    } else {
      // Store empty marker so we don't retry this invocation
      weatherCache[key] = { time: [], temperature_2m: [], apparent_temperature: [] };
    }
    // Small delay between Open-Meteo calls
    await sleep(100);
  }

  // Attach weather to each sample
  const enriched = [];
  for (const sample of samples) {
    const lat = roundCoord(sample.lat, WEATHER_COORD_DECIMALS);
    const lng = roundCoord(sample.lng, WEATHER_COORD_DECIMALS);
    const date = sample.timestamp.slice(0, 10);
    const key = weatherCacheKey(lat, lng, date);

    const hourly = weatherCache[key];
    let temperature_2m = null;
    let apparent_temperature = null;

    if (hourly && hourly.time && hourly.time.length > 0) {
      // Find nearest hour to sample timestamp
      const sampleHour = new Date(sample.timestamp).getUTCHours();
      // hourly.time entries are ISO strings like "2026-06-23T06:00"
      let bestIdx = 0;
      let bestDiff = Infinity;
      for (let i = 0; i < hourly.time.length; i++) {
        const hourStr = hourly.time[i];
        const hour = parseInt(hourStr.slice(11, 13), 10);
        const diff = Math.abs(hour - sampleHour);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestIdx = i;
        }
      }
      temperature_2m = hourly.temperature_2m?.[bestIdx] ?? null;
      apparent_temperature = hourly.apparent_temperature?.[bestIdx] ?? null;
    }

    enriched.push({
      elapsed_seconds: sample.elapsed_seconds,
      timestamp: sample.timestamp,
      lat: sample.lat,
      lng: sample.lng,
      temperature_2m,
      apparent_temperature,
    });
  }

  return enriched;
}

// ---- End weather helpers ----

async function fetchAndStoreSplits(http, context, runIds, splitsState) {
  const recentIds = new Set(splitsState.recent_ids || splitsState.fetched_ids || []);
  const idsToFetch = runIds.filter((id) => !recentIds.has(String(id)));

  if (idsToFetch.length === 0) {
    console.log("No new runs need splits fetched.");
    return { fetched: 0, failed: 0, skipped: runIds.length, fetchedIds: new Set() };
  }

  console.log(`Fetching splits for ${idsToFetch.length} runs...`);

  // Load weather cache once for the entire batch
  let weatherCache = {};
  let weatherCacheDirty = false;
  if (WEATHER_ENABLED) {
    weatherCache = await loadWeatherCache();
    console.log(`  [weather] Cache loaded: ${Object.keys(weatherCache).length} entries`);
  }

  let fetched = 0;
  let failed = 0;
  const newlyFetchedIds = new Set();

  for (const id of idsToFetch) {
    const remainingMs = context?.getRemainingTimeInMillis?.() || 999999;

    if (remainingMs < MIN_MS_LEFT) {
      console.log(`Stopping splits fetch — only ${remainingMs}ms remaining.`);
      break;
    }

    try {
      // Fetch the detailed activity — includes splits, heart rate, laps, best efforts, etc.
      const resp = await getWithRetry(http, `/activities/${id}`, {
        params: { include_all_efforts: true },
      });

      const activity = resp.data;
      const splits = activity?.splits_metric || activity?.splits_standard || [];

      // Fetch per-second activity streams (velocity, HR, distance, etc.)
      let streams = null;
      try {
        const streamsResp = await getWithRetry(http, `/activities/${id}/streams`, {
          params: { keys: 'latlng,velocity_smooth,distance,time,heartrate,altitude,cadence', key_by_type: 'true' },
        });
        const raw = streamsResp.data;
        const streamData = {};
        if (Array.isArray(raw)) {
          // Array format: [{type: "distance", data: [...]}, ...]
          for (const stream of raw) {
            streamData[stream.type] = stream.data;
          }
        } else if (raw && typeof raw === 'object') {
          // Object format (key_by_type=true): { distance: {data: [...]}, velocity_smooth: {data: [...]} }
          for (const [key, val] of Object.entries(raw)) {
            streamData[key] = val?.data || val;
          }
        }
        if (Object.keys(streamData).length > 0) {
          streams = streamData;
          console.log(`  [streams] SUCCESS for ${id}: keys=${Object.keys(streamData).join(', ')}, points=${(streamData.time || streamData.distance || []).length}`);
        } else {
          console.log(`  [streams] Empty streams data for ${id}`);
        }
      } catch (err) {
        const status = err.response?.status;
        console.log(`  [streams] FAILED for ${id}: status=${status}, message=${err.message}`);
      }

      if (splits.length > 0 || activity) {
        const splitsData = {
          activity_id: id,
          name: activity.name || null,
          start_date: activity.start_date || null,
          distance: activity.distance || null,
          moving_time: activity.moving_time || null,
          elapsed_time: activity.elapsed_time || null,
          total_elevation_gain: activity.total_elevation_gain || null,
          average_speed: activity.average_speed || null,
          max_speed: activity.max_speed || null,
          average_cadence: activity.average_cadence ?? null,
          average_heartrate: activity.average_heartrate ?? null,
          max_heartrate: activity.max_heartrate ?? null,
          has_heartrate: activity.has_heartrate || false,
          suffer_score: activity.suffer_score ?? null,
          calories: activity.calories ?? null,
          perceived_exertion: activity.perceived_exertion ?? null,
          elev_high: activity.elev_high ?? null,
          elev_low: activity.elev_low ?? null,
          workout_type: activity.workout_type ?? null,
          description: activity.description || null,
          device_name: activity.device_name || null,
          laps: (activity.laps || []).map((lap, i) => ({
            lap: i + 1,
            name: lap.name || null,
            distance: lap.distance ?? null,
            moving_time: lap.moving_time ?? null,
            elapsed_time: lap.elapsed_time ?? null,
            start_index: lap.start_index ?? null,
            end_index: lap.end_index ?? null,
            average_speed: lap.average_speed ?? null,
            max_speed: lap.max_speed ?? null,
            average_cadence: lap.average_cadence ?? null,
            average_heartrate: lap.average_heartrate ?? null,
            max_heartrate: lap.max_heartrate ?? null,
            total_elevation_gain: lap.total_elevation_gain ?? null,
            pace_zone: lap.pace_zone ?? null,
          })),
          best_efforts: (activity.best_efforts || []).map((effort) => ({
            name: effort.name || null,
            distance: effort.distance ?? null,
            moving_time: effort.moving_time ?? null,
            elapsed_time: effort.elapsed_time ?? null,
            start_index: effort.start_index ?? null,
            end_index: effort.end_index ?? null,
            pr_rank: effort.pr_rank ?? null,
          })),
          splits: splits.map((s, i) => ({
            split: i + 1,
            distance: s.distance ?? null,
            moving_time: s.moving_time ?? null,
            elapsed_time: s.elapsed_time ?? null,
            elevation_difference: s.elevation_difference ?? null,
            average_speed: s.average_speed ?? null,
            average_heartrate: s.average_heartrate ?? null,
            max_heartrate: s.max_heartrate ?? null,
            average_cadence: s.average_cadence ?? null,
            pace_zone: s.pace_zone ?? null,
          })),
          streams: streams, // per-second data: { latlng, velocity_smooth, distance, time, heartrate, altitude, cadence }
          weather_samples: [], // populated below if weather enabled
        };

        // Weather enrichment
        if (WEATHER_ENABLED) {
          try {
            const samples = buildWeatherSamplePoints(activity, streams);
            if (samples.length > 0) {
              splitsData.weather_samples = await enrichSamplesWithWeather(samples, weatherCache);
              weatherCacheDirty = true;
              console.log(`  [weather] ${splitsData.weather_samples.length} samples for ${id}`);
            }
          } catch (err) {
            console.log(`  [weather] Failed for ${id}: ${err.message}`);
            // Non-fatal: weather_samples stays as []
          }
        }

        if (!DRY_RUN) {
          await putJson(`${SPLITS_PREFIX}${id}.json`, splitsData, "application/json");
        }

        newlyFetchedIds.add(String(id));
        fetched += 1;

        console.log(`  ✓ Data for ${id}: ${splits.length} splits, hr=${activity.has_heartrate || false}, laps=${(activity.laps||[]).length}`);
      } else {
        newlyFetchedIds.add(String(id));
        console.log(`  - No data for ${id}`);
      }

      // Small delay to avoid rate limiting
      await sleep(200);
    } catch (err) {
      const status = err.response?.status;
      console.log(`  ✗ Failed splits for ${id}: status=${status || err.message}`);
      failed += 1;

      // If rate limited, back off and stop
      if (status === 429) {
        console.log("Rate limited on splits fetch. Stopping and will continue next run.");
        break;
      }
    }
  }

  // Save weather cache if it was updated
  if (WEATHER_ENABLED && weatherCacheDirty) {
    try {
      await saveWeatherCache(weatherCache);
      console.log(`  [weather] Cache saved: ${Object.keys(weatherCache).length} entries`);
    } catch (err) {
      console.log(`  [weather] Failed to save cache: ${err.message}`);
    }
  }

  // Update state — keep only the last 50 IDs as a safety net for backdated runs
  const allIds = [...recentIds, ...newlyFetchedIds];
  const trimmedIds = allIds.slice(-50);

  const updatedState = {
    last_run_at: new Date().toISOString(),
    recent_ids: trimmedIds,
  };

  if (!DRY_RUN) {
    await saveSplitsState(updatedState);
  }

  return { fetched, failed, skipped: runIds.length - idsToFetch.length, fetchedIds: newlyFetchedIds };
}


export const handler = async (event, context) => {
  if (!BUCKET) {
    throw new Error("Missing BUCKET env var.");
  }

  // --- Log source selection (never log credentials) ---
  console.log(`ACTIVITY_SOURCE=${ACTIVITY_SOURCE} (USE_STRAVA=${USE_STRAVA})`);
  if (ACTIVITY_SOURCE === "intervals") {
    console.log(`Intervals.icu cutover date: ${INTERVALS_CUTOVER_ISO}`);
  }

  logObject("Config", {
    region: REGION,
    bucket: BUCKET,
    key: KEY,
    index_key: INDEX_KEY,
    stats_key: STATS_KEY,
    cache_key: CACHE_KEY,
    splits_state_key: SPLITS_STATE_KEY,
    splits_prefix: SPLITS_PREFIX,
    timezone: TIMEZONE,
    max_pages: MAX_PAGES,
    dry_run: DRY_RUN,
    force_full_refresh: FORCE_FULL_REFRESH,
    incremental_lookback_seconds: INCREMENTAL_LOOKBACK_SECONDS,
    activity_source: ACTIVITY_SOURCE,
    remaining_ms_start: context?.getRemainingTimeInMillis?.() || null,
  });

  // --- Load and validate existing S3 data ---
  const existingObjects = {
    geojson: await headExistingObject(KEY),
    index: await headExistingObject(INDEX_KEY),
    stats: await headExistingObject(STATS_KEY),
  };

  logObject("Existing S3 objects before run", existingObjects);

  const existingIndex = await loadJsonFromS3OrDefault(INDEX_KEY, {
    generated_at: null,
    timezone: TIMEZONE,
    count: 0,
    items: [],
  });

  const existingGeojson = await loadJsonFromS3OrDefault(KEY, {
    type: "FeatureCollection",
    features: [],
  });

  const cache = await loadJsonFromS3OrDefault(CACHE_KEY, {});

  const existingIndexItems = Array.isArray(existingIndex.items)
    ? existingIndex.items
    : [];

  const existingFeatureCount = Array.isArray(existingGeojson.features)
    ? existingGeojson.features.length
    : 0;

  logObject("Existing dataset loaded", {
    existing_index_count: existingIndexItems.length,
    existing_feature_count: existingFeatureCount,
    cache_entries: Object.keys(cache).length,
  });

  // --- Data safety: if existing data should exist but can't be read, abort ---
  if (existingObjects.index.exists && existingObjects.index.size > 100 && existingIndexItems.length === 0) {
    throw new Error(
      "SAFETY: Existing runs_index.json exists in S3 but parsed as empty. Refusing to proceed."
    );
  }
  if (existingObjects.geojson.exists && existingObjects.geojson.size > 100 && existingFeatureCount === 0) {
    throw new Error(
      "SAFETY: Existing runs.geojson exists in S3 but parsed with zero features. Refusing to proceed."
    );
  }

  // --- Branch by source ---
  if (ACTIVITY_SOURCE === "strava") {
    return await handleStravaSource(context, existingIndex, existingGeojson, cache, existingIndexItems, existingFeatureCount);
  } else {
    return await handleIntervalsSource(context, existingIndex, existingGeojson, cache, existingIndexItems, existingFeatureCount);
  }
};

// ========== STRAVA SOURCE HANDLER (preserved existing logic) ==========

async function handleStravaSource(context, existingIndex, existingGeojson, cache, existingIndexItems, existingFeatureCount) {
  const newestExisting = getNewestStartDateFromIndex(existingIndex);

  const hasExistingDataset =
    existingIndexItems.length > 0 &&
    existingFeatureCount > 0 &&
    newestExisting.newestMs > 0;

  let afterUnix = null;
  let mode = "full";

  if (!FORCE_FULL_REFRESH && hasExistingDataset) {
    afterUnix = Math.max(
      0,
      Math.floor(newestExisting.newestMs / 1000) - INCREMENTAL_LOOKBACK_SECONDS
    );
    mode = "incremental";
  }

  logObject("Fetch mode", {
    mode,
    newest_existing_start_date: newestExisting.newestIso,
    after_unix: afterUnix,
    after_iso: afterUnix ? new Date(afterUnix * 1000).toISOString() : null,
  });

  const creds = await getSsmParams();
  console.log("SSM credentials loaded. Testing Strava token exchange...");

  const token = await getStravaAccessToken(creds);
  logObject("Strava token exchange succeeded", {
    expires_at: token.expires_at || null,
    received_new_refresh_token: !!token.refresh_token,
  });

  const http = axios.create({
    baseURL: "https://www.strava.com/api/v3",
    headers: { Authorization: `Bearer ${token.access_token}` },
    timeout: 20000,
  });

  console.log("Testing Strava API with /athlete...");
  const athleteResp = await getWithRetry(http, "/athlete");
  const athlete = athleteResp.data || {};
  logObject("Strava athlete test succeeded", {
    id: athlete.id || null,
    username: athlete.username || null,
  });

  const { allActivities, pagesAttempted } = await fetchActivities(http, context, afterUnix);
  const fetchedRuns = allActivities.filter(isIncludedActivity);

  logObject("Strava fetch summary", {
    mode,
    activities_fetched: allActivities.length,
    runs_fetched: fetchedRuns.length,
    pages_attempted: pagesAttempted,
  });

  if (mode === "full" && allActivities.length === 0) {
    throw new Error("Full refresh fetched zero Strava activities. Refusing to overwrite S3 outputs.");
  }
  if (mode === "full" && fetchedRuns.length === 0) {
    throw new Error(`Full refresh fetched ${allActivities.length} Strava activities, but zero included. Refusing to overwrite.`);
  }

  if (mode === "incremental" && fetchedRuns.length === 0) {
    console.log("No new run activities found. Regenerating stats with overrides...");
    const shoeOverrides = await loadJsonFromS3OrDefault("shoe_overrides.json", {});
    const refreshedStats = buildStatsFromIndexItems(existingIndexItems, TIMEZONE, shoeOverrides);
    if (!DRY_RUN) {
      await putJson(STATS_KEY, refreshedStats, "application/json");
    }
    return {
      ok: true, mode, source: "strava", dry_run: DRY_RUN, no_changes: true,
      stats_regenerated: true, athlete_id: athlete.id || null,
      newest_existing_start_date: newestExisting.newestIso,
      activities_fetched: allActivities.length, runs_fetched: fetchedRuns.length,
      existing_index_count: existingIndexItems.length, existing_feature_count: existingFeatureCount,
    };
  }

  const gearIds = [...new Set(fetchedRuns.map((a) => a.gear_id).filter(Boolean))];
  const gearCache = {};
  console.log(`Fetching gear details for ${gearIds.length} gear ids...`);

  for (const gearId of gearIds) {
    const remainingMs = context?.getRemainingTimeInMillis?.() || 999999;
    if (remainingMs < MIN_MS_LEFT) break;
    try {
      const gearResp = await getWithRetry(http, `/gear/${gearId}`);
      gearCache[gearId] = { id: gearResp.data?.id || gearId, name: gearResp.data?.name || null };
    } catch (err) {
      gearCache[gearId] = { id: gearId, name: null };
    }
  }

  for (const run of fetchedRuns) {
    run._type = getActivityType(run);
    const gear = run.gear_id ? gearCache[run.gear_id] : null;
    run._gear_name = gear?.name || null;
    run._shoe_name = run._type === "Run" ? gear?.name || null : null;
    run._has_splits = false;
  }

  const indexMap = mode === "full" ? new Map() : indexItemsToMap(existingIndex);
  const featureMap = mode === "full" ? new Map() : featureCollectionToMap(existingGeojson);

  let newRunsAdded = 0, existingRunsUpdated = 0, newFeaturesAddedOrUpdated = 0, newRunsWithoutMap = 0;

  for (const run of fetchedRuns) {
    const id = String(run.id);
    if (indexMap.has(id)) { existingRunsUpdated++; } else { newRunsAdded++; }
    indexMap.set(id, buildIndexEntry(run));
    const feature = buildGeoJsonFeature(run);
    if (feature) { featureMap.set(id, feature); newFeaturesAddedOrUpdated++; }
    else { newRunsWithoutMap++; }
  }

  const mergedIndexItems = [...indexMap.values()].sort((a, b) => Date.parse(b.start_date || 0) - Date.parse(a.start_date || 0));
  const mergedFeatures = [...featureMap.values()].sort((a, b) => Date.parse(b.properties?.start_date || 0) - Date.parse(a.properties?.start_date || 0));

  const mergedIndex = { generated_at: new Date().toISOString(), timezone: TIMEZONE, count: mergedIndexItems.length, items: mergedIndexItems };
  const mergedGeojson = { type: "FeatureCollection", features: mergedFeatures };

  const shoeOverrides = await loadJsonFromS3OrDefault("shoe_overrides.json", {});
  const mergedStats = buildStatsFromIndexItems(mergedIndexItems, TIMEZONE, shoeOverrides);

  logObject("Merge summary", {
    mode, source: "strava", fetched_runs: fetchedRuns.length,
    new_runs_added: newRunsAdded, existing_runs_updated: existingRunsUpdated,
    new_features_added_or_updated: newFeaturesAddedOrUpdated,
    new_runs_without_map: newRunsWithoutMap,
    merged_index_count: mergedIndexItems.length, merged_feature_count: mergedFeatures.length, dry_run: DRY_RUN,
  });

  if (mergedIndexItems.length === 0) throw new Error("Merged index would be empty. Refusing to overwrite S3 outputs.");
  if (mergedFeatures.length === 0) throw new Error("Merged GeoJSON would be empty. Refusing to overwrite S3 outputs.");

  // Safety: never reduce historical counts unexpectedly
  if (existingIndexItems.length > 0 && mergedIndexItems.length < existingIndexItems.length * 0.5) {
    throw new Error(`SAFETY: Merged index (${mergedIndexItems.length}) < 50% of existing (${existingIndexItems.length}). Refusing to write.`);
  }

  if (DRY_RUN) {
    console.log("DRY_RUN=true. Not writing to S3.");
    return {
      ok: true, dry_run: true, source: "strava", mode, athlete_id: athlete.id || null,
      newest_existing_start_date: newestExisting.newestIso,
      activities_fetched: allActivities.length, runs_fetched: fetchedRuns.length,
      new_runs_added: newRunsAdded, existing_runs_updated: existingRunsUpdated,
      merged_index_count: mergedIndexItems.length, merged_feature_count: mergedFeatures.length,
      would_write: [KEY, INDEX_KEY, STATS_KEY],
    };
  }

  // --- Fetch splits ---
  const splitsState = await loadSplitsState();
  const splitsAfterMs = splitsState.last_run_at ? Date.parse(splitsState.last_run_at) : Date.now() - (7 * 24 * 60 * 60 * 1000);

  const allRunIds = mergedIndexItems
    .filter((item) => {
      if (!item.distance || item.distance <= 500) return false;
      if (item.type !== "Run") return false;
      // Only fetch splits for Strava activities (not intervals: prefixed)
      if (String(item.id).startsWith("intervals:")) return false;
      return Date.parse(item.start_date || 0) > splitsAfterMs;
    })
    .map((item) => String(item.id));

  console.log(`Splits: found ${allRunIds.length} runs newer than ${new Date(splitsAfterMs).toISOString()}`);
  const splitsResult = await fetchAndStoreSplits(http, context, allRunIds, splitsState);
  logObject("Splits fetch summary", splitsResult);

  for (const item of mergedIndexItems) {
    if (splitsResult.fetchedIds.has(String(item.id))) item.has_splits = true;
  }

  mergedIndex.items = mergedIndexItems;

  const bytesGeojson = await putJson(KEY, mergedGeojson, "application/geo+json");
  const bytesIndex = await putJson(INDEX_KEY, mergedIndex, "application/json");
  const bytesStats = await putJson(STATS_KEY, mergedStats, "application/json");

  const result = {
    ok: true, dry_run: false, source: "strava", mode, athlete_id: athlete.id || null,
    newest_existing_start_date: newestExisting.newestIso, pages_attempted: pagesAttempted,
    activities_fetched: allActivities.length, runs_fetched: fetchedRuns.length,
    new_runs_added: newRunsAdded, existing_runs_updated: existingRunsUpdated,
    merged_index_count: mergedIndexItems.length, merged_feature_count: mergedFeatures.length,
    gear_ids: gearIds.length, splits: splitsResult,
    wrote: [{ key: KEY, bytes: bytesGeojson }, { key: INDEX_KEY, bytes: bytesIndex }, { key: STATS_KEY, bytes: bytesStats }],
  };

  logObject("Success", result);
  return result;
}

// ========== INTERVALS.ICU SOURCE HANDLER ==========

async function handleIntervalsSource(context, existingIndex, existingGeojson, cache, existingIndexItems, existingFeatureCount) {
  console.log(`Using Intervals.icu source. Athlete: ${INTERVALS_ATHLETE_ID}, Cutover: ${INTERVALS_CUTOVER_ISO}`);

  // Get Intervals API key from SSM (never log credentials)
  const apiKey = await getIntervalsApiKey();
  console.log("Intervals.icu API key loaded from SSM.");

  const http = createIntervalsHttpClient(apiKey);

  // Determine fetch date range
  const afterDate = getIntervalsAfterDate(existingIndex);
  console.log(`Intervals fetch start date: ${afterDate}`);

  // Fetch activities
  const rawActivities = await fetchIntervalsActivities(http, INTERVALS_ATHLETE_ID, afterDate, context);

  // Filter by cutover date and normalize types
  let acceptedCount = 0, excludedByType = 0, excludedByCutover = 0;
  const adaptedActivities = [];

  for (const raw of rawActivities) {
    const startLocal = raw.start_date_local || raw.start_date;
    if (startLocal) {
      const actMs = Date.parse(startLocal);
      if (Number.isFinite(actMs) && actMs < INTERVALS_CUTOVER_MS) {
        excludedByCutover++;
        continue;
      }
    }

    const adapted = adaptIntervalsActivity(raw);
    if (!adapted._type || !INCLUDED_TYPES.has(adapted._type)) {
      excludedByType++;
      continue;
    }

    adaptedActivities.push(adapted);
    acceptedCount++;
  }

  logObject("Intervals activity filtering", {
    raw_count: rawActivities.length, accepted: acceptedCount,
    excluded_by_type: excludedByType, excluded_by_cutover: excludedByCutover,
  });

  // Deduplicate against existing index
  const indexMap = indexItemsToMap(existingIndex);
  const featureMap = featureCollectionToMap(existingGeojson);

  let duplicatesSkipped = 0;
  const newActivities = [];

  for (const adapted of adaptedActivities) {
    const dupCheck = isIntervalsDuplicate(adapted, indexMap);
    if (dupCheck.isDuplicate) {
      console.log(`  [dedup] Skipping ${adapted.id}: ${dupCheck.reason}${dupCheck.matchedId ? ` (matched ${dupCheck.matchedId})` : ""}`);
      duplicatesSkipped++;
      continue;
    }
    newActivities.push(adapted);
  }

  logObject("Deduplication result", {
    candidates: adaptedActivities.length, duplicates_skipped: duplicatesSkipped, genuinely_new: newActivities.length,
  });

  // --- Temporary test run import ---
  let testRunImported = false;
  if (INTERVALS_INCLUDE_TEST_RUN) {
    console.log("[TEST RUN] ⚠️  INTERVALS_INCLUDE_TEST_RUN is enabled. Importing a pre-cutover test activity.");

    const testActivity = await fetchTestRunActivity(http, INTERVALS_ATHLETE_ID);
    if (testActivity) {
      // Only apply exact namespaced ID deduplication — intentionally bypass fuzzy/external matching
      if (indexMap.has(testActivity.id)) {
        console.log(`[TEST RUN] Already imported (exact ID match): ${testActivity.id}. Skipping repeat import.`);
      } else {
        testActivity.temporary_test = true;
        newActivities.push(testActivity);
        testRunImported = true;
        console.log(`[TEST RUN] ✓ Importing test activity: ${testActivity.id} (${testActivity.name || "unnamed"})`);
      }
    } else {
      console.log("[TEST RUN] No suitable test activity found.");
    }
  }

  // No-op if no new activities
  if (newActivities.length === 0) {
    console.log("No new Intervals activities found. Regenerating stats with overrides...");
    const shoeOverrides = await loadJsonFromS3OrDefault("shoe_overrides.json", {});
    const refreshedStats = buildStatsFromIndexItems(existingIndexItems, TIMEZONE, shoeOverrides);
    if (!DRY_RUN) {
      await putJson(STATS_KEY, refreshedStats, "application/json");
    }
    return {
      ok: true, source: "intervals", mode: "incremental", dry_run: DRY_RUN,
      no_changes: true, stats_regenerated: true, cutover_date: INTERVALS_CUTOVER_ISO,
      existing_index_count: existingIndexItems.length, existing_feature_count: existingFeatureCount,
      activities_returned: rawActivities.length, activities_accepted: acceptedCount,
      duplicates_skipped: duplicatesSkipped, new_activities: 0,
    };
  }

  // Fetch maps, streams, and build detailed data for genuinely new activities
  let newMapFeatures = 0, activitiesWithoutMap = 0;
  let detailedCreated = 0, detailedFailed = 0;
  let activitiesWithHr = 0, activitiesWithoutHr = 0;
  let weatherSamplesCreated = 0;

  let weatherCache = {};
  let weatherCacheDirty = false;
  if (WEATHER_ENABLED) {
    weatherCache = await loadWeatherCache();
    console.log(`  [weather] Cache loaded: ${Object.keys(weatherCache).length} entries`);
  }

  const splitsState = await loadSplitsState();
  const existingSplitIds = new Set(splitsState.recent_ids || []);
  const newSplitIds = new Set();

  for (const activity of newActivities) {
    const remainingMs = context?.getRemainingTimeInMillis?.() || 999999;
    if (remainingMs < MIN_MS_LEFT) {
      console.log(`Stopping detailed fetch — only ${remainingMs}ms remaining.`);
      break;
    }

    const intervalsId = activity.source_activity_id;

    // Fetch map
    const mapPoints = await fetchIntervalsMap(http, intervalsId);
    let feature = null;

    if (mapPoints && mapPoints.length >= 2) {
      feature = buildGeoJsonFeatureFromPoints(activity, mapPoints);
      activity._has_map = true;
    } else {
      activity._has_map = false;
    }

    if (feature) { featureMap.set(activity.id, feature); newMapFeatures++; }
    else { activitiesWithoutMap++; }

    // Fetch streams
    const streams = await fetchIntervalsStreams(http, intervalsId);

    if (streams?.heartrate && streams.heartrate.some((v) => v > 0)) { activitiesWithHr++; }
    else { activitiesWithoutHr++; }

    // Build and store detailed splits data
    try {
      const splitsData = buildIntervalsSplitsData(activity, streams);

      // Weather enrichment (uses existing Open-Meteo implementation)
      if (WEATHER_ENABLED && streams) {
        try {
          const samples = buildWeatherSamplePoints({ start_date: activity.start_date }, streams);
          if (samples.length > 0) {
            splitsData.weather_samples = await enrichSamplesWithWeather(samples, weatherCache);
            weatherCacheDirty = true;
            weatherSamplesCreated += splitsData.weather_samples.length;
            console.log(`  [weather] ${splitsData.weather_samples.length} samples for ${activity.id}`);
          }
        } catch (err) {
          console.log(`  [weather] Failed for ${activity.id}: ${err.message}`);
        }
      }

      if (!DRY_RUN) {
        await putJson(`${SPLITS_PREFIX}${activity.id}.json`, splitsData, "application/json");
      }

      activity._has_splits = true;
      newSplitIds.add(activity.id);
      detailedCreated++;
      console.log(`  ✓ ${activity.id}: splits=${splitsData.splits.length}, hr=${splitsData.has_heartrate}, map=${activity._has_map}`);
    } catch (err) {
      console.log(`  ✗ Failed detailed for ${activity.id}: ${err.message}`);
      detailedFailed++;
    }

    await sleep(200);
  }

  // Save weather cache if updated
  if (WEATHER_ENABLED && weatherCacheDirty) {
    try {
      await saveWeatherCache(weatherCache);
      console.log(`  [weather] Cache saved: ${Object.keys(weatherCache).length} entries`);
    } catch (err) {
      console.log(`  [weather] Failed to save cache: ${err.message}`);
    }
  }

  // Merge new activities into existing index
  for (const activity of newActivities) {
    indexMap.set(activity.id, buildIndexEntry(activity));
  }

  const mergedIndexItems = [...indexMap.values()].sort((a, b) => Date.parse(b.start_date || 0) - Date.parse(a.start_date || 0));
  const mergedFeatures = [...featureMap.values()].sort((a, b) => Date.parse(b.properties?.start_date || 0) - Date.parse(a.properties?.start_date || 0));

  // Validate merged results — data safety
  if (mergedIndexItems.length === 0) {
    throw new Error("SAFETY: Merged index would be empty. Refusing to overwrite S3 outputs.");
  }
  if (mergedFeatures.length === 0 && existingFeatureCount > 0) {
    throw new Error("SAFETY: Merged GeoJSON would have zero features. Refusing to write.");
  }
  if (existingIndexItems.length > 0 && mergedIndexItems.length < existingIndexItems.length) {
    throw new Error(`SAFETY: Merged index (${mergedIndexItems.length}) < existing (${existingIndexItems.length}). Refusing to write.`);
  }

  const mergedIndex = { generated_at: new Date().toISOString(), timezone: TIMEZONE, count: mergedIndexItems.length, items: mergedIndexItems };
  const mergedGeojson = { type: "FeatureCollection", features: mergedFeatures };

  const shoeOverrides = await loadJsonFromS3OrDefault("shoe_overrides.json", {});
  const mergedStats = buildStatsFromIndexItems(mergedIndexItems, TIMEZONE, shoeOverrides);

  const summary = {
    source: "intervals", cutover_date: INTERVALS_CUTOVER_ISO, mode: "incremental",
    existing_index_count: existingIndexItems.length, existing_feature_count: existingFeatureCount,
    activities_returned: rawActivities.length, activities_accepted: acceptedCount,
    excluded_by_type: excludedByType, duplicates_skipped: duplicatesSkipped,
    new_map_features: newMapFeatures, activities_without_map: activitiesWithoutMap,
    detailed_created: detailedCreated, detailed_failed: detailedFailed,
    activities_with_hr: activitiesWithHr, activities_without_hr: activitiesWithoutHr,
    weather_samples_created: weatherSamplesCreated,
    merged_index_count: mergedIndexItems.length, merged_feature_count: mergedFeatures.length,
    dry_run: DRY_RUN, s3_writes: !DRY_RUN,
  };

  logObject("Intervals merge summary", summary);

  if (DRY_RUN) {
    console.log("DRY_RUN=true. Not writing to S3.");
    return { ok: true, dry_run: true, ...summary, would_write: [KEY, INDEX_KEY, STATS_KEY] };
  }

  // Write outputs
  const bytesGeojson = await putJson(KEY, mergedGeojson, "application/geo+json");
  const bytesIndex = await putJson(INDEX_KEY, mergedIndex, "application/json");
  const bytesStats = await putJson(STATS_KEY, mergedStats, "application/json");

  // Update splits state
  const allSplitIds = [...existingSplitIds, ...newSplitIds];
  const updatedSplitsState = { last_run_at: new Date().toISOString(), recent_ids: allSplitIds.slice(-50) };
  await saveSplitsState(updatedSplitsState);

  const result = { ok: true, dry_run: false, ...summary,
    wrote: [{ key: KEY, bytes: bytesGeojson }, { key: INDEX_KEY, bytes: bytesIndex }, { key: STATS_KEY, bytes: bytesStats }],
  };

  logObject("Success", result);
  return result;
}


// --- Test-only exports (tree-shaken in Lambda deployment) ---
export const _test = {
  USE_STRAVA,
  ACTIVITY_SOURCE,
  INTERVALS_CUTOVER_ISO,
  INTERVALS_CUTOVER_MS,
  INTERVALS_INCLUDE_TEST_RUN,
  INTERVALS_TEST_ACTIVITY_ID,
  INTERVALS_TEST_DAY_START,
  normalizeIntervalsType,
  adaptIntervalsActivity,
  buildGeoJsonFeatureFromPoints,
  fetchIntervalsStreams,
  calculateKmSplits,
  isIntervalsDuplicate,
  buildIntervalsSplitsData,
  getIntervalsAfterDate,
  buildIndexEntry,
  buildGeoJsonFeature,
  buildStatsFromIndexItems,
  createIntervalsHttpClient,
  fetchTestRunActivity,
  INTERVALS_TYPE_MAP,
  INCLUDED_TYPES,
};
