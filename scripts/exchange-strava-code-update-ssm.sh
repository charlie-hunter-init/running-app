#!/usr/bin/env bash
set -euo pipefail

REGION="${AWS_REGION:-ap-southeast-2}"

CLIENT_ID_PARAM="${CLIENT_ID_PARAM:-/strava/client_id}"
CLIENT_SECRET_PARAM="${CLIENT_SECRET_PARAM:-/strava/secret}"
REFRESH_TOKEN_PARAM="${REFRESH_TOKEN_PARAM:-/strava/refresh}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1"
    exit 1
  fi
}

require_command aws
require_command curl
require_command jq

echo "Reading Strava client_id and client_secret from SSM..."
echo "Region: $REGION"
echo

SSM_RESPONSE="/tmp/strava_code_exchange_ssm.json"

aws ssm get-parameters \
  --names "$CLIENT_ID_PARAM" "$CLIENT_SECRET_PARAM" \
  --with-decryption \
  --region "$REGION" > "$SSM_RESPONSE"

STRAVA_CLIENT_ID=$(jq -r --arg name "$CLIENT_ID_PARAM" '.Parameters[] | select(.Name == $name) | .Value' "$SSM_RESPONSE")
STRAVA_CLIENT_SECRET=$(jq -r --arg name "$CLIENT_SECRET_PARAM" '.Parameters[] | select(.Name == $name) | .Value' "$SSM_RESPONSE")

if [[ -z "$STRAVA_CLIENT_ID" || -z "$STRAVA_CLIENT_SECRET" ]]; then
  echo "Could not load client_id or client_secret from SSM."
  exit 1
fi

echo "Client ID: $STRAVA_CLIENT_ID"
echo "Client secret: loaded"
echo

echo "Open this URL in your browser:"
echo
echo "https://www.strava.com/oauth/authorize?client_id=$STRAVA_CLIENT_ID&response_type=code&redirect_uri=http://localhost&approval_prompt=force&scope=read,activity:read_all"
echo
echo "Approve the app, then copy the code= value from the redirected localhost URL."
echo

read -rp "Paste Strava code here: " STRAVA_CODE

if [[ -z "$STRAVA_CODE" ]]; then
  echo "Code cannot be empty."
  exit 1
fi

TOKEN_BODY="/tmp/strava_code_exchange_response.json"

echo
echo "Exchanging authorisation code for tokens..."

TOKEN_STATUS=$(curl -sS -o "$TOKEN_BODY" -w "%{http_code}" \
  -X POST "https://www.strava.com/api/v3/oauth/token" \
  -d client_id="$STRAVA_CLIENT_ID" \
  -d client_secret="$STRAVA_CLIENT_SECRET" \
  -d code="$STRAVA_CODE" \
  -d grant_type="authorization_code")

echo "Token exchange HTTP status: $TOKEN_STATUS"

if [[ "$TOKEN_STATUS" != "200" ]]; then
  echo
  echo "Token exchange failed:"
  jq '.' "$TOKEN_BODY" 2>/dev/null || cat "$TOKEN_BODY"
  exit 1
fi

ACCESS_TOKEN=$(jq -r '.access_token // empty' "$TOKEN_BODY")
REFRESH_TOKEN=$(jq -r '.refresh_token // empty' "$TOKEN_BODY")
SCOPE=$(jq -r '.scope // empty' "$TOKEN_BODY")
EXPIRES_AT=$(jq -r '.expires_at // empty' "$TOKEN_BODY")

if [[ -z "$REFRESH_TOKEN" || -z "$ACCESS_TOKEN" ]]; then
  echo "Token exchange succeeded but response did not contain access_token/refresh_token."
  jq '.' "$TOKEN_BODY"
  exit 1
fi

echo "Token exchange succeeded."
echo "Scope: ${SCOPE:-not returned}"
echo "Expires at: $EXPIRES_AT"

if [[ "$SCOPE" != *"activity:read"* && "$SCOPE" != *"activity:read_all"* ]]; then
  echo
  echo "WARNING: Scope does not appear to include activity read permission."
  echo "Expected: read,activity:read_all"
  echo "Actual: ${SCOPE:-not returned}"
  exit 1
fi

echo
echo "Writing new refresh token to $REFRESH_TOKEN_PARAM..."

aws ssm put-parameter \
  --name "$REFRESH_TOKEN_PARAM" \
  --type "SecureString" \
  --value "$REFRESH_TOKEN" \
  --overwrite \
  --region "$REGION"

echo "Refresh token updated in SSM."

echo
echo "Testing /athlete/activities with new access token..."

ACTIVITIES_BODY="/tmp/strava_activities_after_code_exchange.json"

ACTIVITIES_STATUS=$(curl -sS -o "$ACTIVITIES_BODY" -w "%{http_code}" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  "https://www.strava.com/api/v3/athlete/activities?page=1&per_page=1")

echo "/athlete/activities HTTP status: $ACTIVITIES_STATUS"

if [[ "$ACTIVITIES_STATUS" != "200" ]]; then
  echo
  echo "Activities test failed:"
  jq '.' "$ACTIVITIES_BODY" 2>/dev/null || cat "$ACTIVITIES_BODY"
  exit 1
fi

echo "Activities test succeeded."
echo
echo "Now rerun:"
echo "./debug-strava-auth.sh"
echo
echo "Then rerun your Lambda/app."
