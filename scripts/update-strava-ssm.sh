#!/usr/bin/env bash
set -euo pipefail

REGION="${AWS_REGION:-ap-southeast-2}"

echo "Updating Strava SSM parameters in region: $REGION"
echo

read -rp "Enter Strava client_id: " STRAVA_CLIENT_ID
read -rsp "Enter Strava client_secret: " STRAVA_CLIENT_SECRET
echo
read -rsp "Enter Strava refresh_token: " STRAVA_REFRESH_TOKEN
echo
echo

echo "Writing /strava/client_id..."
aws ssm put-parameter \
  --name "/strava/client_id" \
  --type "SecureString" \
  --value "$STRAVA_CLIENT_ID" \
  --overwrite \
  --region "$REGION"

echo "Writing /strava/secret..."
aws ssm put-parameter \
  --name "/strava/secret" \
  --type "SecureString" \
  --value "$STRAVA_CLIENT_SECRET" \
  --overwrite \
  --region "$REGION"

echo "Writing /strava/refresh..."
aws ssm put-parameter \
  --name "/strava/refresh" \
  --type "SecureString" \
  --value "$STRAVA_REFRESH_TOKEN" \
  --overwrite \
  --region "$REGION"

echo
echo "Done. Strava SSM parameters updated."
echo
echo "Testing Strava refresh token exchange..."

TOKEN_RESPONSE=$(curl -sS -X POST "https://www.strava.com/api/v3/oauth/token" \
  -d client_id="$STRAVA_CLIENT_ID" \
  -d client_secret="$STRAVA_CLIENT_SECRET" \
  -d grant_type="refresh_token" \
  -d refresh_token="$STRAVA_REFRESH_TOKEN")

ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.access_token // empty')
NEW_REFRESH_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.refresh_token // empty')
EXPIRES_AT=$(echo "$TOKEN_RESPONSE" | jq -r '.expires_at // empty')

if [[ -z "$ACCESS_TOKEN" ]]; then
  echo "Strava token exchange failed."
  echo "$TOKEN_RESPONSE"
  exit 1
fi

echo "Strava token exchange succeeded."
echo "Access token expires_at: $EXPIRES_AT"

if [[ -n "$NEW_REFRESH_TOKEN" && "$NEW_REFRESH_TOKEN" != "$STRAVA_REFRESH_TOKEN" ]]; then
  echo
  echo "Strava returned a new refresh token. Updating /strava/refresh again..."

  aws ssm put-parameter \
    --name "/strava/refresh" \
    --type "SecureString" \
    --value "$NEW_REFRESH_TOKEN" \
    --overwrite \
    --region "$REGION"

  echo "Updated /strava/refresh with the latest refresh token."
fi

echo
echo "Testing /athlete endpoint..."

ATHLETE_RESPONSE=$(curl -sS -H "Authorization: Bearer $ACCESS_TOKEN" \
  "https://www.strava.com/api/v3/athlete")

ATHLETE_ID=$(echo "$ATHLETE_RESPONSE" | jq -r '.id // empty')

if [[ -z "$ATHLETE_ID" ]]; then
  echo "/athlete test failed."
  echo "$ATHLETE_RESPONSE"
  exit 1
fi

echo "/athlete test succeeded. Athlete ID: $ATHLETE_ID"

echo
echo "Testing /athlete/activities endpoint..."

ACTIVITIES_STATUS=$(curl -sS -o /tmp/strava_activities_test.json -w "%{http_code}" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  "https://www.strava.com/api/v3/athlete/activities?page=1&per_page=1")

if [[ "$ACTIVITIES_STATUS" != "200" ]]; then
  echo "/athlete/activities test failed. HTTP status: $ACTIVITIES_STATUS"
  cat /tmp/strava_activities_test.json
  echo
  exit 1
fi

echo "/athlete/activities test succeeded."
echo
echo "All good. You can rerun the Lambda now."
