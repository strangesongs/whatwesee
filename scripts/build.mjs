#!/usr/bin/env node
// Turns the photos you drop into inbox/ into web-ready files for the site.
//
//   inbox/                      <- you drop photos here (local only, never committed)
//     sunset.jpg                   loose photo: shown in "all"
//     chicago/                     a folder becomes an album
//       01.jpg
//   src/photos/<album>/*.jpg    <- generated: 2048px web copies (+ thumbs/)
//   src/photos.json             <- generated: what the gallery page reads
//
// Usage: node scripts/build.mjs [--force] [--ship]
//   --force  regenerate every image, even if it looks up to date
//   --ship   after building, commit src/ and push (what GitHub Pages deploys)

import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const INBOX = path.join(ROOT, 'inbox');
const OUT = path.join(ROOT, 'src', 'photos');
const MANIFEST = path.join(ROOT, 'src', 'photos.json');

const FULL = 2048; // long edge of the viewer image
const THUMB = 800; // long edge of the grid image
const LOOSE = '_loose'; // photos dropped straight into inbox/

const IMAGE = /\.(jpe?g|png|webp|tiff?|gif|avif)$/i;
const UNSUPPORTED = /\.(heic|heif|raw|cr2|cr3|nef|arw|dng|psd)$/i;
const collator = new Intl.Collator('en', { numeric: true });

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'photo';
const statOrNull = (p) => fs.stat(p).then((s) => s, () => null);
const isHidden = (name) => name.startsWith('.') || name.startsWith('_');

async function isFresh(outPath, srcStat) {
    const s = await statOrNull(outPath);
    return Boolean(s && s.mtimeMs >= srcStat.mtimeMs);
}

async function ingestFolder(srcDir, slug, force, stats) {
    const entries = await fs.readdir(srcDir, { withFileTypes: true });
    const files = entries.filter((e) => e.isFile() && !e.name.startsWith('.'));

    for (const f of files) {
        if (UNSUPPORTED.test(f.name)) stats.unsupported.push(path.join(path.basename(srcDir), f.name));
    }

    const names = files.map((e) => e.name).filter((n) => IMAGE.test(n)).sort(collator.compare);
    const used = new Set();

    for (const file of names) {
        const base = slugify(path.parse(file).name);
        let name = base;
        for (let n = 2; used.has(name); n++) name = `${base}-${n}`;
        used.add(name);

        const input = path.join(srcDir, file);
        const srcStat = await fs.stat(input);
        const out = path.join(OUT, slug, `${name}.jpg`);
        const thumb = path.join(OUT, slug, 'thumbs', `${name}.jpg`);

        if (!force && (await isFresh(out, srcStat)) && (await isFresh(thumb, srcStat))) {
            stats.skipped++;
            continue;
        }

        try {
            await fs.mkdir(path.dirname(thumb), { recursive: true });
            // rotate() bakes in the EXIF orientation; sharp drops all metadata
            // (including GPS location) from the output by default.
            const make = (size, dest, quality) =>
                sharp(input, { failOn: 'none' })
                    .rotate()
                    .resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
                    .jpeg({ quality, mozjpeg: true })
                    .toFile(dest);
            await make(FULL, out, 82);
            await make(THUMB, thumb, 78);
            stats.made++;
            console.log(`  + ${slug === LOOSE ? '' : slug + '/'}${name}.jpg`);
        } catch (err) {
            stats.failed.push(`${path.basename(srcDir)}/${file}: ${err.message}`);
        }
    }
}

async function ingest(force) {
    const stats = { made: 0, skipped: 0, failed: [], unsupported: [] };
    await fs.mkdir(INBOX, { recursive: true });

    await ingestFolder(INBOX, LOOSE, force, stats);

    const entries = await fs.readdir(INBOX, { withFileTypes: true });
    for (const e of entries) {
        if (!e.isDirectory() || isHidden(e.name)) continue;
        await ingestFolder(path.join(INBOX, e.name), slugify(e.name), force, stats);
    }
    return stats;
}

async function readJson(file, fallback) {
    try {
        return JSON.parse(await fs.readFile(file, 'utf8'));
    } catch {
        return fallback;
    }
}

async function writeManifest() {
    const dirs = (await fs.readdir(OUT, { withFileTypes: true }).catch(() => []))
        .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
        .map((d) => d.name);

    const order = await readJson(path.join(OUT, 'order.json'), []);
    const rank = (s) => (s === LOOSE ? -1 : order.includes(s) ? order.indexOf(s) : 1e6);
    dirs.sort((a, b) => rank(a) - rank(b) || collator.compare(a, b));

    const albums = [];
    for (const slug of dirs) {
        const dir = path.join(OUT, slug);
        const files = (await fs.readdir(dir)).filter((f) => /\.jpg$/i.test(f)).sort(collator.compare);
        if (!files.length) continue;

        const photos = [];
        for (const file of files) {
            const m = await sharp(path.join(dir, file)).metadata();
            photos.push({ file, w: m.width, h: m.height });
        }
        const meta = await readJson(path.join(dir, 'album.json'), {});
        albums.push({ slug, title: meta.title || (slug === LOOSE ? 'unsorted' : slug), photos });
    }

    const next = JSON.stringify({ albums }, null, 1) + '\n';
    const prev = await fs.readFile(MANIFEST, 'utf8').catch(() => '');
    if (next === prev) return { changed: false, albums };
    await fs.writeFile(MANIFEST, next);
    return { changed: true, albums };
}

export async function build({ force = false } = {}) {
    const stats = await ingest(force);
    const manifest = await writeManifest();

    const total = manifest.albums.reduce((n, a) => n + a.photos.length, 0);
    const named = manifest.albums.filter((a) => a.slug !== LOOSE).length;
    console.log(
        `${stats.made} new, ${stats.skipped} unchanged — ${total} photos on the site` +
        (named ? ` in ${named} album${named === 1 ? '' : 's'}` : '')
    );
    if (stats.unsupported.length) {
        console.warn(`skipped (export these as JPEG first): ${stats.unsupported.join(', ')}`);
    }
    if (stats.failed.length) {
        console.warn(`could not process:\n  ${stats.failed.join('\n  ')}`);
    }
    return { changed: stats.made > 0 || manifest.changed, stats };
}

export function ship() {
    const git = (args, opts = {}) => execFileSync('git', args, { cwd: ROOT, stdio: 'inherit', ...opts });
    git(['add', '--', 'src']);
    try {
        execFileSync('git', ['diff', '--cached', '--quiet', '--', 'src'], { cwd: ROOT });
        console.log('nothing new to publish');
        return;
    } catch {
        // staged changes exist
    }
    git(['commit', '-m', 'update photos', '--', 'src']);
    git(['push']);
    console.log('pushed — the site updates in a minute or two');
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
    const args = process.argv.slice(2);
    const result = await build({ force: args.includes('--force') });
    if (args.includes('--ship') && result.changed) ship();
}
