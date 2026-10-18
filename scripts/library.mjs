// The photo library: shared by build.mjs (inbox/ -> site) and serve.mjs (the
// local upload page at http://localhost:8091/admin/).
//
//   src/photos/<name>.jpg          2048px web copy (metadata/GPS stripped)
//   src/photos/thumbs/<name>.jpg   800px grid copy
//   src/photos.json                every photo with its tags, plus the albums
//                                  (one per tag) with their names, in sidebar order
//
// photos.json is written by the upload page and build.mjs. Its shape:
//   { "albums": [{ "slug": "chicago", "title": "chicago", "order": ["b.jpg", "a.jpg"] }, ...],
//     "photos": [{ "file": "x.jpg", "w": 2048, "h": 1365, "tags": ["chicago"] }, ...] }
// Photos are listed in the order "all" shows them (newest uploads first). An album's
// optional "order" is its own photo order, set by dragging in that album on the upload page.

import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SRC = path.join(ROOT, 'src');
export const INBOX = path.join(ROOT, 'inbox');
export const PHOTOS = path.join(SRC, 'photos');
export const THUMBS = path.join(PHOTOS, 'thumbs');
export const MANIFEST = path.join(SRC, 'photos.json');

const FULL = 2048; // long edge of the viewer image
const THUMB = 800; // long edge of the grid image

export const IMAGE = /\.(jpe?g|png|webp|tiff?|gif|avif)$/i;
export const UNSUPPORTED = /\.(heic|heif|raw|cr2|cr3|nef|arw|dng|psd)$/i;
export const collator = new Intl.Collator('en', { numeric: true });

export const slugify = (s) =>
    String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const exists = (p) => fs.stat(p).then(() => true, () => false);

let sharpLib = null;
async function loadSharp() {
    // loaded on first use, so tag edits work even before `npm install`
    sharpLib ??= (await import('sharp')).default;
    return sharpLib;
}

/* Images */

// Makes the 2048px and 800px copies of `input` (a path or a Buffer) as <name>.
export async function makeWebCopies(input, name) {
    const sharp = await loadSharp();
    await fs.mkdir(THUMBS, { recursive: true });
    // rotate() bakes in the EXIF orientation; sharp drops all metadata
    // (including GPS location) from the output by default.
    const make = (size, dest, quality) =>
        sharp(input, { failOn: 'none' })
            .rotate()
            .resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality, mozjpeg: true })
            .toFile(dest);
    const info = await make(FULL, path.join(PHOTOS, name), 82);
    await make(THUMB, path.join(THUMBS, name), 78);
    return { w: info.width, h: info.height };
}

// Size of a web copy already in src/photos/ (makes its thumb if missing).
export async function describe(name) {
    const sharp = await loadSharp();
    const full = path.join(PHOTOS, name);
    const thumb = path.join(THUMBS, name);
    if (!(await exists(thumb))) {
        await fs.mkdir(THUMBS, { recursive: true });
        await sharp(full).resize({ width: THUMB, height: THUMB, fit: 'inside' }).jpeg({ quality: 78, mozjpeg: true }).toFile(thumb);
    }
    const m = await sharp(full).metadata();
    return { w: m.width, h: m.height };
}

// A file name not used yet: sunset.jpg, sunset-2.jpg, ...
export async function uniqueName(lib, base) {
    const stem = slugify(base) || 'photo';
    const taken = new Set(lib.photos.map((p) => p.file));
    for (let n = 1; ; n++) {
        const name = n === 1 ? `${stem}.jpg` : `${stem}-${n}.jpg`;
        if (!taken.has(name) && !(await exists(path.join(PHOTOS, name)))) return name;
    }
}

