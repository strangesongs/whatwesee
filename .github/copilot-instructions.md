# Project Guidelines

Photography portfolio ("what we see is what we are"), served from GitHub Pages at https://strangesongs.github.io/whatwesee/.

## Layout
- `src/` is the published site (vanilla HTML/CSS/JS, no framework). Paths are relative so it works under `/whatwesee/`.
- `inbox/` holds local originals and is git-ignored. `scripts/build.mjs` resizes them into `src/photos/` and writes `src/photos.json`.
- Do not hand-edit `src/photos.json`; it is generated.

## Conventions
- No Flickr API or CDN, no Netlify config.
- Photos only: no captions or per-photo metadata.
- Keep it lightweight: no build step for the site itself, no client-side dependencies.
- Lowercase text, Archivo (self-hosted), plain links.
