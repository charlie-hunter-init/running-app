#!/bin/bash
set -e

echo "Installing dependencies..."
npm install --production

echo "Packaging Lambda..."
cp index.js index.mjs
zip -r deploy.zip index.mjs node_modules/

echo "Deploying to AWS..."
aws lambda update-function-code \
  --function-name update-runs-geojson \
  --zip-file fileb://deploy.zip \
  --region ap-southeast-2

echo "Cleaning up..."
rm -f index.mjs deploy.zip

echo "Done! Lambda deployed."
