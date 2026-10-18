#!/usr/bin/env node
// Brings the site's photo list up to date. The upload page
// (npm run serve -> http://localhost:8091/admin/) is the usual way to add photos;
// this is the drop-folder way, and a tidy-up.
//
//   inbox/                      <- optional: drop originals here (local only, never committed)
//     sunset.jpg                   added with no tags (shown under "all")
//     chicago/01.jpg               added with the tag "chicago"
//   src/photos/*.jpg            <- generated: 2048px web copies (+ thumbs/)
//   src/photos.json             <- the photos, their tags, album names and order
//
// It also drops photos.json entries whose image was deleted, adds images put in
// src/photos/ by hand, and moves the old folder-per-album layout over to tags.
//
// Usage: node scripts/build.mjs [--force] [--ship]
//   --force  regenerate every image from inbox/, even if it looks up to date
//   --ship   after building, commit src/ and push (what GitHub Pages deploys)

import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
    ROOT, INBOX, PHOTOS, THUMBS, IMAGE, UNSUPPORTED, collator, slugify,
    readLibrary, writeLibrary, resolveTags, makeWebCopies, describe, ensureShareImage,
} from './library.mjs';

export { INBOX };

const statOrNull = (p) => fs.stat(p).then((s) => s, () => null);

async function isFresh(outPath, srcStat) {
    const s = await statOrNull(outPath);
    return Boolean(s && s.mtimeMs >= srcStat.mtimeMs);
}

// photos.json <-> what's actually in src/photos/
async function reconcile(lib, stats) {
    const onDisk = new Set(
        (await fs.readdir(PHOTOS, { withFileTypes: true }).catch(() => []))
            .filter((e) => e.isFile() && /\.jpg$/i.test(e.name))
            .map((e) => e.name)
    );
    const before = lib.photos.length;
    lib.photos = lib.photos.filter((p) => onDisk.has(p.file));
    stats.dropped = before - lib.photos.length;

    const known = new Set(lib.photos.map((p) => p.file));
    for (const file of [...onDisk].sort(collator.compare)) {
        if (known.has(file)) continue;
        try {
            lib.photos.push({ file, ...(await describe(file)), tags: [] });
            stats.found++;
        } catch (err) {
            stats.failed.push(`src/photos/${file}: ${err.message}`);
        }
    }
}

// Loose files in inbox/ get no tags; files in inbox/<folder>/ get the folder's name as a tag.
async function ingest(lib, force, stats) {
    await fs.mkdir(INBOX, { recursive: true });
    const groups = [{ dir: INBOX, folder: null }];
    for (const e of await fs.readdir(INBOX, { withFileTypes: true })) {
        if (e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('_')) {
            groups.push({ dir: path.join(INBOX, e.name), folder: e.name });
        }
    }

    const added = [];
    for (const { dir, folder } of groups) {
        const files = (await fs.readdir(dir, { withFileTypes: true }))
            .filter((e) => e.isFile() && !e.name.startsWith('.'))
            .map((e) => e.name)
            .sort(collator.compare);

        for (const file of files) {
            const label = folder ? `${folder}/${file}` : file;
            if (UNSUPPORTED.test(file)) stats.unsupported.push(label);
            if (!IMAGE.test(file)) continue;

            const stem = slugify(path.parse(file).name) || 'photo';
            const name = `${folder ? `${slugify(folder)}-` : ''}${stem}.jpg`;
            const input = path.join(dir, file);
            const srcStat = await fs.stat(input);
            const existing = lib.photos.find((p) => p.file === name) || added.find((p) => p.file === name);

            if (existing && !force && (await isFresh(path.join(PHOTOS, name), srcStat)) && (await isFresh(path.join(THUMBS, name), srcStat))) {
                stats.skipped++;
                continue;
            }
            try {
                const size = await makeWebCopies(input, name);
                if (existing) Object.assign(existing, size); // keep its tags
                else added.push({ file: name, ...size, tags: folder ? resolveTags(lib, [folder]) : [] });
                stats.made++;
                console.log(`  + ${name}`);
            } catch (err) {
                stats.failed.push(`${label}: ${err.message}`);
            }
        }
    }
    lib.photos.unshift(...added); // newest first
}

export async function build({ force = false } = {}) {
    const stats = { made: 0, skipped: 0, found: 0, dropped: 0, failed: [], unsupported: [] };
    const lib = await readLibrary();
    await reconcile(lib, stats);
    await ingest(lib, force, stats);
    const changed = await writeLibrary(lib);
    await ensureShareImage(lib);

    const albums = lib.albums.length;
    console.log(
        `${stats.made} new from inbox, ${stats.skipped} unchanged — ${lib.photos.length} photos on the site` +
        (albums ? ` in ${albums} album${albums === 1 ? '' : 's'}` : '')
    );
    if (stats.found) console.log(`picked up ${stats.found} photo(s) found in src/photos/`);
    if (stats.dropped) console.log(`removed ${stats.dropped} missing photo(s) from the list`);
    if (stats.unsupported.length) {
        console.warn(`skipped (export these as JPEG first): ${stats.unsupported.join(', ')}`);
    }
    if (stats.failed.length) {
        console.warn(`could not process:\n  ${stats.failed.join('\n  ')}`);
    }
    return { changed: stats.made > 0 || changed, stats };
}

export function ship() {
    const git = (args, opts = {}) => execFileSync('git', args, { cwd: ROOT, stdio: 'inherit', ...opts });
    git(['add', '-A', '--', 'src']);
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
    if (args.includes('--ship')) ship();
}
