# Project Guidelines

## Code Style
- Keep changes browser-ready with no build tooling assumptions.
- Use vanilla JavaScript in `src/scripts/app.js`; do not introduce frameworks or bundler-specific syntax.
- Prefer clear, small functions for UI behavior (rendering, modal behavior, pagination).
- Keep CSS in `src/styles/styles.css` — a single minimal stylesheet, no framework.

## Architecture
- Static Netlify site published from `src/`.
- Flickr API is called directly from the browser in `src/scripts/app.js`.
- Entry pages:
  - `src/index.html`: photo gallery page.
  - `src/about.html`: redirect to `index.html#contact`.
  - `src/404.html`: not-found page.
- Client behavior is centralized in `src/scripts/app.js`:
  - Flickr fetch and data loading.
  - Gallery rendering and pagination.
  - Hash-based album/photo deep links.
  - Lightbox open/close and keyboard navigation.

## Build and Test
- No build step (`netlify.toml` sets `command = ""`).
- Publish directory is `src`.
- For local testing, serve `src/` with `npx http-server src`.

## Conventions
- Preserve existing markup paths and relative links (`styles/styles.css`, `scripts/app.js`, `index.html`).
- Follow the existing event model in `src/scripts/app.js`: initialize inside `DOMContentLoaded`, then attach listeners.
- Avoid adding new hardcoded secrets in client-side code when possible.
