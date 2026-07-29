// index.js — Strava -> S3 heatmap exporter
// Incremental mode:
// - Reads existing runs_index.json from S3
// - Finds newest activity start_date already in the bucket
// - Fetches Strava activities since then, with an overlap buffer
// - Merges/dedupes by activity id
// - Writes runs.geojson, runs_index.json, stats.json
// - Fetches per-km splits for new runs and writes splits/{id}.json
// - Maintains splits_state.json to track which runs have splits fetched
//
// Required env vars:
// - BUCKET
//
// Optional env vars:
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
//
// Required SSM parameters:
// - /strava/client_id
// - /strava/secret
// - /strava/refresh
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

      const backoffMs = Math.min(1000 * Math.pow(2, attempt), 8000);

      console.log(
        `Retryable Strava error. url=${url}, status=${status}, attempt=${attempt + 1}, waiting_ms=${backoffMs}`
      );

      await sleep(backoffMs);
    }

    attempt += 1;
  }

  throw lastErr;
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
    has_map: hasPolyline,
    has_splits: run._has_splits || false,
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
    remaining_ms_start: context?.getRemainingTimeInMillis?.() || null,
  });

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
    after_iso: afterUnix
      ? new Date(afterUnix * 1000).toISOString()
      : null,
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
    headers: {
      Authorization: `Bearer ${token.access_token}`,
    },
    timeout: 20000,
  });

  console.log("Testing Strava API with /athlete...");

  const athleteResp = await getWithRetry(http, "/athlete");
  const athlete = athleteResp.data || {};

  logObject("Strava athlete test succeeded", {
    id: athlete.id || null,
    username: athlete.username || null,
    firstname_present: !!athlete.firstname,
    lastname_present: !!athlete.lastname,
  });

  const { allActivities, pagesAttempted } = await fetchActivities(
    http,
    context,
    afterUnix
  );

  const fetchedRuns = allActivities.filter(isIncludedActivity);

  logObject("Strava fetch summary", {
    mode,
    activities_fetched: allActivities.length,
    runs_fetched: fetchedRuns.length,
    pages_attempted: pagesAttempted,
    remaining_ms_after_fetch: context?.getRemainingTimeInMillis?.() || null,
  });

  if (mode === "full" && allActivities.length === 0) {
    throw new Error(
      "Full refresh fetched zero Strava activities. Refusing to overwrite S3 outputs."
    );
  }

  if (mode === "full" && fetchedRuns.length === 0) {
    throw new Error(
      `Full refresh fetched ${allActivities.length} Strava activities, but zero included activities. Refusing to overwrite S3 outputs.`
    );
  }

  if (mode === "incremental" && fetchedRuns.length === 0) {
    console.log("No new run activities found. Regenerating stats with overrides...");

    // Still regenerate stats.json so shoe overrides are applied
    const shoeOverrides = await loadJsonFromS3OrDefault("shoe_overrides.json", {});
    const refreshedStats = buildStatsFromIndexItems(existingIndexItems, TIMEZONE, shoeOverrides);

    if (!DRY_RUN) {
      await putJson(STATS_KEY, refreshedStats, "application/json");
      console.log("Stats regenerated with shoe overrides applied.");
    }

    return {
      ok: true,
      mode,
      dry_run: DRY_RUN,
      no_changes: true,
      stats_regenerated: true,
      athlete_id: athlete.id || null,
      newest_existing_start_date: newestExisting.newestIso,
      activities_fetched: allActivities.length,
      runs_fetched: fetchedRuns.length,
      existing_index_count: existingIndexItems.length,
      existing_feature_count: existingFeatureCount,
    };
  }

  const gearIds = [...new Set(fetchedRuns.map((a) => a.gear_id).filter(Boolean))];
  const gearCache = {};

  console.log(`Fetching gear details for ${gearIds.length} gear ids...`);

  for (const gearId of gearIds) {
    const remainingMs = context?.getRemainingTimeInMillis?.() || 999999;

    if (remainingMs < MIN_MS_LEFT) {
      console.log(
        `Stopping gear lookup because Lambda has only ${remainingMs}ms remaining.`
      );
      break;
    }

    try {
      const gearResp = await getWithRetry(http, `/gear/${gearId}`);
      const gear = gearResp.data || {};

      gearCache[gearId] = {
        id: gear.id || gearId,
        name: gear.name || null,
      };
    } catch (err) {
      console.log(`Could not fetch gear ${gearId}. Continuing with null name.`);

      gearCache[gearId] = {
        id: gearId,
        name: null,
      };
    }
  }

  for (const run of fetchedRuns) {
    run._type = getActivityType(run);

    const gear = run.gear_id ? gearCache[run.gear_id] : null;

    run._gear_name = gear?.name || null;
    run._shoe_name = run._type === "Run" ? gear?.name || null : null;

    run._has_splits = false; // will be set to true after we fetch splits
  }

  const indexMap =
    mode === "full"
      ? new Map()
      : indexItemsToMap(existingIndex);

  const featureMap =
    mode === "full"
      ? new Map()
      : featureCollectionToMap(existingGeojson);

  let newRunsAdded = 0;
  let existingRunsUpdated = 0;
  let newFeaturesAddedOrUpdated = 0;
  let newRunsWithoutMap = 0;

  for (const run of fetchedRuns) {
    const id = String(run.id);

    if (indexMap.has(id)) {
      existingRunsUpdated += 1;
    } else {
      newRunsAdded += 1;
    }

    const indexEntry = buildIndexEntry(run);
    indexMap.set(id, indexEntry);

    const feature = buildGeoJsonFeature(run);

    if (feature) {
      featureMap.set(id, feature);
      newFeaturesAddedOrUpdated += 1;
    } else {
      newRunsWithoutMap += 1;
    }
  }

  const mergedIndexItems = [...indexMap.values()].sort(
    (a, b) => Date.parse(b.start_date || 0) - Date.parse(a.start_date || 0)
  );

  const mergedFeatures = [...featureMap.values()].sort(
    (a, b) =>
      Date.parse(b.properties?.start_date || 0) -
      Date.parse(a.properties?.start_date || 0)
  );

  const mergedIndex = {
    generated_at: new Date().toISOString(),
    timezone: TIMEZONE,
    count: mergedIndexItems.length,
    items: mergedIndexItems,
  };

  const mergedGeojson = {
    type: "FeatureCollection",
    features: mergedFeatures,
  };

  const shoeOverrides = await loadJsonFromS3OrDefault("shoe_overrides.json", {});

  const mergedStats = buildStatsFromIndexItems(mergedIndexItems, TIMEZONE, shoeOverrides);

  logObject("Merge summary", {
    mode,
    fetched_runs: fetchedRuns.length,
    new_runs_added: newRunsAdded,
    existing_runs_updated: existingRunsUpdated,
    new_features_added_or_updated: newFeaturesAddedOrUpdated,
    new_runs_without_map: newRunsWithoutMap,
    merged_index_count: mergedIndexItems.length,
    merged_feature_count: mergedFeatures.length,
    dry_run: DRY_RUN,
  });

  if (mergedIndexItems.length === 0) {
    throw new Error("Merged index would be empty. Refusing to overwrite S3 outputs.");
  }

  if (mergedFeatures.length === 0) {
    throw new Error("Merged GeoJSON would be empty. Refusing to overwrite S3 outputs.");
  }

  if (DRY_RUN) {
    console.log("DRY_RUN=true. Not writing to S3.");

    return {
      ok: true,
      dry_run: true,
      mode,
      athlete_id: athlete.id || null,
      newest_existing_start_date: newestExisting.newestIso,
      activities_fetched: allActivities.length,
      runs_fetched: fetchedRuns.length,
      new_runs_added: newRunsAdded,
      existing_runs_updated: existingRunsUpdated,
      merged_index_count: mergedIndexItems.length,
      merged_feature_count: mergedFeatures.length,
      would_write: [KEY, INDEX_KEY, STATS_KEY],
    };
  }

  // ---------- Fetch splits BEFORE writing index so has_splits is correct on first write ----------
  const splitsState = await loadSplitsState();

  const splitsAfterMs = splitsState.last_run_at
    ? Date.parse(splitsState.last_run_at)
    : Date.now() - (7 * 24 * 60 * 60 * 1000); // default to 7 days ago if no state

  const allRunIds = mergedIndexItems
    .filter((item) => {
      if (!item.distance || item.distance <= 500) return false;
      if (item.type !== "Run") return false; // only fetch splits for runs
      const startMs = Date.parse(item.start_date || 0);
      return startMs > splitsAfterMs;
    })
    .map((item) => String(item.id));

  console.log(`Splits: found ${allRunIds.length} runs newer than ${new Date(splitsAfterMs).toISOString()}`);

  const splitsResult = await fetchAndStoreSplits(http, context, allRunIds, splitsState);

  logObject("Splits fetch summary", splitsResult);

  // Mark has_splits directly from the IDs we just fetched (no extra S3 read)
  const newlyFetchedIds = splitsResult.fetchedIds;
  for (const item of mergedIndexItems) {
    if (newlyFetchedIds.has(String(item.id))) {
      item.has_splits = true;
    }
  }

  // Write all files once with correct has_splits flags
  mergedIndex.items = mergedIndexItems;

  const bytesGeojson = await putJson(KEY, mergedGeojson, "application/geo+json");
  const bytesIndex = await putJson(INDEX_KEY, mergedIndex, "application/json");
  const bytesStats = await putJson(STATS_KEY, mergedStats, "application/json");

  const result = {
    ok: true,
    dry_run: false,
    mode,
    athlete_id: athlete.id || null,
    newest_existing_start_date: newestExisting.newestIso,
    pages_attempted: pagesAttempted,
    activities_fetched: allActivities.length,
    runs_fetched: fetchedRuns.length,
    new_runs_added: newRunsAdded,
    existing_runs_updated: existingRunsUpdated,
    merged_index_count: mergedIndexItems.length,
    merged_feature_count: mergedFeatures.length,
    gear_ids: gearIds.length,
    cache_size: Object.keys(cache).length,
    splits: splitsResult,
    wrote: [
      {
        key: KEY,
        bytes: bytesGeojson,
      },
      {
        key: INDEX_KEY,
        bytes: bytesIndex,
      },
      {
        key: STATS_KEY,
        bytes: bytesStats,
      },
    ],
  };

  logObject("Success", result);

  return result;
};
