#!/usr/bin/env node
// Local preview server for src/, plus the upload page (no dependencies besides sharp).
//   npm run serve            -> site:        http://localhost:8091
//                               upload/tag:  http://localhost:8091/admin/
//   PORT=8092 npm run serve  -> pick another port
//
// Only reachable from this computer. The upload page lives in scripts/admin/,
// outside src/, so it's never published.

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    SRC, PHOTOS, THUMBS, IMAGE, UNSUPPORTED,
    withLibrary, readLibrary, resolveTags, makeWebCopies, uniqueName, ensureShareImage,
    hasUnpublished, publish,
} from './library.mjs';

const ADMIN = path.join(path.dirname(fileURLToPath(import.meta.url)), 'admin');
const PORT = Number(process.env.PORT) || 8091;
const HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);
const ORIGINS = new Set([...HOSTS].map((h) => `http://${h}`));
const MAX_UPLOAD = 300 * 1024 * 1024;

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.woff': 'font/woff',
    '.txt': 'text/plain; charset=utf-8',
};

class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

const sendJson = (res, status, data) =>
    res.writeHead(status, { 'content-type': TYPES['.json'], 'cache-control': 'no-store' }).end(JSON.stringify(data));

async function readBody(req, limit) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > limit) throw new HttpError(413, 'file is too large');
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}

async function readJson(req) {
    try {
        return JSON.parse((await readBody(req, 1e6)).toString('utf8') || '{}');
    } catch (err) {
        throw err instanceof HttpError ? err : new HttpError(400, 'bad request');
    }
}

const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);

function findPhoto(lib, file) {
    const p = lib.photos.find((x) => x.file === file);
    if (!p) throw new HttpError(404, `${file} is not on the site`);
    return p;
}

/* API used by scripts/admin/ */

const routes = {
    'GET /api/library': () => readLibrary(),

    'GET /api/status': async () => ({ unpublished: await hasUnpublished().catch(() => false) }),

    // body: the image file itself. ?name=<original file name>&tags=<json list>&at=<position>
    'POST /api/upload': async (req, url) => {
        const original = url.searchParams.get('name') || 'photo.jpg';
        if (UNSUPPORTED.test(original)) {
            throw new HttpError(415, `${path.extname(original).slice(1).toUpperCase()} files can't be read here — export as JPEG first`);
        }
        if (!IMAGE.test(original)) throw new HttpError(415, 'not a photo (use JPEG, PNG, WebP, TIFF)');
        let tags;
        try {
            tags = list(JSON.parse(url.searchParams.get('tags') || '[]'));
        } catch {
            throw new HttpError(400, 'bad tags');
        }
        const at = Math.max(0, Number(url.searchParams.get('at')) || 0);
        const body = await readBody(req, MAX_UPLOAD);
        if (!body.length) throw new HttpError(400, 'empty file');

        const lib = await withLibrary(async (lib) => {
            const file = await uniqueName(lib, path.parse(original).name);
            let size;
            try {
                size = await makeWebCopies(body, file);
            } catch (err) {
                await fs.rm(path.join(PHOTOS, file), { force: true });
                await fs.rm(path.join(THUMBS, file), { force: true });
                throw new HttpError(422, `couldn't read this image (${String(err.message).split('\n')[0]})`);
            }
            lib.photos.splice(Math.min(at, lib.photos.length), 0, { file, ...size, tags: resolveTags(lib, tags) });
        });
        await ensureShareImage(lib).catch(() => {});
        return lib;
    },

    // { file, tags }: replace one photo's tags
    'POST /api/photo': async (req) => {
        const { file, tags } = await readJson(req);
        return withLibrary((lib) => {
            findPhoto(lib, file).tags = resolveTags(lib, list(tags));
        });
    },

    // { files, add, remove }: add/remove tags on several photos
    'POST /api/tags': async (req) => {
        const body = await readJson(req);
        return withLibrary((lib) => {
            const add = resolveTags(lib, list(body.add));
            const remove = new Set(list(body.remove));
            for (const file of list(body.files)) {
                const p = findPhoto(lib, file);
                p.tags = [...new Set([...p.tags.filter((t) => !remove.has(t)), ...add])];
            }
        });
    },

    // { files }: take photos off the site
    'POST /api/delete': async (req) => {
        const { files } = await readJson(req);
        return withLibrary(async (lib) => {
            for (const file of list(files)) {
                findPhoto(lib, file);
                await fs.rm(path.join(PHOTOS, file), { force: true });
                await fs.rm(path.join(THUMBS, file), { force: true });
                lib.photos = lib.photos.filter((p) => p.file !== file);
            }
        });
    },

    // { files, album? }: new photo order, for "all" or (with album) just that album
    'POST /api/order': async (req) => {
        const { files, album } = await readJson(req);
        return withLibrary((lib) => {
            const wanted = list(files).map((f) => findPhoto(lib, f));
            if (album) {
                const a = lib.albums.find((x) => x.slug === album);
                if (!a) throw new HttpError(404, 'no such album');
                a.order = wanted.filter((p) => p.tags.includes(album)).map((p) => p.file);
            } else {
                lib.photos = [...wanted, ...lib.photos.filter((p) => !wanted.includes(p))];
            }
        });
    },

    // { albums: [{ slug, title }] }: album names and sidebar order
    'POST /api/albums': async (req) => {
        const body = await readJson(req);
        return withLibrary((lib) => {
            const given = Array.isArray(body.albums) ? body.albums : [];
            const next = [];
            for (const a of given) {
                const album = lib.albums.find((x) => x.slug === a?.slug);
                if (!album || next.includes(album)) continue;
                const title = String(a.title ?? '').trim().replace(/\s+/g, ' ');
                if (title) album.title = title;
                next.push(album);
            }
            lib.albums = [...next, ...lib.albums.filter((a) => !next.includes(a))];
        });
    },

    'POST /api/publish': async () => {
        try {
            return { message: await publish() };
        } catch (err) {
            const detail = (err.stderr || err.message || '').trim().split('\n').slice(-3).join(' ');
            throw new HttpError(500, `publishing failed: ${detail}`);
        }
    },
};

