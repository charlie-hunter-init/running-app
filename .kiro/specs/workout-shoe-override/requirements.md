# Requirements Document

## Introduction

This feature allows overriding shoe attribution data for workout activities where multiple shoes are used during a single recorded activity. When a coach records warm-up, workout, and warm-down as one Strava activity, the user can split the distance between shoes so that shoe KM tracking remains accurate. Overrides are stored as a single `shoe_overrides.json` file in S3, keyed by activity ID. The existing Strava data sync Lambda applies these overrides when generating shoe statistics, while a separate Override Lambda handles CRUD operations on the override data.

## Glossary

- **Override_Lambda**: A Lambda function responsible exclusively for managing shoe override data (GET, SAVE/UPDATE, DELETE). It does not fetch activities from Strava.
- **Strava_Sync_Lambda**: The existing Lambda function that fetches activities from Strava, generates runs_index.json, stats.json, and shoe statistics. It reads shoe_overrides.json and applies overrides during stats calculation.
- **Breakdown_Page**: The frontend activity detail view that displays splits, pace charts, and activity metadata
- **Shoe_Override**: A JSON object specifying how an activity's distance is split between multiple shoes, replacing the default Strava attribution
- **Shoe_Overrides_File**: A single JSON file stored at the S3 key `shoe_overrides.json`, containing all overrides keyed by activity ID
- **Activity**: A single run recorded in Strava, identified by a numeric activity ID
- **Segment**: A portion of an activity attributed to a specific shoe, defined by a shoe identifier and distance in metres
- **Gear_ID**: The Strava-assigned identifier for a piece of gear (e.g., "g28984775"), used to reliably reference a shoe
- **Workout_Activity**: An activity whose name contains "WO", "Workout", or "Session" (case-sensitive match)
- **Stats_Calculator**: The component within the Strava_Sync_Lambda that computes per-shoe distance totals and run counts

## Requirements

### Requirement 1: Display Shoe Override Editor on Breakdown Page

**User Story:** As a runner, I want to see and edit shoe attribution for workout activities on the breakdown page, so that I can correct the distance split between my shoes.

#### Acceptance Criteria

1. WHEN an activity whose name contains "WO", "Workout", or "Session" (case-sensitive) is selected on the Breakdown_Page, THE Breakdown_Page SHALL display a shoe override editor section
2. THE Shoe_Override editor SHALL display the total activity distance in kilometres rounded to two decimal places
3. THE Shoe_Override editor SHALL provide input fields for two Segments, each with an editable shoe name, an optional gear_id text field, and an editable attributed distance in kilometres rounded to two decimal places
4. WHEN no Shoe_Override exists for the selected activity and the activity has a Strava-assigned shoe, THE Breakdown_Page SHALL default the first Segment to the Strava-assigned shoe name and gear_id with the full activity distance, and the second Segment to an empty shoe name, empty gear_id, and a distance value of zero
5. IF no Shoe_Override exists for the selected activity and the activity has no Strava-assigned shoe (gear_id is null), THEN THE Breakdown_Page SHALL default both Segments to an empty shoe name, empty gear_id, and a distance value of zero
6. WHEN a Shoe_Override already exists for the selected activity, THE Breakdown_Page SHALL populate the editor fields with the stored Segment values

### Requirement 2: Validate Shoe Override Input

**User Story:** As a runner, I want the override editor to validate my inputs, so that I do not accidentally enter incorrect data.

#### Acceptance Criteria

1. WHEN the user attempts to save a Shoe_Override, THE Shoe_Override editor SHALL validate that the sum of all Segment distances equals the total activity distance with a tolerance of 0.1 km
2. IF the Segment distance sum does not equal the total activity distance within tolerance, THEN THE Shoe_Override editor SHALL display a validation error indicating the mismatch and prevent saving
3. IF any Segment has an empty shoe name when the user attempts to save, THEN THE Shoe_Override editor SHALL display a validation error identifying the Segment with the missing shoe name and prevent saving
4. IF any Segment distance is not a numeric value, is zero, is negative, or exceeds the total activity distance, THEN THE Shoe_Override editor SHALL display a validation error identifying the invalid Segment distance and prevent saving
5. WHEN all validation checks pass, THE Shoe_Override editor SHALL enable saving and remove any previously displayed validation errors

### Requirement 3: Shoe Override Data Model

**User Story:** As a runner, I want the override data structure to support multiple shoe segments, so that the system can accommodate complex workouts.

#### Acceptance Criteria

1. THE Shoe_Overrides_File SHALL be a single JSON file stored at the S3 key `shoe_overrides.json`
2. THE Shoe_Overrides_File SHALL contain a JSON object keyed by activity ID (as a string), where the activity_id field within each entry matches its corresponding object key
3. Each override entry SHALL contain: activity_id (string), total_distance_m (numeric, greater than zero), a segments array, created_at timestamp (ISO 8601 format), and updated_at timestamp (ISO 8601 format)
4. Each Segment in the segments array SHALL contain: shoe_name (non-empty string, maximum 100 characters), gear_id (string or null if unknown), and distance_m (numeric, greater than zero)
5. THE segments array SHALL contain a minimum of 2 and a maximum of 10 Segment entries

### Requirement 4: Override Lambda — Save Override

**User Story:** As a runner, I want my shoe overrides saved persistently, so that the data is available across sessions and used for statistics.

#### Acceptance Criteria

