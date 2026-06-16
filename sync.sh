#!/bin/bash
# Sync Strava data from S3 into the app's public folder.
# Run from the strava-heatmap directory after setting your AWS creds.
#
# Usage:
#   export AWS_ACCESS_KEY_ID=...
#   export AWS_SECRET_ACCESS_KEY=...
#   export AWS_SESSION_TOKEN=...
#   ./sync.sh

BUCKET="s3://runningheatmapbycharlie.com"
DEST="./public"

echo "🔄 Syncing data from $BUCKET → $DEST"
echo ""

# Main data files
echo "📦 Syncing runs.geojson..."
aws s3 cp "$BUCKET/runs.geojson" "$DEST/runs.geojson"

echo "📦 Syncing runs_index.json..."
aws s3 cp "$BUCKET/runs_index.json" "$DEST/runs_index.json"

echo "📦 Syncing stats.json..."
aws s3 cp "$BUCKET/stats.json" "$DEST/stats.json"

echo "📦 Syncing personal_bests.json..."
aws s3 cp "$BUCKET/personal_bests.json" "$DEST/personal_bests.json" 2>/dev/null || echo "   (not found, skipping)"

# Splits — sync only downloads new/changed files
echo ""
echo "📦 Syncing splits..."
aws s3 sync "$BUCKET/splits/" "$DEST/splits/"

echo ""
echo "✅ Done! $(ls "$DEST/splits/" | wc -l | tr -d ' ') split files in $DEST/splits/"