async function handleApi(req, res, url) {
    if (req.method !== 'GET' && !ORIGINS.has(req.headers.origin)) throw new HttpError(403, 'forbidden');
    const route = routes[`${req.method} ${url.pathname}`];
    if (!route) throw new HttpError(404, 'not found');
    sendJson(res, 200, await route(req, url));
}

/* Static files */

async function serveFile(res, root, pathname) {
    if (pathname.endsWith('/')) pathname += 'index.html';
    const file = path.normalize(path.join(root, pathname));
    if (!file.startsWith(root + path.sep)) throw new HttpError(403, 'forbidden');
    let data;
    try {
        data = await fs.readFile(file);
    } catch {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
        return;
    }
    res.writeHead(200, {
        'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'no-cache',
    });
    res.end(data);
}

// Started by the whatwesee studio app with IDLE_MINUTES set: quit once the upload
// page has been closed that long (the open page checks in every minute).
const IDLE_MINUTES = Number(process.env.IDLE_MINUTES) || 0;
let lastSeen = Date.now();
let active = 0;
if (IDLE_MINUTES) {
    setInterval(() => {
        if (!active && Date.now() - lastSeen > IDLE_MINUTES * 60_000) {
            console.log(`${new Date().toISOString()} closing: upload page not open for ${IDLE_MINUTES} min`);
            process.exit(0);
        }
    }, 30_000).unref();
}

const server = http.createServer(async (req, res) => {
    lastSeen = Date.now();
    active++;
    res.on('close', () => {
        active--;
        lastSeen = Date.now();
    });
    try {
        // only answer to this computer's own address (blocks other sites from reaching the API)
        if (!HOSTS.has(req.headers.host)) throw new HttpError(403, 'forbidden');
        const url = new URL(req.url, `http://${req.headers.host}`);
        let pathname;
        try {
            pathname = decodeURIComponent(url.pathname);
        } catch {
            throw new HttpError(400, 'bad request');
        }

        if (pathname.startsWith('/api/')) return await handleApi(req, res, url);
        if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method not allowed');
        if (pathname === '/admin') {
            res.writeHead(302, { location: '/admin/' }).end();
            return;
        }
        if (pathname.startsWith('/admin/')) return await serveFile(res, ADMIN, pathname.slice('/admin'.length));
        await serveFile(res, SRC, pathname);
    } catch (err) {
        const status = err.status || 500;
        if (status === 500) console.error(err);
        if (!res.headersSent) sendJson(res, status, { error: err.status ? err.message : `something went wrong: ${err.message}` });
        else res.end();
    }
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use. Try: PORT=8092 npm run serve`);
        process.exit(1);
    }
    throw err;
});

for (const sig of ['SIGTERM', 'SIGHUP', 'SIGINT']) {
    process.on(sig, () => {
        console.log(`${new Date().toISOString()} stopped (${sig})`);
        process.exit(0);
    });
}
process.on('uncaughtException', (err) => {
    console.error(`${new Date().toISOString()} crashed:`, err);
    process.exit(1);
});

// moves an old folder-per-album layout over to tags before anything reads photos.json
await readLibrary().catch((err) => console.error(`couldn't read src/photos.json: ${err.message}`));

server.listen(PORT, '127.0.0.1', () => {
    console.log(`${new Date().toISOString()} started`);
    console.log(`site:          http://localhost:${PORT}`);
    console.log(`upload & tag:  http://localhost:${PORT}/admin/`);
    console.log('(Ctrl+C to stop)');
});
