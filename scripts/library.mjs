// The photo library: shared by build.mjs (inbox/ -> site) and serve.mjs (the
// uploader, opened by "whatwesee studio.app").
//
//   src/photos/<name>.jpg          2048px web copy of a photo on the site (metadata/GPS stripped)
//   src/photos/thumbs/<name>.jpg   800px grid copy
//   staging/<name>.jpg (+ thumbs/) hidden photos: in the studio, not on the site, not in git
//   staging/library.json           the full library (what the studio works from; not in git)
//   src/photos.json                the public part of it, which the site reads
//
// The library:
//   { "albums": [{ "slug": "chicago", "title": "chicago", "order": ["b.jpg", "a.jpg"] }, ...],
//     "photos": [{ "file": "x.jpg", "w": 2048, "h": 1365, "tags": ["chicago"],
//                  "date": "2024-05-03T19:50:22", "hidden": true, "dhash": "..." }, ...] }
// Photos are listed in the order "all" shows them (newest uploads first). An album's
// optional "order" is its own photo order. "date" is when the photo was taken (from the
// file, or typed in). "dhash" is a fingerprint used to spot duplicate uploads.
// src/photos.json has only the photos that aren't hidden, and only file/w/h/tags/date.

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
export const STAGING = path.join(ROOT, 'staging');
const LOCAL = path.join(STAGING, 'library.json');

const FULL = 2048; // long edge of the viewer image
const THUMB = 800; // long edge of the grid image

export const IMAGE = /\.(jpe?g|png|webp|tiff?|gif|avif)$/i;
export const UNSUPPORTED = /\.(heic|heif|raw|cr2|cr3|nef|arw|dng|psd)$/i;
export const collator = new Intl.Collator('en', { numeric: true });

export const slugify = (s) =>
    String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const exists = (p) => fs.stat(p).then(() => true, () => false);
const mtime = (p) => fs.stat(p).then((s) => s.mtimeMs, () => 0);

let sharpLib = null;
async function loadSharp() {
    // loaded on first use, so tag edits work even before `npm install`
    sharpLib ??= (await import('sharp')).default;
    return sharpLib;
}

/* Where a photo's files are */

export const dirOf = (p) => (p.hidden ? STAGING : PHOTOS);
export const fullPath = (p) => path.join(dirOf(p), p.file);
export const thumbPath = (p) => path.join(dirOf(p), 'thumbs', p.file);

/* Images */

// Makes the 2048px and 800px copies of `input` (a path or a Buffer) as <name>,
// in src/photos/ or (hidden) staging/.
export async function makeWebCopies(input, name, { hidden = false } = {}) {
    const sharp = await loadSharp();
    const p = { file: name, hidden };
    await fs.mkdir(path.dirname(thumbPath(p)), { recursive: true });
    // rotate() bakes in the EXIF orientation; sharp drops all metadata
    // (including GPS location) from the output by default.
    const make = (size, dest, quality) =>
        sharp(input, { failOn: 'none' })
            .rotate()
            .resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality, mozjpeg: true })
            .toFile(dest);
    const info = await make(FULL, fullPath(p), 82);
    await make(THUMB, thumbPath(p), 78);
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
        if (taken.has(name)) continue;
        if (await exists(path.join(PHOTOS, name))) continue;
        if (await exists(path.join(STAGING, name))) continue;
        return name;
    }
}

// Share-preview image (og.jpg, 1200x630). Made once from the first landscape photo;
// delete src/og.jpg to regenerate it, or drop in your own 1200x630 JPEG.
export async function ensureShareImage(lib) {
    const target = path.join(SRC, 'og.jpg');
    if (await exists(target)) return;
    const shown = lib.photos.filter((p) => !p.hidden);
    const pick = shown.find((p) => p.w > p.h) || shown[0];
    if (!pick) return;
    const sharp = await loadSharp();
    await sharp(fullPath(pick))
        .resize(1200, 630, { fit: 'cover', position: 'attention' })
        .jpeg({ quality: 82, mozjpeg: true })
        .toFile(target);
    console.log('made src/og.jpg (share preview)');
}

