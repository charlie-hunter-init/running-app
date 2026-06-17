# Implementation Plan

## Overview

Implement the workout shoe override feature across three layers: frontend API service + utility functions, React editor component integrated into BreakDownView, and Strava Sync Lambda modification to apply overrides to shoe statistics. Property-based tests validate core logic correctness.

## Tasks

- [ ] 1. Create `src/lib/shoeOverrideApi.js` with `SHOE_OVERRIDE_LAMBDA_URL` constant reading from `import.meta.env.VITE_SHOE_OVERRIDE_URL`
- [ ] 2. Implement `isWorkoutActivity(activityName)` function in `src/lib/shoeOverrideApi.js` that returns true if name contains "WO", "Workout", or "Session" (case-sensitive)
- [ ] 3. Implement `validateOverride(segments, totalDistanceM)` function in `src/lib/shoeOverrideApi.js` that checks: non-empty shoe names, positive distances not exceeding total, sum within 100m tolerance; returns `{ valid, errors }`
- [ ] 4. Implement `loadOverride(activityId)` async function in `src/lib/shoeOverrideApi.js` that calls GET on Lambda function URL with `?action=get&activity_id={id}`
- [ ] 5. Implement `saveOverride({ activity_id, total_distance_m, segments })` async function in `src/lib/shoeOverrideApi.js` that POSTs to Lambda function URL with action "save"
- [ ] 6. Implement `deleteOverride(activityId)` async function in `src/lib/shoeOverrideApi.js` that POSTs to Lambda function URL with action "delete"
- [ ] 7. Create `src/components/breakdown/ShoeOverrideEditor.jsx` with props: activityId, activityName, totalDistanceM, stravaShoe; implement state for segments (2 entries), loading, saving, errors, success, and existingOverride flag
- [ ] 8. Implement useEffect in ShoeOverrideEditor to call `loadOverride(activityId)` on mount and populate segments from response or compute defaults (segment 1 = strava shoe with full distance, segment 2 = empty with 0; if no stravaShoe both empty)
- [ ] 9. Render ShoeOverrideEditor UI: total distance display in km (2dp), two segment rows (shoe name input, gear_id input, distance km input), save button, delete button (shown only when override exists with confirmation prompt)
- [ ] 10. Implement validation and save flow in ShoeOverrideEditor: on save click validate with `validateOverride`, show inline errors if invalid, call `saveOverride` with distances in metres if valid, show success/error feedback
- [ ] 11. Style ShoeOverrideEditor to match existing BreakDownView dark theme using inline styles consistent with existing patterns
- [ ] 12. Integrate ShoeOverrideEditor into BreakDownView.jsx: import component and `isWorkoutActivity`, conditionally render below stats row when `isWorkoutActivity(selectedItem.name)` is true, pass props (activityId, activityName, totalDistanceM, stravaShoe from selectedItem), use `key={selectedId}` for remounting
- [ ] 13. Add `OVERRIDES_KEY` constant (`shoe_overrides.json`) to `lambda/index.js` config section and load overrides using existing `loadJsonFromS3OrDefault(OVERRIDES_KEY, {})` before stats calculation
- [ ] 14. Modify `buildStatsFromIndexItems` in `lambda/index.js` to accept overrides parameter; for overridden activities attribute each segment's distance_m to its shoe_name, increment run count per shoe, allocate moving_time proportionally by distance ratio
- [ ] 15. Ensure Strava Sync Lambda reads shoe_overrides.json as read-only (no PutObject/DeleteObject calls on that key) and handles missing file gracefully with empty overrides
- [ ] 16. Install `fast-check` as a dev dependency and write property test for `isWorkoutActivity` (Property 1: generate random strings with/without trigger substrings, verify detection)
- [ ] 17. Write property test for `validateOverride` distance sum tolerance (Property 3: generate random totals and segment distances, verify acceptance/rejection at 100m boundary)
- [ ] 18. Write property test for `validateOverride` segment field validation (Property 4: generate invalid shoe names and distances, verify rejection)
- [ ] 19. Write property test for Override Lambda data model integrity (Property 5: generate valid inputs, run through handler with mocked S3, verify output schema)
- [ ] 20. Write property test for created_at preservation on update (Property 6: generate existing overrides, save updates, verify timestamps)
- [ ] 21. Write property test for stats attribution (Property 7: generate activities and overrides, verify per-shoe distance/count and total distance conservation)
- [ ] 22. Write unit tests for `isWorkoutActivity` with specific examples and edge cases
- [ ] 23. Write unit tests for `validateOverride` edge cases: exact tolerance boundary, empty shoe, zero/negative distance
- [ ] 24. Write integration tests for modified `buildStatsFromIndexItems` with override data
- [ ] 25. Add `VITE_SHOE_OVERRIDE_URL` environment variable documentation and `.env.example` entry

## Task Dependency Graph

```json
{
  "waves": [
    [1, 13],
    [2, 3, 4, 5, 6, 25],
    [7, 14, 15, 16, 22],
    [8, 9, 10, 11, 17, 18, 23],
    [12, 19, 20, 21, 24]
  ]
}
```

## Notes

- The Override Lambda (`lambda-shoes/index.js`) is already deployed and functional — no code changes needed there.
- The Lambda function URL is: the URL for `arn:aws:lambda:ap-southeast-2:598945436007:function:shoe-update`
- Property tests use `fast-check` library with minimum 100 iterations each.
- The frontend uses inline styles (no CSS modules or Tailwind) to match existing BreakDownView patterns.
- Distances are stored in metres in the override data but displayed as km in the frontend editor.
