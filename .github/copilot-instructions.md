# Project Guidelines

## Code Style
- Keep changes browser-ready with no build tooling assumptions.
- Use vanilla JavaScript in `src/scripts/app.js`; do not introduce frameworks or bundler-specific syntax.
- Prefer clear, small functions for UI behavior (rendering, modal behavior, pagination).
- Keep CSS organization as-is: base framework in `src/styles/skeleton.css`, project overrides in `src/styles/styles.css`.

## Architecture
- This is a static Netlify site published from `src/`.
- Entry pages:
  - `src/index.html`: photo gallery page.
  - `src/about.html`: contact/about page.
- Client behavior is centralized in `src/scripts/app.js`:
  - Flickr fetch and data loading.
  - Gallery rendering and pagination.
  - Modal open/close and keyboard navigation.

## Build and Test
- There is no build step (`netlify.toml` sets `command = ""`).
- Publish directory is `src`.
- No automated test suite is configured.
- For local manual testing, serve `src/` with a static server (example: `npx http-server src`).

## Conventions
- Preserve existing markup paths and relative links (`styles/styles.css`, `scripts/app.js`, `index.html`, `about.html`).
- Follow the existing event model in `src/scripts/app.js`: initialize inside `DOMContentLoaded`, then attach listeners.
- If touching Flickr integration, keep user-visible error handling in mind (current behavior logs to console only).
- Do not hardcode additional secrets in client-side code; this project already contains a public API key in `src/scripts/app.js`, so avoid expanding that pattern.