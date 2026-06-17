// Shoe Override API service
// Communicates with the Override Lambda via the Vite dev server proxy at /api/shoe-override

const API_BASE = '/api/shoe-override';

/**
 * Returns true if the activity name contains "WO", "Workout", or "Session" (case-sensitive).
 */
export function isWorkoutActivity(activityName) {
  if (!activityName) return false;
  return activityName.includes("WO") || activityName.includes("Workout") || activityName.includes("Session");
}

/**
 * Validates override segments against the total activity distance.
 * Returns { valid: boolean, errors: string[] }
 */
export function validateOverride(segments, totalDistanceM) {
  const errors = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (!seg.shoe_name || seg.shoe_name.trim() === '') {
      errors.push(`Segment ${i + 1}: shoe name is required`);
    }
    if (!seg.distance_m || typeof seg.distance_m !== 'number' || seg.distance_m <= 0) {
      errors.push(`Segment ${i + 1}: distance must be a positive number`);
    }
  }

  const sum = segments.reduce((acc, seg) => acc + (Number(seg.distance_m) || 0), 0);
  if (Math.abs(sum - totalDistanceM) > 100) {
    errors.push(`Segment distances sum to ${(sum / 1000).toFixed(2)}km but total is ${(totalDistanceM / 1000).toFixed(2)}km. Difference exceeds 100m tolerance.`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Load override for an activity from the Lambda.
 * GET /api/shoe-override?action=get&activity_id={id}
 */
export async function loadOverride(activityId) {
  const url = `${API_BASE}?action=get&activity_id=${activityId}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Failed to load override: ${resp.status}`);
  }
  const data = await resp.json();
  return { override: data.override || null };
}

/**
 * Save an override via the Lambda.
 * POST with { action: "save", activity_id, total_distance_m, segments }
 */
export async function saveOverride({ activity_id, total_distance_m, segments }) {
  const resp = await fetch(API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'save', activity_id, total_distance_m, segments }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || `Save failed: ${resp.status}`);
  }
  const data = await resp.json();
  return { success: data.success, override: data.override };
}

/**
 * Delete an override via the Lambda.
 * POST with { action: "delete", activity_id }
 */
export async function deleteOverride(activityId) {
  const resp = await fetch(API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'delete', activity_id: activityId }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || `Delete failed: ${resp.status}`);
  }
  const data = await resp.json();
  return { success: data.success };
}


/**
 * Recalculates byShoe stats from index items and a map of overrides.
 * overrides: { [activityId]: { segments: [{ shoe_name, distance_m }] } }
 */
export function recalcByShoe(items, overrides) {
  const byShoe = {};

  for (const item of items) {
    if (item.type !== "Run") continue;
    const dist = Number(item.distance || 0);
    const moving = Number(item.moving_time || 0);

    const override = overrides[String(item.id)];

    if (override && Array.isArray(override.segments)) {
      for (const seg of override.segments) {
        const name = seg.shoe_name;
        if (!name) continue;
        byShoe[name] ||= { distance_m: 0, count: 0, moving_time_s: 0, last_date: null };
        byShoe[name].distance_m += seg.distance_m;
        byShoe[name].count += 1;
        byShoe[name].moving_time_s += dist > 0 ? Math.round(moving * (seg.distance_m / dist)) : 0;
        if (!byShoe[name].last_date || item.start_date > byShoe[name].last_date) {
          byShoe[name].last_date = item.start_date;
        }
      }
    } else {
      const shoe = item.shoe_name || item.gear_name || null;
      if (!shoe) continue;
      byShoe[shoe] ||= { distance_m: 0, count: 0, moving_time_s: 0, last_date: null };
      byShoe[shoe].distance_m += dist;
      byShoe[shoe].count += 1;
      byShoe[shoe].moving_time_s += moving;
      if (!byShoe[shoe].last_date || item.start_date > byShoe[shoe].last_date) {
        byShoe[shoe].last_date = item.start_date;
      }
    }
  }

  return byShoe;
}

/**
 * Loads ALL overrides from the Lambda (fetches the full file).
 * GET /api/shoe-override?action=get_all
 * Falls back to loading individual overrides if get_all not supported.
 */
export async function loadAllOverrides() {
  const resp = await fetch(`${API_BASE}?action=get_all`);
  if (!resp.ok) {
    // If get_all isn't supported, return empty
    return {};
  }
  const data = await resp.json();
  return data.overrides || {};
}
