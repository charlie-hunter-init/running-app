#!/usr/bin/env bash
set -euo pipefail

REGION="${AWS_REGION:-ap-southeast-2}"
REFRESH_TOKEN_PARAM="${REFRESH_TOKEN_PARAM:-/strava/refresh}"

echo "Updating Strava refresh token in SSM Parameter Store"
echo "Region: $REGION"
echo "Parameter: $REFRESH_TOKEN_PARAM"
echo

read -rsp "Enter new Strava refresh_token: " STRAVA_REFRESH_TOKEN
echo
echo

if [[ -z "$STRAVA_REFRESH_TOKEN" ]]; then
  echo "Refresh token cannot be empty."
  exit 1
fi

echo "Writing new refresh token to $REFRESH_TOKEN_PARAM..."

aws ssm put-parameter \
  --name "$REFRESH_TOKEN_PARAM" \
  --type "SecureString" \
  --value "$STRAVA_REFRESH_TOKEN" \
  --overwrite \
  --region "$REGION"

echo
echo "Refresh token updated successfully."
echo
echo "Run this to test it:"
echo "./debug-strava-auth.sh"
