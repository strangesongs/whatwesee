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
- `Contents/MacOS/whatwesee-studio` (bash): if port 8091 isn't answering, `open -g -a` the hidden helper,
  waits for it, then opens http://localhost:8091/admin/ as a Chrome `--app` window (else the default browser).
- `Contents/Resources/whatwesee server.app` (LSBackgroundOnly, bash): finds node, `npm install` if sharp is
  missing, then `exec node scripts/serve.mjs` with IDLE_MINUTES=20, so the server IS that helper app's process.
  It quits 20 min after the page stops pinging `/api/status`. Errors: alert + `~/Library/Logs/whatwesee-studio.log`.
The app normally lives in the project root (falls back to the absolute path if moved).

1. Uploader page: http://localhost:8091/admin/ (local only; lives in `scripts/admin/`, never published).
2. Drop photos, type tags, upload. The page also retags, bulk-tags, reorders photos (drag; in an album view
   this sets that album's own `order` in photos.json, otherwise the order of "all"), renames/reorders albums,
   and removes photos.
3. "publish" on that page = `git add -A && git commit -m "update photos" && git push` (whole repo, not just src/).

Optional drop folder: `inbox/` (no tags) and `inbox/<name>/` (tagged `<name>`), then `npm run build`.
`inbox/` is git-ignored and exists only on this computer. The upload page doesn't copy originals anywhere.
Only the resized copies (2048px full, 800px thumb, ~420 KB per photo, metadata/GPS stripped) are committed.

## Publishing / hosting

- Hosted by GitHub Pages, deployed by `.github/workflows/pages.yml` on every push to `main` that touches `src/**`.
- The repo must be PUBLIC (Pages on a private repo needs a paid plan). Settings -> Pages -> Source = "GitHub Actions".
- Manual redeploy: GitHub -> Actions -> "Deploy site" -> Run workflow.
- Keep the repo small: GitHub rejects files over 100 MB and recommends repos under ~1 GB (~2000 photos).

## How it works

- `src/` is the entire site. `src/index.html`, `app.js`, `styles.css`; paths are relative because it lives under `/whatwesee/`.
- Photos are flat: `src/photos/<file>.jpg` + `src/photos/thumbs/<file>.jpg`.
- `src/photos.json` = `{ albums: [{slug, title}], photos: [{file, w, h, tags: [slug]}] }`. `albums` is the sidebar
  order and names; `photos` is the display order (newest uploads first). Written by the upload page and
  `scripts/build.mjs` via `scripts/library.mjs`; prefer those over hand edits. Unused tags are dropped automatically.
- `scripts/library.mjs` also migrates the old folder-per-album layout (`src/photos/<album>/`) to tags on first read.
- Routing is hash-based: `#`, `#album/<tag>`, `#album/<tag>/<file>`, `#photo/<file>` (old `#photo/<album>/<file>` links still work).
- Grid is pure-CSS justified rows (each tile's `--ar` aspect ratio drives its flex size).
- Font: Archivo variable, self-hosted in `src/fonts/` (OFL). No external requests. `src/fonts/Archivo/` is the full download, git-ignored.
- Mobile (<=860px): stacked header, 44px tap targets, viewer controls at the bottom, swipe to navigate.
- `scripts/serve.mjs` is the local server (static `src/`, `/admin/` page, `/api/*` for it). Bound to 127.0.0.1;
  rejects other Host headers and cross-origin POSTs. `scripts/watch.mjs` is the inbox watcher.

## Share preview and icons

- `src/og.jpg` (1200x630) is the link-preview image. `npm run build` makes it once from the first landscape photo; delete it to regenerate, or drop in your own.
- `src/favicon.svg` and `src/apple-touch-icon.png` are the tab and home-screen icons.
- Photos fade in as they load (`.fade` / `.is-loaded` in `app.js` and `styles.css`).

## Design decisions (don't undo without asking)

Left sidebar with albums, off-white paper, Archivo grotesque, photos only (no captions), justified rows keeping natural aspect ratios.
No serif/Georgia (rejected as looking like a personal project). No Flickr: the API is gone, everything is self-hosted.
Old Flickr/Netlify files were removed; they remain in git history on `main`.
