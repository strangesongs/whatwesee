# what we see is what we are

Photography portfolio by j cretella. Static site, no framework, no database.
Live at https://strangesongs.github.io/whatwesee/ (linked from the "photography" button on strangesongs.github.io).

## Developer commands (the owner uses whatwesee studio.app instead; see below)

```
npm install            # once per machine (installs sharp)
npm run serve          # site preview at http://localhost:8091, upload page at http://localhost:8091/admin/
npm run build          # add photos from inbox/ and tidy src/photos.json
npm run ship           # build, then git add/commit/push src/ so the site updates (~1 min)
npm run watch          # rebuild automatically when files land in inbox/
npm run watch:ship     # same, and publish automatically
npm run build -- --force   # re-resize everything in inbox/ (rare: it re-commits every image and grows the repo)
```

## Adding photos (tags, not folders)

Albums come from tags. A photo can have any number of tags; each tag in use is an album in the sidebar.
Untagged photos only appear under "all".

The owner doesn't use the terminal: the everyday path is the **whatwesee studio.app** in the project root
(double-click; don't tell them to run npm commands). Two parts, because macOS terminates anything an app
spawned once the app's main process exits:
- `Contents/MacOS/whatwesee-studio` (bash): if the running server started before the newest file in scripts/ was
  changed, `pkill`s it (so code updates apply on next open). If port 8091 isn't answering, `open -g -a` the hidden helper,
  waits for it, then opens http://localhost:8091/admin/ as a Chrome `--app` window (else the default browser).
- `Contents/Resources/whatwesee server.app` (LSBackgroundOnly, bash): finds node, `npm install` if sharp is
  missing, then runs `node scripts/serve.mjs` with IDLE_MINUTES=20 in a loop (the helper stays the app's process).
  The server exits 75 when scripts/*.mjs changed since it started (checked every 30s while no request is in flight)
  and the helper starts it again, so code updates apply even if the studio window is never closed (before this, an
  open window kept a stale server alive for days: Nov 2026, HEIC uploads were refused by a pre-HEIC server).
  It quits 20 min after the page stops pinging `/api/status`. Errors: alert + `~/Library/Logs/whatwesee-studio.log`.
The app normally lives in the project root (falls back to the absolute path if moved).

1. Uploader page: http://localhost:8091/admin/ (local only; lives in `scripts/admin/`, never published).
2. Drop photos, click tags (a button for every tag in use, plus "cover"; new tags are typed in the box), upload.
   The same buttons are on the bulk-edit bar; each photo card keeps a typed tag field. The page also retags, bulk-tags, reorders photos (drag; in an album view
   this sets that album's own `order`, otherwise the order of "all"), sorts by date, edits dates, hides/shows
   (moves files between src/photos and staging), merges albums (rename to an existing name), warns on duplicate
   uploads (409 + "upload anyway"), renames/reorders albums, writes album notes, and deletes photos.
3. "publish" on that page = `git add -A && git commit -m "update photos" && git push` (whole repo, not just src/).

Wide-colour photos (a profile wider than sRGB, e.g. iPhone Display P3; `isWideGamut` reads the profile's red primary)
are saved as Display P3 JPEGs (`withIccProfile('p3')` in `makeWebCopies`); everything else stays untagged sRGB as before.
iPhone photos (HEIC/HEIF) work in both paths: on a Mac they're converted to JPEG with `/usr/bin/sips` first (`heicToJpeg` in
`scripts/library.mjs`; sharp can't decode HEVC). RAW/PSD still need exporting.

Optional drop folder: `inbox/` (no tags) and `inbox/<name>/` (tagged `<name>`), then `npm run build`.
`inbox/` is git-ignored and exists only on this computer. The upload page doesn't copy originals anywhere.
Only the resized copies (3200px long edge full, never enlarged; 800px thumb; ~550 KB per photo for the current
scans, more for higher-resolution sources; metadata/GPS stripped) are committed. Raised from 2048px in Nov 2026.

## Publishing / hosting

- Hosted by GitHub Pages, deployed by `.github/workflows/pages.yml` on every push to `main` that touches `src/**`.
- The repo must be PUBLIC (Pages on a private repo needs a paid plan). Settings -> Pages -> Source = "GitHub Actions".
- Manual redeploy: GitHub -> Actions -> "Deploy site" -> Run workflow.
- Keep the repo small: GitHub rejects files over 100 MB and recommends repos under ~1 GB (published site max 1 GB): roughly 1,000–1,800 photos at 3200px, depending on the source resolution.

## How it works

- `src/` is the entire site. `src/index.html`, `app.js`, `styles.css`; paths are relative because it lives under `/whatwesee/`.
- Photos are flat: `src/photos/<file>.jpg` + `src/photos/thumbs/<file>.jpg`. Hidden photos: `staging/<file>.jpg` (+ thumbs).
- The library (source of truth) is `staging/library.json` (git-ignored, local only):
  `{ albums: [{slug, title, order?, note?}], photos: [{file, w, h, tags, date?, hidden?, dhash?}] }`. `albums` = sidebar
  order/names, `order` = that album's own photo order, `note` = plain text shown above that album's photos on the site
  (blank line = new paragraph, URLs auto-linked; written on the upload page when that album is picked under "photos"); `photos` = order of "all" (newest uploads first);
  `date` = taken (EXIF DateTimeOriginal, or typed); `dhash` = 64-bit perceptual hash for duplicate warnings.
- `src/photos.json` is the public subset written alongside it (non-hidden photos; file/w/h/tags/date only; album
  orders filtered). If it's newer than the local file (git pull, older studio), `readLibrary` takes it and keeps the
  local extras. Everything goes through `scripts/library.mjs` (`withLibrary`); unused tags are dropped automatically.
- On server start, `backfill()` fills missing `dhash` and missing dates from originals in `inbox/`.
- `scripts/library.mjs` also migrates the old folder-per-album layout (`src/photos/<album>/`) to tags on first read.
- Routing is hash-based: `#` (cover), `#all` (grid of everything), `#album/<tag>`, `#album/<tag>/<file>`, `#photo/<file>` (old `#photo/<album>/<file>` links still work).
- Landing page (`#`) = one cover photo where the grid would be: a random photo tagged `cover` (a hidden tag: never
  in the sidebar, the viewer's album list or the cover caption; `#album/cover` falls back to "all"), or a random
  landscape (w/h >= 1.2) when nothing is tagged `cover`. New on each load,
  sized so photo + caption fit in the window, centred in the column. Clicking it opens its most specific album (the tag with the fewest photos, so a place beats
  b/w or color; untagged opens the viewer). Underneath: its album links and date taken, in the viewer bar's type.
  Phones (<=860px) load the 800px thumb for it via <picture>, larger screens the full copy.
  Nothing in the sidebar is active on the cover; "all" links to `#all`. (`showCover` / `renderCover` in `app.js`.)
- The photo viewer's bar lists the albums the open photo is in (current one in ink, others link to that album and its note).
- Grid is pure-CSS justified rows (each tile's `--ar` aspect ratio drives its flex size).
- Font: Archivo variable, self-hosted in `src/fonts/` (OFL). No external requests. `src/fonts/Archivo/` is the full download, git-ignored.
- Phones (<=860px, the `phone` media query in `app.js` matches the CSS block): one-line header (wordmark + "albums"
  button that opens the album list), the album's name above its photos (`#album-head`), a 2-column grid (`.gallery.is-cols`;
  each photo goes in the shorter column so order still reads left-to-right), contact lines under a hairline.
  Tapping the cover opens it in the viewer (desktop: its album). Photos open in the phone viewer `#pv`, not the lightbox:
  full screen on black (html background + theme-color go black so nothing shows behind Safari's toolbar), a scroll-snap
  track for swiping between photos (`replaceState` keeps the URL on the current photo), tap = hide/show controls
  (waits 300ms for a double-tap), double-tap or pinch = zoom (custom transform; panning clamped to the photo's edges;
  zooming swaps the 800px copy for the full one), swipe down = close, turning the phone keeps the photo (drops zoom).
  Closing scrolls the grid to the last photo viewed. Tried and dropped, Nov 2026: a sideways-scrolling album strip, a
  full-width scrolling column instead of a viewer.
- Desktop viewer (lightbox): prev/next, keys, swipe on touch screens; clicking the photo toggles `.is-immersive`
  (controls hidden, black) and asks for real browser fullscreen. The viewer focuses itself on open, not the close button,
  so taps don't leave a focus ring.
- `scripts/serve.mjs` is the local server (static `src/`, `/admin/` page, `/api/*` for it). Bound to 127.0.0.1;
  rejects other Host headers and cross-origin POSTs. `scripts/watch.mjs` is the inbox watcher.

## Share preview and icons

- `src/og.jpg` (1200x630) is the link-preview image. `npm run build` (or the studio) makes it once from a cover-tagged photo (else the first landscape); delete it to regenerate, or drop in your own.
- `src/favicon.svg` and `src/apple-touch-icon.png` are the tab and home-screen icons.
- Photos fade in as they load (`.fade` / `.is-loaded` in `app.js` and `styles.css`).

## Design decisions (don't undo without asking)

Left sidebar with albums, off-white paper, Archivo grotesque, photos only (no captions), justified rows keeping natural aspect ratios.
Exception: the landing cover photo has one line under it (albums + date). The grid stays caption-free.
No serif/Georgia (rejected as looking like a personal project). No Flickr: the API is gone, everything is self-hosted.
Old Flickr/Netlify files were removed; they remain in git history on `main`.
