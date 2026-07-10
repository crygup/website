#!/usr/bin/env bash
set -euo pipefail

SRC="$(dirname "$(realpath "$0")")"
WWW="/var/www/crygup"
API="/opt/avatar-lookup/avatar_api.py"

echo "=== Deploying static files -> $WWW"
sudo cp "$SRC"/*.html "$WWW"/
sudo cp "$SRC"/*.js   "$WWW"/
sudo cp "$SRC"/*.css  "$WWW"/
sudo cp -r "$SRC"/images/* "$WWW"/images/ 2>/dev/null || true
sudo cp -r "$SRC"/ror2-data "$WWW"/ 2>/dev/null || true
sudo cp -r "$SRC"/images/ror2/enemies "$WWW"/images/ror2/ 2>/dev/null || true
sudo nginx -t && sudo systemctl reload nginx

echo "=== Deploying avatar API -> $API"
sudo cp "$SRC"/server/avatar_api.py "$API"
sudo systemctl restart avatar-lookup.service

