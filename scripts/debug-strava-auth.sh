#!/usr/bin/env bash
set -euo pipefail

REGION="${AWS_REGION:-ap-southeast-2}"

CLIENT_ID_PARAM="${CLIENT_ID_PARAM:-/strava/client_id}"
CLIENT_SECRET_PARAM="${CLIENT_SECRET_PARAM:-/strava/secret}"
REFRESH_TOKEN_PARAM="${REFRESH_TOKEN_PARAM:-/strava/refresh}"

echo "Debugging Strava auth using SSM Parameter Store"
echo "Region: $REGION"
echo

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1"
    echo "Install it and rerun this script."
    exit 1
  fi
}

require_command aws
require_command curl
require_command jq

print_json_debug() {
  local label="$1"
  local file="$2"

  echo
  echo "----- $label raw response -----"
  cat "$file"
  echo
  echo

  echo "----- $label pretty response -----"
  if jq empty "$file" 2>/dev/null; then
    jq '.' "$file"

    local message
    message=$(jq -r '.message // empty' "$file")

    if [[ -n "$message" ]]; then
      echo
      echo "Message: $message"
    fi

    local errors_count
    errors_count=$(jq '.errors // [] | length' "$file")

    if [[ "$errors_count" != "0" ]]; then
      echo
      echo "Decoded errors:"
      jq -r '.errors[] | "- resource=\(.resource // "unknown"), field=\(.field // "unknown"), code=\(.code // "unknown")"' "$file"
    fi
  else
    echo "Response was not valid JSON."
  fi

  echo "--------------------------------"
  echo
}

echo "Reading Strava values from SSM..."

SSM_RESPONSE="/tmp/strava_ssm_params.json"

aws ssm get-parameters \
  --names "$CLIENT_ID_PARAM" "$CLIENT_SECRET_PARAM" "$REFRESH_TOKEN_PARAM" \
  --with-decryption \
  --region "$REGION" > "$SSM_RESPONSE"

MISSING_COUNT=$(jq '.InvalidParameters | length' "$SSM_RESPONSE")

if [[ "$MISSING_COUNT" != "0" ]]; then
  echo "Missing SSM parameters:"
  jq -r '.InvalidParameters[]' "$SSM_RESPONSE"
  exit 1
fi

STRAVA_CLIENT_ID=$(jq -r --arg name "$CLIENT_ID_PARAM" '.Parameters[] | select(.Name == $name) | .Value' "$SSM_RESPONSE")
STRAVA_CLIENT_SECRET=$(jq -r --arg name "$CLIENT_SECRET_PARAM" '.Parameters[] | select(.Name == $name) | .Value' "$SSM_RESPONSE")
STRAVA_REFRESH_TOKEN=$(jq -r --arg name "$REFRESH_TOKEN_PARAM" '.Parameters[] | select(.Name == $name) | .Value' "$SSM_RESPONSE")

if [[ -z "$STRAVA_CLIENT_ID" || -z "$STRAVA_CLIENT_SECRET" || -z "$STRAVA_REFRESH_TOKEN" ]]; then
  echo "One or more SSM parameter values are empty."
  exit 1
fi

echo "Loaded SSM parameters successfully."
echo "Client ID: $STRAVA_CLIENT_ID"
echo "Client secret: loaded"
echo "Refresh token: loaded"
echo

echo "Testing Strava refresh token exchange..."

TOKEN_BODY="/tmp/strava_token_response.json"

TOKEN_STATUS=$(curl -sS -o "$TOKEN_BODY" -w "%{http_code}" \
  -X POST "https://www.strava.com/api/v3/oauth/token" \
  -d client_id="$STRAVA_CLIENT_ID" \
  -d client_secret="$STRAVA_CLIENT_SECRET" \
  -d grant_type="refresh_token" \
  -d refresh_token="$STRAVA_REFRESH_TOKEN")

echo "Token exchange HTTP status: $TOKEN_STATUS"

if [[ "$TOKEN_STATUS" != "200" ]]; then
  print_json_debug "token exchange failed" "$TOKEN_BODY"
  exit 1
fi

