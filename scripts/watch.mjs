#!/usr/bin/env node
// Watches inbox/ and rebuilds when photos are added.
//   node scripts/watch.mjs          rebuild only
//   node scripts/watch.mjs --ship   rebuild, then commit and push

import fs from 'node:fs';
import { build, ship, INBOX } from './build.mjs';

const shipToo = process.argv.includes('--ship');
const SETTLE_MS = 4000; // wait for big copies to finish before building

fs.mkdirSync(INBOX, { recursive: true });

let timer = null;
let running = false;
let again = false;

async function run() {
    if (running) {
        again = true;
        return;
    }
    running = true;
    try {
        const result = await build();
        if (shipToo && result.changed) ship();
    } catch (err) {
        console.error(err);
    } finally {
        running = false;
        if (again) {
            again = false;
            run();
        }
    }
}

fs.watch(INBOX, { recursive: true }, (_event, name) => {
    if (name && name.endsWith('.DS_Store')) return;
    clearTimeout(timer);
    timer = setTimeout(run, SETTLE_MS);
});

console.log(`watching ${INBOX}${shipToo ? ' (will publish)' : ''} — drop photos in, Ctrl+C to stop`);
run();