// Share-preview image (og.jpg, 1200x630). Made once from the first landscape photo;
// delete src/og.jpg to regenerate it, or drop in your own 1200x630 JPEG.
export async function ensureShareImage(lib) {
    const target = path.join(SRC, 'og.jpg');
    if (await exists(target)) return;
    const pick = lib.photos.find((p) => p.w > p.h) || lib.photos[0];
    if (!pick) return;
    const sharp = await loadSharp();
    await sharp(path.join(PHOTOS, pick.file))
        .resize(1200, 630, { fit: 'cover', position: 'attention' })
        .jpeg({ quality: 82, mozjpeg: true })
        .toFile(target);
    console.log('made src/og.jpg (share preview)');
}

/* Tags */

// Turns what was typed into tag slugs. Accepts an existing slug, an existing
// album name, or new text (which creates an album named exactly as typed).
export function resolveTags(lib, texts = []) {
    const out = [];
    for (const raw of texts) {
        const text = String(raw).trim().replace(/\s+/g, ' ');
        if (!text) continue;
        const lower = text.toLowerCase();
        let album =
            lib.albums.find((a) => a.slug === text) ||
            lib.albums.find((a) => a.title.toLowerCase() === lower) ||
            lib.albums.find((a) => a.slug === slugify(text));
        if (!album) {
            const slug = slugify(text);
            if (!slug) continue;
            album = { slug, title: text };
            lib.albums.push(album);
        }
        if (!out.includes(album.slug)) out.push(album.slug);
    }
    return out;
}

// Albums = tags in use. Keeps names and order, adds new tags at the end,
// drops tags no photo has any more.
function syncAlbums(lib) {
    const used = new Set(lib.photos.flatMap((p) => p.tags));
    const seen = new Set();
    lib.albums = lib.albums.filter((a) => used.has(a.slug) && !seen.has(a.slug) && seen.add(a.slug));
    for (const p of lib.photos) {
        for (const t of p.tags) {
            if (seen.has(t)) continue;
            seen.add(t);
            lib.albums.push({ slug: t, title: t });
        }
    }
    // an album's own photo order only lists photos that still have its tag
    for (const a of lib.albums) {
        if (!a.order) continue;
        const tagged = new Set(lib.photos.filter((p) => p.tags.includes(a.slug)).map((p) => p.file));
        a.order = [...new Set(a.order)].filter((f) => tagged.has(f));
        if (!a.order.length) delete a.order;
    }
}

// Photos in an album, in that album's own order. Photos not placed yet (newly
// tagged) come first, newest first; same rule as src/app.js and the upload page.
export function albumPhotos(lib, slug) {
    const album = lib.albums.find((a) => a.slug === slug);
    const tagged = lib.photos.filter((p) => p.tags.includes(slug));
    if (!album?.order) return tagged;
    const rank = new Map(album.order.map((f, i) => [f, i]));
    return [...tagged.filter((p) => !rank.has(p.file)), ...tagged.filter((p) => rank.has(p.file)).sort((a, b) => rank.get(a.file) - rank.get(b.file))];
}

/* photos.json */

function normalize(data) {
    const photos = (Array.isArray(data.photos) ? data.photos : [])
        .filter((p) => p && typeof p.file === 'string' && !p.file.includes('/'))
        .map((p) => ({
            file: p.file,
            w: Number(p.w) || 0,
            h: Number(p.h) || 0,
            tags: [...new Set((Array.isArray(p.tags) ? p.tags : []).filter((t) => typeof t === 'string' && t))],
        }));
    const albums = (Array.isArray(data.albums) ? data.albums : [])
        .filter((a) => a && typeof a.slug === 'string' && a.slug)
        .map((a) => {
            const album = { slug: a.slug, title: String(a.title || a.slug) };
            if (Array.isArray(a.order)) album.order = a.order.filter((f) => typeof f === 'string');
            return album;
        });
    return { albums, photos };
}

