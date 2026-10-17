#!/usr/bin/env node
// Tiny local preview server for src/ (no dependencies).
//   npm run serve            -> http://localhost:8091
//   PORT=8092 npm run serve  -> pick another port

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const PORT = Number(process.env.PORT) || 8091;

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer((req, res) => {
    let pathname;
    try {
        pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
        res.writeHead(400).end('bad request');
        return;
    }
    if (pathname.endsWith('/')) pathname += 'index.html';

    const file = path.normalize(path.join(ROOT, pathname));
    if (!file.startsWith(ROOT + path.sep)) {
        res.writeHead(403).end('forbidden');
        return;
    }

    fs.readFile(file, (err, data) => {
        if (err) {
            res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
            return;
        }
        res.writeHead(200, {
            'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
            'cache-control': 'no-cache',
        });
        res.end(data);
    });
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use. Try: PORT=8092 npm run serve`);
        process.exit(1);
    }
    throw err;
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`Open http://localhost:${PORT}  (Ctrl+C to stop)`);
});
