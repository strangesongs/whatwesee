# what we see is what we are

Photography by j cretella. A plain HTML/CSS/JS gallery with no framework and no runtime dependencies. Live at https://strangesongs.github.io/whatwesee/

## Adding photos

1. Drop photos into `inbox/` (JPEG, PNG, WebP, TIFF; any size, originals are fine).
   - Loose photos show up in the main stream.
   - A subfolder becomes an album: `inbox/chicago/` shows as "chicago" in the album line. No folders means no album line.
2. Run `npm run build`. Each photo is resized to 2048px (viewer) and 800px (grid), location data is stripped, and `src/photos.json` is updated.
3. Run `npm run ship` to commit and push. GitHub Pages deploys `src/` automatically.

Hands-free: `npm run watch:ship` watches `inbox/`, rebuilds a few seconds after files stop arriving, and publishes. (`npm run watch` rebuilds without publishing.)

First time: `npm install`.

## Good to know

- `inbox/` is ignored by git. Your originals stay on your computer (or in your cloud folder); only the resized copies in `src/photos/` are published. You can empty `inbox/` any time and the site keeps working.
- Photos appear in filename order. Prefix names (`01-`, `02-`) to control order. Album order: put slugs in `src/photos/order.json`, e.g. `["chicago", "ohio"]`.
- To rename an album, add `src/photos/<album>/album.json` containing `{ "title": "new name" }`.
- To remove a photo from the site, delete its file from `src/photos/<album>/`. (If its original is still in `inbox/`, delete that too or it will come back on the next build.)
- HEIC and RAW files are skipped with a warning; export them as JPEG first.
- Preview locally: `npm run serve`, then open http://localhost:8091.
- `npm run build -- --force` regenerates every image (for example after changing the sizes in `scripts/build.mjs`).

## Layout

```
inbox/             your originals (local only)
scripts/build.mjs  resize + manifest
scripts/watch.mjs  watch inbox/
src/               the published site
  index.html styles.css app.js
  photos.json      generated list of photos
  photos/          generated web-sized copies
.github/workflows/pages.yml  deploys src/ to GitHub Pages
```

One-time setup on GitHub: repository Settings → Pages → Source: "GitHub Actions".