/* When a photo was taken: EXIF DateTimeOriginal (or CreateDate, or DateTime) */

// The EXIF block of a JPEG, read straight from the bytes (no image library needed).
export function jpegExif(buf) {
    if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
    let i = 2;
    while (i + 4 <= buf.length) {
        if (buf[i] !== 0xff) return null;
        const marker = buf[i + 1];
        if (marker === 0xda || marker === 0xd9) return null; // image data starts: no EXIF
        const len = buf.readUInt16BE(i + 2);
        if (marker === 0xe1 && buf.toString('latin1', i + 4, i + 10) === 'Exif\0\0') {
            return buf.subarray(i + 10, i + 2 + len);
        }
        i += 2 + len;
    }
    return null;
}

// "2024:05:03 19:50:22" from a TIFF/EXIF block -> "2024-05-03T19:50:22"
export function exifDate(block) {
    if (!block || block.length < 8) return null;
    let tiff = block;
    if (tiff.toString('latin1', 0, 6) === 'Exif\0\0') tiff = tiff.subarray(6);
    const order = tiff.toString('latin1', 0, 2);
    if (order !== 'II' && order !== 'MM') return null;
    const le = order === 'II';
    const u16 = (o) => (le ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
    const u32 = (o) => (le ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o));

    const readIfd = (offset) => {
        const tags = new Map();
        if (offset + 2 > tiff.length) return tags;
        const n = u16(offset);
        for (let k = 0; k < n; k++) {
            const e = offset + 2 + k * 12;
            if (e + 12 > tiff.length) break;
            tags.set(u16(e), { type: u16(e + 2), count: u32(e + 4), at: e + 8 });
        }
        return tags;
    };
    const text = (t) => {
        if (!t || t.type !== 2 || t.count < 19) return null;
        const start = t.count > 4 ? u32(t.at) : t.at;
        if (start + 19 > tiff.length) return null;
        const s = tiff.toString('latin1', start, start + 19);
        const m = s.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
        if (!m || Number(m[1]) < 1830 || m[2] === '00') return null;
        return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
    };

    try {
        const ifd0 = readIfd(u32(4));
        const exifPtr = ifd0.get(0x8769);
        const exif = exifPtr ? readIfd(u32(exifPtr.at)) : new Map();
        return text(exif.get(0x9003)) || text(exif.get(0x9004)) || text(ifd0.get(0x0132));
    } catch {
        return null;
    }
}

// Capture date + duplicate fingerprint of an original (path or Buffer).
export async function inspect(input) {
    const out = { date: null, dhash: null };
    const buf = Buffer.isBuffer(input) ? input : await fs.readFile(input);
    out.date = exifDate(jpegExif(buf));
    try {
        const sharp = await loadSharp();
        if (!out.date) out.date = exifDate((await sharp(buf).metadata()).exif);
        out.dhash = await dhash(buf);
    } catch {
        // no image library (or unreadable): leave what we have
    }
    return out;
}

/* Duplicates: a 64-bit "difference hash" survives resizing and re-saving */

export async function dhash(input) {
    const sharp = await loadSharp();
    const px = await sharp(input, { failOn: 'none' }).rotate().greyscale()
        .resize(9, 8, { fit: 'fill' }).raw().toBuffer();
    let bits = '';
    for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) bits += px[y * 9 + x] < px[y * 9 + x + 1] ? '1' : '0';
    }
    return BigInt(`0b${bits}`).toString(16).padStart(16, '0');
}

const distance = (a, b) => {
    let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
    let n = 0;
    while (x) {
        n += Number(x & 1n);
        x >>= 1n;
    }
    return n;
};