1. WHEN the user submits a valid Shoe_Override, THE Override_Lambda SHALL load the existing Shoe_Overrides_File from S3; IF the file does not yet exist, THEN THE Override_Lambda SHALL proceed with an empty object as the base data
2. WHEN the Shoe_Overrides_File is loaded, THE Override_Lambda SHALL insert the override entry keyed by the activity ID if no entry exists, or replace the existing entry for that activity ID while preserving the original created_at timestamp and setting updated_at to the current time
3. WHEN the entry has been inserted or replaced, THE Override_Lambda SHALL write the updated Shoe_Overrides_File back to S3 at the key `shoe_overrides.json`
4. WHEN the save succeeds, THE Override_Lambda SHALL return a success response containing the saved override entry, and THE Breakdown_Page SHALL display a visible success confirmation to the user
5. IF the Override_Lambda fails to load the existing file from S3 or fails to write the updated file back to S3, THEN THE Override_Lambda SHALL return an error response, and THE Breakdown_Page SHALL display an error message indicating the save operation failed

### Requirement 5: Override Lambda — Load Override

**User Story:** As a runner, I want to see my previously saved overrides when I revisit an activity, so that I can review or update them.

#### Acceptance Criteria

1. WHEN a Workout_Activity is selected on the Breakdown_Page, THE Override_Lambda SHALL retrieve the Shoe_Overrides_File from S3 using the activity ID as the lookup key
2. WHEN an override entry exists for the requested activity ID, THE Override_Lambda SHALL return that entry including activity_id, total_distance_m, segments array, created_at, and updated_at fields to the Breakdown_Page
3. WHEN no override entry exists for the requested activity ID, THE Override_Lambda SHALL return a response with a null override field indicating no override is present
4. IF the Shoe_Overrides_File does not exist in S3, THEN THE Override_Lambda SHALL treat this as an empty overrides collection and return a null override field for the requested activity
5. IF the Override_Lambda encounters an error reading or parsing the Shoe_Overrides_File, THEN THE Breakdown_Page SHALL fall back to showing Strava default shoe attribution and display a visible warning message indicating the override could not be loaded

### Requirement 6: Override Lambda — Delete Override

**User Story:** As a runner, I want to remove an override and revert to Strava defaults, so that I can undo an incorrect override.

#### Acceptance Criteria

1. WHEN a Shoe_Override exists for the selected activity, THE Breakdown_Page SHALL display a delete option
2. WHEN the user activates the delete option, THE Breakdown_Page SHALL present a confirmation prompt before sending the delete request to the Override_Lambda
3. WHEN the user confirms deletion, THE Override_Lambda SHALL load the Shoe_Overrides_File, remove the entry for the specified activity ID, and write the updated file back to S3
4. IF the specified activity ID does not exist in the Shoe_Overrides_File at the time of deletion, THEN THE Override_Lambda SHALL return a not-found error response to the Breakdown_Page
5. WHEN deletion succeeds, THE Breakdown_Page SHALL reset the editor to show the Strava-assigned shoe with the full activity distance in the first Segment and empty fields in the second Segment
6. IF the Override_Lambda fails to delete, THEN THE Breakdown_Page SHALL display an error message indicating the deletion failed and SHALL retain the existing override values in the editor

### Requirement 7: Strava Sync Lambda Applies Overrides to Shoe Statistics

**User Story:** As a runner, I want the Strava data refresh process to use my overrides when calculating shoe stats, so that my total KMs per shoe are accurate.

#### Acceptance Criteria

1. THE Strava_Sync_Lambda SHALL load shoe_overrides.json from S3 before calculating shoe statistics
2. IF the shoe_overrides.json file does not exist in S3, THEN THE Strava_Sync_Lambda SHALL proceed with an empty overrides collection and calculate statistics using only Strava-assigned data
3. THE Strava_Sync_Lambda SHALL apply matching overrides after fetching activities from Strava but before writing stats.json or any shoe statistics output
4. WHEN a Shoe_Override exists for an activity, THE Stats_Calculator SHALL ignore the Strava-assigned gear attribution for that activity and use the override Segments instead
5. WHEN a Shoe_Override splits an activity into Segments, THE Stats_Calculator SHALL attribute each Segment's distance_m to its respective shoe identified by shoe_name
6. WHEN a Shoe_Override splits an activity into Segments, THE Stats_Calculator SHALL increment the run count by one for each shoe referenced in the Segments
7. WHEN no Shoe_Override exists for an activity, THE Stats_Calculator SHALL use the Strava-assigned shoe and full activity distance
8. THE Strava_Sync_Lambda SHALL NOT delete, overwrite, or reset the shoe_overrides.json file during operation

### Requirement 8: Override Lambda Isolation

**User Story:** As a runner, I want the override system to be independent from the Strava refresh process, so that my manual corrections are never lost.

#### Acceptance Criteria

1. THE Override_Lambda SHALL NOT make any HTTP requests to the Strava API
2. THE Override_Lambda SHALL only perform read, write, and delete operations on the Shoe_Overrides_File in S3
3. THE Shoe_Overrides_File SHALL persist independently of Strava data refresh cycles; a Strava_Sync_Lambda invocation SHALL NOT alter the content of shoe_overrides.json
4. WHEN the Strava_Sync_Lambda runs, THE Strava_Sync_Lambda SHALL read shoe_overrides.json as a read-only input and SHALL NOT modify, delete, or overwrite its contents
