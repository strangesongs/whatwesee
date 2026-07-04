# what we see is what we are

Static photo gallery site deployed on Netlify from `src` with no build step.

## Local Development

- Start a local static server:
  - `npx http-server src -p 8080`
- Open http://localhost:8080

## Deploy

- Push to the connected GitHub branch.
- Netlify auto-deploys using:
  - publish directory: `src`
  - build command: (empty)

## Post-Deploy Smoke Test

Run this checklist after each deploy:

1. Home page loads and styles render.
2. Album links render and can switch albums.
3. Initial single-column photo gallery loads.
4. Load more appends photos.
5. Lightbox opens, closes, and supports:
   - Escape to close
   - Left and right arrow navigation
   - Focus returns to triggering thumbnail after close
   - View on Flickr link opens correctly
6. Hash URLs work: `#album/slug` and `#photo/id`
7. Retry button appears on data load failure and can reload.
8. Fallback behavior works when Flickr is temporarily unavailable.
9. Contact links and external links open correctly.
10. Security headers are present on production response.
11. Health endpoint returns ok at `/healthz.txt`.

Remote checks:

- `bash .github/scripts/smoke-check.sh https://your-domain.example`

## Monitoring and Error Reporting

### Uptime Monitoring

Use any free uptime service (UptimeRobot, Better Stack, etc.) with checks for:

- `https://your-domain.example/`
- `https://your-domain.example/healthz.txt`

Suggested interval: 5 minutes.

GitHub Actions includes an automated check in [.github/workflows/site-health.yml](.github/workflows/site-health.yml).
Set repository variable `SITE_URL` to your production origin so scheduled checks can run.

For pre-release checks on demand, run [.github/workflows/pre-release-check.yml](.github/workflows/pre-release-check.yml) from the Actions tab.

### Lightweight Client Error Telemetry (Optional)

Set `ERROR_MONITOR_URL` in `src/scripts/app.js` to enable sendBeacon error reporting.

## Maintenance Defaults

- Cache fallback data in the browser expires after 24 hours.
- Invalid cached photo/album records are filtered out before rendering.
- A branded not-found page is available at `/404.html`.
- Online/offline browser events update status messaging.
- Security headers include HSTS and Cross-Origin-Opener-Policy.

## Security Notes

Security and caching headers are configured in `src/_headers`, including CSP, referrer policy, frame protection, and long-lived asset cache rules.
