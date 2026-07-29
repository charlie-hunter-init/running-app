// index.js — Workout Notes Lambda (ESM)
// Manages CRUD operations for workout_notes.json in S3.
// Single JSON file keyed by activity ID containing: description, mood, warm_up_km, warm_down_km
//
// Deploy as index.mjs with handler: index.handler
//
// Endpoints:
// - GET  ?action=get&activity_id={id}  — Load note for a specific activity
// - GET  ?action=get_all               — Load all notes
// - POST body: { action: "save", ... } — Save/update a note
// - POST body: { action: "delete", activity_id: "..." } — Delete a note

import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";

const REGION = process.env.AWS_REGION || "ap-southeast-2";
const BUCKET = "runningheatmapbycharlie.com";
const NOTES_KEY = "workout_notes.json";

const s3 = new S3Client({ region: REGION });

// --- Helpers ---

async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

async function loadNotes() {
  try {
    const resp = await s3.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: NOTES_KEY })
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

async function saveNotes(data) {
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: NOTES_KEY,
      Body: JSON.stringify(data, null, 2),
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
  const notes = await loadNotes();
  return response(200, { notes });
}

async function handleGet(activityId) {
  if (!activityId) {
    return response(400, { error: "activity_id is required" });
  }
  const notes = await loadNotes();
  const entry = notes[String(activityId)] || null;
  return response(200, { activity_id: activityId, note: entry });
}

async function handleSave(body) {
  const { activity_id, description, mood, warm_up_km, warm_down_km } = body;

  if (!activity_id) {
    return response(400, { error: "activity_id is required" });
  }

  const notes = await loadNotes();
  const now = new Date().toISOString();
  const key = String(activity_id);

  notes[key] = {
    activity_id: key,
    description: description || "",
    mood: mood || null, // 1-5
    warm_up_km: warm_up_km || null,
    warm_down_km: warm_down_km || null,
    created_at: notes[key]?.created_at || now,
    updated_at: now,
  };

  await saveNotes(notes);
  return response(200, { success: true, note: notes[key] });
}

async function handleDelete(activityId) {
  if (!activityId) {
    return response(400, { error: "activity_id is required" });
  }

  const notes = await loadNotes();
  const key = String(activityId);

  if (!notes[key]) {
    return response(404, { error: "No note found for this activity" });
  }

  delete notes[key];
  await saveNotes(notes);
  return response(200, { success: true, deleted: activityId });
}

// --- Main handler ---

export const handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === "OPTIONS" || event.requestContext?.http?.method === "OPTIONS") {
    return response(200, {});
  }

  try {
    const method = event.httpMethod || event.requestContext?.http?.method || "GET";
    const queryParams = event.queryStringParameters || {};

    if (method === "GET") {
      const action = queryParams.action || "get";
      if (action === "get_all") return await handleGetAll();
      if (action === "get") return await handleGet(queryParams.activity_id);
      return response(400, { error: `Unknown GET action: ${action}` });
    }

    if (method === "POST") {
      const body = typeof event.body === "string" ? JSON.parse(event.body) : event.body || {};
      const action = body.action;
      if (action === "save") return await handleSave(body);
      if (action === "delete") return await handleDelete(body.activity_id);
      return response(400, { error: `Unknown POST action: ${action}` });
    }

    return response(405, { error: `Method ${method} not allowed` });
  } catch (err) {
    console.error("Unhandled error:", err);
    return response(500, { error: err.message || "Internal server error" });
  }
};
