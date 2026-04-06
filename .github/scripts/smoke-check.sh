#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <site-url>"
  exit 1
fi

site_url="$1"
site_url="${site_url%/}"

echo "Running smoke checks for ${site_url}"

# Home page content
curl -fsSL --max-time 20 "${site_url}/" > homepage.html
grep -qi "what we see is what we are" homepage.html

# Health endpoint
health_response="$(curl -fsSL --max-time 20 "${site_url}/healthz.txt")"
[[ "${health_response}" == "ok" ]]

# 404 page content
not_found_body="$(curl -fsSL --max-time 20 "${site_url}/404.html")"
echo "${not_found_body}" | grep -qi "Page not found"

# Redirect behavior for about page (Netlify redirect to contact anchor)
redirect_headers="$(curl -sSI --max-time 20 "${site_url}/about.html")"
echo "${redirect_headers}" | grep -qi "^HTTP/.* 301"
echo "${redirect_headers}" | grep -qi "location: .*/index.html#contact"

# Security headers on home page
home_headers="$(curl -sSI --max-time 20 "${site_url}/")"
echo "${home_headers}" | grep -qi "content-security-policy"
echo "${home_headers}" | grep -qi "x-content-type-options"
echo "${home_headers}" | grep -qi "referrer-policy"
echo "${home_headers}" | grep -qi "x-frame-options"
echo "${home_headers}" | grep -qi "strict-transport-security"

echo "Smoke checks passed."