export function findDuplicate(lib, hash) {
    if (!hash) return null;
    return lib.photos.find((p) => p.dhash && distance(p.dhash, hash) <= 5) || null;
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

// Folds album `from` into album `into`: its photos get `into`'s tag instead.
export function mergeAlbums(lib, from, into) {
    const a = lib.albums.find((x) => x.slug === from);
    const b = lib.albums.find((x) => x.slug === into);
    if (!a || !b || a === b) return false;
    const order = albumPhotos(lib, into).map((p) => p.file);
    for (const p of albumPhotos(lib, from)) {
        p.tags = p.tags.filter((t) => t !== from);
        if (!p.tags.includes(into)) p.tags.push(into);
        if (!order.includes(p.file)) order.push(p.file);
    }
    b.order = order;
    return true;
}

// Sorts "all" (no album) or one album by date taken; photos without a date go last.
export function sortByDate(lib, album, newestFirst) {
    const list = album ? albumPhotos(lib, album) : [...lib.photos];
    const at = new Map(list.map((p, i) => [p, i]));
    list.sort((x, y) => {
        if (!x.date || !y.date) return (x.date ? -1 : y.date ? 1 : 0) || at.get(x) - at.get(y);
        const c = x.date < y.date ? -1 : x.date > y.date ? 1 : 0;
        return (newestFirst ? -c : c) || at.get(x) - at.get(y);
    });
    if (album) lib.albums.find((a) => a.slug === album).order = list.map((p) => p.file);
    else lib.photos = list;
}

// Moves photos on or off the site (their files go to src/photos/ or staging/).
export async function setHidden(lib, files, hidden) {
    for (const file of files) {
        const p = lib.photos.find((x) => x.file === file);
        if (!p || Boolean(p.hidden) === hidden) continue;
        const from = { ...p };
        if (hidden) p.hidden = true;
        else delete p.hidden;
        await fs.mkdir(path.dirname(thumbPath(p)), { recursive: true });
        await fs.rename(fullPath(from), fullPath(p));
        await fs.rename(thumbPath(from), thumbPath(p)).catch(() => {});
    }
}

export async function removePhotos(lib, files) {
    for (const file of files) {
        const p = lib.photos.find((x) => x.file === file);
        if (!p) continue;
        await fs.rm(fullPath(p), { force: true });
        await fs.rm(thumbPath(p), { force: true });
        lib.photos = lib.photos.filter((x) => x !== p);
    }
}

/* Reading and saving */

function normalize(data) {
    const photos = (Array.isArray(data.photos) ? data.photos : [])
        .filter((p) => p && typeof p.file === 'string' && !p.file.includes('/'))
        .map((p) => {
            const photo = {
                file: p.file,
                w: Number(p.w) || 0,
                h: Number(p.h) || 0,
                tags: [...new Set((Array.isArray(p.tags) ? p.tags : []).filter((t) => typeof t === 'string' && t))],
            };
            if (typeof p.date === 'string' && p.date) photo.date = p.date;
            if (p.hidden) photo.hidden = true;
            if (typeof p.dhash === 'string' && /^[0-9a-f]{16}$/.test(p.dhash)) photo.dhash = p.dhash;
            return photo;
        });
    const albums = (Array.isArray(data.albums) ? data.albums : [])
        .filter((a) => a && typeof a.slug === 'string' && a.slug)
        .map((a) => {
            const album = { slug: a.slug, title: String(a.title || a.slug) };
            if (Array.isArray(a.order)) album.order = a.order.filter((f) => typeof f === 'string');
            return album;
        });
    return { albums, photos };
}

async function readJsonFile(file, label) {
    let text = '';
    try {
        text = await fs.readFile(file, 'utf8');
    } catch (err) {
        // missing = nothing yet. Anything else (e.g. no permission) must stop here,
        // or the next save would overwrite the real list with an empty one.
        if (err.code !== 'ENOENT') throw err;
        return null;
    }
    if (!text.trim()) return null;
    try {
        return JSON.parse(text);
    } catch (err) {
        throw new Error(`${label} is not valid JSON (${err.message}); fix it before adding photos`);
    }
}

export async function readLibrary() {
    const pub = await readJsonFile(MANIFEST, 'src/photos.json');
    if (pub && Array.isArray(pub.albums) && pub.albums.some((a) => a && Array.isArray(a.photos))) {
        return migrateFolders(pub);
    }
    const local = await readJsonFile(LOCAL, 'staging/library.json');
    if (!local) return normalize(pub || {});
    if (!pub || (await mtime(LOCAL)) >= (await mtime(MANIFEST))) return normalize(local);

    // src/photos.json changed since the studio last saved (an older version of the
    // studio, or a git pull): it wins for what's on the site; keep the studio's extras.
    const lib = normalize(pub);
    const extra = normalize(local);
    const byFile = new Map(extra.photos.map((p) => [p.file, p]));
    for (const p of lib.photos) {
        const e = byFile.get(p.file);
        if (e?.dhash) p.dhash = e.dhash;
        if (e?.date && !p.date) p.date = e.date;
    }
    const onSite = new Set(lib.photos.map((p) => p.file));
    lib.photos.push(...extra.photos.filter((p) => p.hidden && !onSite.has(p.file)));
    for (const a of extra.albums) if (!lib.albums.some((b) => b.slug === a.slug)) lib.albums.push(a);
    return lib;
}

// One line per photo/album keeps git diffs readable.
const jsonLines = (lib) => {
    const list = (items) => (items.length ? `[\n${items.map((x) => '  ' + JSON.stringify(x)).join(',\n')}\n ]` : '[]');
    return `{\n "albums": ${list(lib.albums)},\n "photos": ${list(lib.photos)}\n}\n`;
};

async function writeIfChanged(file, text) {
    const prev = await fs.readFile(file, 'utf8').catch(() => '');
    if (text === prev) return false;
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, text);
    return true;
}

