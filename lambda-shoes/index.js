// index.js — Shoe Override Lambda
// Manages CRUD operations for shoe_overrides.json in S3.
// This Lambda does NOT fetch activities from Strava.
//
// Required env vars:
// - BUCKET
//
// Optional env vars:
// - OVERRIDES_KEY=shoe_overrides.json
//
// Endpoints (via API Gateway or function URL):
// - GET    ?action=get&activity_id={id}   — Load override for a specific activity
// - POST   body: { action: "save", ... }  — Save/update an override
// - POST   body: { action: "delete", activity_id: "..." } — Delete an override

import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";

const REGION =
  process.env.AWS_REGION ||
  process.env.AWS_DEFAULT_REGION ||
  "ap-southeast-2";

const BUCKET = process.env.BUCKET;
const OVERRIDES_KEY = process.env.OVERRIDES_KEY || "shoe_overrides.json";

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

async function loadOverrides() {
  try {
    const resp = await s3.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: OVERRIDES_KEY })
    );
    const body = await streamToString(resp.Body);
    return JSON.parse(body);
  } catch (err) {
    if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) {
      return {};
    }
    throw err;
  }
}

async function saveOverrides(data) {
  const json = JSON.stringify(data, null, 2);
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: OVERRIDES_KEY,
      Body: json,
      ContentType: "application/json",
    })
  );
}

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
    body: JSON.stringify(body),
  };
}

// --- Handlers ---

async function handleGetAll() {
  const overrides = await loadOverrides();
  return response(200, { overrides });
}

async function handleGet(activityId) {
  if (!activityId) {
    return response(400, { error: "activity_id is required" });
  }

  const overrides = await loadOverrides();
  const entry = overrides[String(activityId)] || null;

  return response(200, { activity_id: activityId, override: entry });
}

async function handleSave(body) {
  const { activity_id, total_distance_m, segments } = body;

  if (!activity_id) {
    return response(400, { error: "activity_id is required" });
  }
  if (!total_distance_m || typeof total_distance_m !== "number") {
    return response(400, { error: "total_distance_m must be a positive number" });
  }
  if (!Array.isArray(segments) || segments.length < 2) {
    return response(400, { error: "segments must be an array with at least 2 entries" });
  }

  // Validate each segment
  for (const seg of segments) {
    if (!seg.shoe_name || typeof seg.shoe_name !== "string") {
      return response(400, { error: "Each segment must have a non-empty shoe_name" });
    }
    if (!seg.distance_m || typeof seg.distance_m !== "number" || seg.distance_m <= 0) {
      return response(400, { error: "Each segment must have a distance_m greater than 0" });
    }
  }

  // Validate sum of segments equals total (tolerance: 100m = 0.1km)
  const segmentSum = segments.reduce((sum, seg) => sum + seg.distance_m, 0);
  if (Math.abs(segmentSum - total_distance_m) > 100) {
    return response(400, {
      error: `Segment distances sum to ${segmentSum}m but total is ${total_distance_m}m. Difference exceeds 100m tolerance.`,
    });
  }

  const overrides = await loadOverrides();
  const now = new Date().toISOString();
  const key = String(activity_id);

  overrides[key] = {
    activity_id: key,
    total_distance_m,
    segments: segments.map((seg) => ({
      shoe_name: seg.shoe_name,
      gear_id: seg.gear_id || null,
      distance_m: seg.distance_m,
    })),
    created_at: overrides[key]?.created_at || now,
    updated_at: now,
  };

  await saveOverrides(overrides);

  return response(200, { success: true, override: overrides[key] });
}

async function handleDelete(activityId) {
  if (!activityId) {
    return response(400, { error: "activity_id is required" });
  }

  const overrides = await loadOverrides();
  const key = String(activityId);

  if (!overrides[key]) {
    return response(404, { error: "No override found for this activity" });
  }

  delete overrides[key];
  await saveOverrides(overrides);

  return response(200, { success: true, deleted: activityId });
}

// --- Main handler ---

export const handler = async (event) => {
  if (!BUCKET) {
    return response(500, { error: "BUCKET environment variable not set" });
  }

  // Handle CORS preflight
  if (event.httpMethod === "OPTIONS" || event.requestContext?.http?.method === "OPTIONS") {
    return response(200, {});
  }

  try {
    // Support both API Gateway and Function URL event formats
    const method =
      event.httpMethod || event.requestContext?.http?.method || "GET";
    const queryParams = event.queryStringParameters || {};

    if (method === "GET") {
      const action = queryParams.action || "get";
      const activityId = queryParams.activity_id;

      if (action === "get_all") {
        return await handleGetAll();
      }

      if (action === "get") {
        return await handleGet(activityId);
      }

      return response(400, { error: `Unknown GET action: ${action}` });
    }

    if (method === "POST") {
      const body =
        typeof event.body === "string" ? JSON.parse(event.body) : event.body || {};

      const action = body.action;

      if (action === "save") {
        return await handleSave(body);
      }

      if (action === "delete") {
        return await handleDelete(body.activity_id);
      }

      return response(400, { error: `Unknown POST action: ${action}` });
    }

    return response(405, { error: `Method ${method} not allowed` });
  } catch (err) {
    console.error("Unhandled error:", err);
    return response(500, { error: err.message || "Internal server error" });
  }
};