export async function readLibrary() {
    let text = '';
    try {
        text = await fs.readFile(MANIFEST, 'utf8');
    } catch (err) {
        // missing = start empty. Anything else (e.g. no permission) must stop here,
        // or the next save would overwrite the real list with an empty one.
        if (err.code !== 'ENOENT') throw err;
    }
    let data = {};
    if (text.trim()) {
        try {
            data = JSON.parse(text);
        } catch (err) {
            throw new Error(`src/photos.json is not valid JSON (${err.message}); fix it before adding photos`);
        }
    }
    const legacy = Array.isArray(data.albums) && data.albums.some((a) => a && Array.isArray(a.photos));
    return legacy ? migrateFolders(data) : normalize(data);
}

// One line per photo/album keeps git diffs readable.
export async function writeLibrary(lib) {
    syncAlbums(lib);
    const list = (items) => (items.length ? `[\n${items.map((x) => '  ' + JSON.stringify(x)).join(',\n')}\n ]` : '[]');
    const next = `{\n "albums": ${list(lib.albums)},\n "photos": ${list(lib.photos)}\n}\n`;
    const prev = await fs.readFile(MANIFEST, 'utf8').catch(() => '');
    if (next === prev) return false;
    await fs.writeFile(MANIFEST, next);
    return true;
}

// Runs fn(lib) and saves the result, one change at a time.
let chain = Promise.resolve();
export function withLibrary(fn) {
    const run = chain.then(async () => {
        const lib = await readLibrary();
        const result = await fn(lib);
        await writeLibrary(lib);
        return result === undefined ? lib : result;
    });
    chain = run.catch(() => {});
    return run;
}

// The site used to have one folder per album (src/photos/<album>/...).
// Move those photos into the flat layout, tagged with their old album.
async function migrateFolders(old) {
    const lib = { albums: [], photos: [] };
    await fs.mkdir(THUMBS, { recursive: true });
    for (const album of old.albums) {
        const tagged = album.slug !== '_loose';
        if (tagged) lib.albums.push({ slug: album.slug, title: album.title || album.slug });
        const dir = path.join(PHOTOS, album.slug);
        for (const p of album.photos || []) {
            const from = path.join(dir, p.file);
            if (!(await exists(from))) continue;
            const base = path.parse(p.file).name;
            const name = await uniqueName(lib, tagged ? `${album.slug}-${base}` : base);
            await fs.rename(from, path.join(PHOTOS, name));
            await fs.rename(path.join(dir, 'thumbs', p.file), path.join(THUMBS, name)).catch(() => {});
            lib.photos.push({ file: name, w: p.w, h: p.h, tags: tagged ? [album.slug] : [] });
        }
        // tidy the old folder if the system lets us
        await fs.rm(path.join(dir, 'album.json'), { force: true }).catch(() => {});
        await fs.rm(path.join(dir, '.DS_Store'), { force: true }).catch(() => {});
        await fs.rmdir(path.join(dir, 'thumbs')).catch(() => {});
        await fs.rmdir(dir).catch(() => {});
    }
    await fs.rm(path.join(PHOTOS, 'order.json'), { force: true }).catch(() => {});
    await writeLibrary(lib);
    console.log(`moved ${lib.photos.length} photos from album folders to tags`);
    return lib;
}

/* Publishing */

const git = (args) =>
    promisify(execFile)('git', args, { cwd: ROOT, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });

// True when there are changes not on GitHub yet (photos, and anything else in the project).
export async function hasUnpublished() {
    const { stdout: local } = await git(['status', '--porcelain']);
    if (local.trim()) return true;
    try {
        const { stdout } = await git(['rev-list', '--count', '@{u}..HEAD']);
        return Number(stdout.trim()) > 0;
    } catch {
        return false;
    }
}

// Commits everything that changed (photos, and any other edits; .gitignore'd files stay out)
// and pushes. GitHub Pages redeploys when src/ changed.
export async function publish() {
    await git(['add', '-A']);
    let staged = true;
    try {
        await git(['diff', '--cached', '--quiet']);
        staged = false;
    } catch {
        // there are staged changes
    }
    if (staged) await git(['commit', '-m', 'update photos']);
    else if (!(await hasUnpublished())) return 'nothing new to publish';
    await git(['push']);
    return 'published — the live site updates in a minute or two';
}
