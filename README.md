# what we see is what we are

Photography by j cretella. A plain HTML/CSS/JS gallery with no framework and no runtime dependencies. Live at https://strangesongs.github.io/whatwesee/

## Adding photos

Open **whatwesee studio** (the app in this folder; drag it to the Dock to keep it handy). The uploader opens in its own window.

1. Drop photos onto the window (JPEG, PNG, WebP, TIFF; any size, originals are fine), type tags, press **upload**.
   - Each tag becomes an album in the sidebar. A photo can have several tags, so it can be in several albums.
   - Photos with no tags only show under "all".
   - Each photo is resized to 2048px (viewer) and 800px (grid), and its location data is stripped. Your originals aren't copied or changed.
2. Press **publish** (top right). The live site updates in a minute or two.

In the same window you can:
- **retag** a photo, or select several and tag them at once
- **reorder**: drag photos in "all" (the main page) or inside an album (only that album changes). New uploads go first. "sort by date taken" orders "all" or an album by date in one go.
- **dates**: the date a photo was taken is read from the file when the camera or phone recorded it. Film scans usually carry the scan date or none, so click the date under a photo to set it.
- **hide** a photo: it stays in the studio but comes off the site (and out of GitHub) when you publish. "show" puts it back. Tick "keep hidden for now" when uploading to stage new photos before they go live; the "hidden" filter lists them.
- **albums**: rename them and change their order in the sidebar. Rename one to another album's name to merge the two.
- **duplicates**: if an upload looks like a photo that's already in the studio (even with a different file name), it's held back with an "upload anyway" option.
- **delete** a photo from the studio and the site for good.

Good to know about the app:
- The first time, macOS may ask whether whatwesee studio can use files in your Desktop folder: choose **Allow**. If it says the app "can't be opened", right-click it, choose **Open**, then **Open** again (only needed once).
- It needs Node.js installed (it is, on this Mac). The first launch on a new Mac sets itself up.
- Closing the window is enough; the background part quits by itself 20 minutes later. After an update to the uploader, just open the app again; it restarts itself with the new version.
- Keep the app inside this folder; that's how it finds the photos. If something goes wrong, details are in `~/Library/Logs/whatwesee-studio.log`.
- **publish** saves every change in this folder to GitHub (photos, and anything else edited here), not just the photos.

## Good to know

- Only the resized copies in `src/photos/` are published. `inbox/` is ignored by git.
- The studio's full library (including hidden photos, dates, and duplicate fingerprints) is `staging/library.json`, on this Mac only. `src/photos.json` is the public part the site reads. Hidden photos' files live in `staging/` too. Neither goes to GitHub, so back up `staging/` if you hide photos you care about.
- `npm run build` tidies the library (drops entries whose image is gone, adds `.jpg` files put in `src/photos/` by hand).
- HEIC and RAW files can't be read; export them as JPEG first.

## Behind the scenes (only if you're changing the code)

- The app runs `scripts/serve.mjs` (the same as `npm run serve`): site preview at http://localhost:8091, uploader at http://localhost:8091/admin/.
- The old drop folder still works: photos in `inbox/` (no tags) or `inbox/<name>/` (tagged `<name>`), then `npm run build` and `npm run ship`.
- `npm run build -- --force` regenerates every image from `inbox/` (for example after changing the sizes in `scripts/library.mjs`).

## Layout

```
whatwesee studio.app the uploader app (a small launcher for scripts/serve.mjs)
scripts/serve.mjs    local server: site preview + upload page + its API
scripts/admin/       the upload page (not published)
scripts/library.mjs  resizing, dates, duplicates, hide/show, the library files; shared by serve and build
scripts/build.mjs    inbox/ -> site, and tidy-up
scripts/watch.mjs    watch inbox/
src/                 the published site
  index.html styles.css app.js
  photos.json        photos, tags, albums
  photos/            web-sized copies (+ thumbs/)
inbox/               optional drop folder for originals (local only)
staging/             hidden photos + the full library (local only)
.github/workflows/pages.yml  deploys src/ to GitHub Pages
```

One-time setup on GitHub: repository Settings → Pages → Source: "GitHub Actions".
