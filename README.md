# what we see is what we are

Static photo gallery site deployed on Netlify from src with no build step.

## Local Development

- Start a local static server:
  - npx http-server src -p 8080
- Open http://localhost:8080

## Deploy

- Push to the connected GitHub branch.
- Netlify auto-deploys from the repository using:
  - publish directory: src
  - build command: (empty)

## Post-Deploy Smoke Test

Run this checklist after each deploy:

1. Home page loads and styles render.
2. Album pills render and can switch albums.
3. Initial photo grid loads.
4. Load more button appends photos.
5. Lightbox opens, closes, and supports:
   - Escape to close
   - Left and right arrow navigation
   - Focus returns to triggering thumbnail after close
6. Retry button appears on data load failure and can reload.
7. Fallback behavior works when Flickr is temporarily unavailable.
8. Contact links and external links open correctly.
9. Security headers are present on production response.
10. Health endpoint returns ok at /healthz.txt.

You can run the same remote checks from the command line:

- bash .github/scripts/smoke-check.sh https://your-domain.example

## Monitoring and Error Reporting

### Uptime Monitoring

Use any free uptime service (UptimeRobot, Better Stack, etc.) with checks for:

- https://your-domain.example/
- https://your-domain.example/healthz.txt

Suggested interval: 5 minutes.

GitHub Actions also includes an automated check in [.github/workflows/site-health.yml](.github/workflows/site-health.yml).
Set repository variable SITE_URL to your production origin so scheduled checks can run.

For pre-release checks on demand, run [.github/workflows/pre-release-check.yml](.github/workflows/pre-release-check.yml) from the Actions tab.
You can provide an optional target_url input to check a preview/staging URL.

For each deploy, open a GitHub issue using [.github/ISSUE_TEMPLATE/release-checklist.md](.github/ISSUE_TEMPLATE/release-checklist.md) and track workflow/manual/security sign-off in one place.

### Lightweight Client Error Telemetry (Optional)

The app supports optional error reporting via browser sendBeacon:

- Set a receiver URL in src/scripts/app.js:
  - ERROR_MONITOR_URL
- If empty, telemetry is disabled.
- If set, the app sends:
  - window error events
  - unhandled promise rejections

Use this with your own endpoint or a service proxy.

## Maintenance Defaults

- Cache fallback data in the browser expires after 24 hours.
- Invalid cached photo/album records are filtered out before rendering.
- A branded not-found page is available at /404.html.
- Online/offline browser events update status messaging.
- Security headers include HSTS and Cross-Origin-Opener-Policy.

## Security Notes

Security and caching headers are configured in src/_headers, including CSP, referrer policy, frame protection, and long-lived asset cache rules.