export async function writeLibrary(lib) {
    syncAlbums(lib);
    const shown = lib.photos.filter((p) => !p.hidden);
    const onSite = new Set(shown.map((p) => p.file));
    const pub = {
        albums: lib.albums
            .filter((a) => shown.some((p) => p.tags.includes(a.slug)))
            .map((a) => {
                const album = { slug: a.slug, title: a.title };
                const order = a.order?.filter((f) => onSite.has(f));
                if (order?.length) album.order = order;
                return album;
            }),
        photos: shown.map(({ file, w, h, tags, date }) => (date ? { file, w, h, tags, date } : { file, w, h, tags })),
    };
    const a = await writeIfChanged(MANIFEST, jsonLines(pub));
    const b = await writeIfChanged(LOCAL, jsonLines(lib));
    // keep the local file at least as new as the public one (see readLibrary)
    if (a && !b) await fs.utimes(LOCAL, new Date(), new Date()).catch(() => {});
    return a || b;
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

// Fills in what older photos are missing: the duplicate fingerprint (from the web
// copy) and the date taken (from the original in inbox/, if it's there).
export async function backfill() {
    const originals = new Map();
    const scan = async (dir, prefix) => {
        for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
            if (e.isFile() && IMAGE.test(e.name)) {
                originals.set(`${prefix}${slugify(path.parse(e.name).name) || 'photo'}.jpg`, path.join(dir, e.name));
            } else if (e.isDirectory() && !prefix && !e.name.startsWith('.') && !e.name.startsWith('_')) {
                await scan(path.join(dir, e.name), `${slugify(e.name)}-`);
            }
        }
    };
    await scan(INBOX, '');

    let filled = 0;
    await withLibrary(async (lib) => {
        for (const p of lib.photos) {
            if (!p.date && originals.has(p.file)) {
                const { date } = await inspect(originals.get(p.file));
                if (date) {
                    p.date = date;
                    filled++;
                }
            }
            if (!p.dhash) {
                try {
                    p.dhash = await dhash(fullPath(p));
                    filled++;
                } catch {
                    // no image library here; try again next time
                }
            }
        }
    });
    return filled;
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

// Commits everything that changed (photos, and any other edits; .gitignore'd files,
// like staging/, stay out) and pushes. GitHub Pages redeploys when src/ changed.
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