ACCESS_TOKEN=$(jq -r '.access_token // empty' "$TOKEN_BODY")
NEW_REFRESH_TOKEN=$(jq -r '.refresh_token // empty' "$TOKEN_BODY")
EXPIRES_AT=$(jq -r '.expires_at // empty' "$TOKEN_BODY")
EXPIRES_IN=$(jq -r '.expires_in // empty' "$TOKEN_BODY")
TOKEN_SCOPE=$(jq -r '.scope // empty' "$TOKEN_BODY")

if [[ -z "$ACCESS_TOKEN" ]]; then
  echo "Token exchange returned HTTP 200 but did not include an access_token."
  print_json_debug "token exchange response" "$TOKEN_BODY"
  exit 1
fi

echo "Token exchange succeeded."
echo "Access token: received"
echo "Expires at: $EXPIRES_AT"
echo "Expires in: $EXPIRES_IN seconds"

if [[ -n "$TOKEN_SCOPE" ]]; then
  echo "Scope from token response: $TOKEN_SCOPE"
else
  echo "Scope from token response: not returned"
fi

if [[ -n "$NEW_REFRESH_TOKEN" && "$NEW_REFRESH_TOKEN" != "$STRAVA_REFRESH_TOKEN" ]]; then
  echo
  echo "WARNING: Strava returned a different refresh token."
  echo "Your Lambda code should update /strava/refresh automatically if it has ssm:PutParameter."
  echo
  echo "To manually store the new refresh token, run:"
  echo
  echo "aws ssm put-parameter \\"
  echo "  --name \"$REFRESH_TOKEN_PARAM\" \\"
  echo "  --type \"SecureString\" \\"
  echo "  --value \"<NEW_REFRESH_TOKEN_FROM_RESPONSE>\" \\"
  echo "  --overwrite \\"
  echo "  --region \"$REGION\""
fi

echo
echo "Testing /athlete..."

ATHLETE_BODY="/tmp/strava_athlete_response.json"

ATHLETE_STATUS=$(curl -sS -o "$ATHLETE_BODY" -w "%{http_code}" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  "https://www.strava.com/api/v3/athlete")

echo "/athlete HTTP status: $ATHLETE_STATUS"

if [[ "$ATHLETE_STATUS" != "200" ]]; then
  print_json_debug "/athlete failed" "$ATHLETE_BODY"
else
  ATHLETE_ID=$(jq -r '.id // empty' "$ATHLETE_BODY")
  ATHLETE_USERNAME=$(jq -r '.username // empty' "$ATHLETE_BODY")
  echo "/athlete succeeded."
  echo "Athlete ID: $ATHLETE_ID"
  echo "Username: ${ATHLETE_USERNAME:-not set}"
fi

echo
echo "Testing /athlete/activities..."

ACTIVITIES_BODY="/tmp/strava_activities_response.json"

ACTIVITIES_STATUS=$(curl -sS -o "$ACTIVITIES_BODY" -w "%{http_code}" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  "https://www.strava.com/api/v3/athlete/activities?page=1&per_page=1")

echo "/athlete/activities HTTP status: $ACTIVITIES_STATUS"

if [[ "$ACTIVITIES_STATUS" != "200" ]]; then
  print_json_debug "/athlete/activities failed" "$ACTIVITIES_BODY"

  ERROR_FIELD=$(jq -r '.errors[0].field // empty' "$ACTIVITIES_BODY" 2>/dev/null || true)
  ERROR_CODE=$(jq -r '.errors[0].code // empty' "$ACTIVITIES_BODY" 2>/dev/null || true)

  if [[ "$ERROR_FIELD" == "activity:read_permission" && "$ERROR_CODE" == "missing" ]]; then
    echo "Decoded issue:"
    echo "The token is missing activity read permission."
    echo
    echo "Fix:"
    echo "Re-authorise the app with this scope:"
    echo "read,activity:read_all"
    echo
    echo "Authorisation URL:"
    echo "https://www.strava.com/oauth/authorize?client_id=$STRAVA_CLIENT_ID&response_type=code&redirect_uri=http://localhost&approval_prompt=force&scope=read,activity:read_all"
  fi

  exit 1
fi

echo "/athlete/activities succeeded."
echo
echo "Activity test response:"
jq '.' "$ACTIVITIES_BODY"

echo
echo "Debug complete."
