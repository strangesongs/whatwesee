// Upload page: add photos with tags, retag, reorder, rename albums, publish.
// Talks to the small API in scripts/serve.mjs.
(() => {
    'use strict';

    const $ = (id) => document.getElementById(id);
    const IMAGE = /\.(jpe?g|png|webp|tiff?|gif|avif)$/i;
    const UNSUPPORTED = /\.(heic|heif|raw|cr2|cr3|nef|arw|dng|psd)$/i;
    const UNTAGGED = '\u0000untagged';

    let lib = { albums: [], photos: [] };
    let queue = []; // { file, url, state: 'ready'|'uploading'|'error', note }
    let busy = false;
    let filter = ''; // '' = all, UNTAGGED, or a tag slug
    const selected = new Set();
    let dragging = null;

    const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const albumFor = (text) => {
        const t = String(text).trim();
        const lower = t.toLowerCase();
        return lib.albums.find((a) => a.slug === t) ||
            lib.albums.find((a) => a.title.toLowerCase() === lower) ||
            lib.albums.find((a) => a.slug === slugify(t));
    };
    const titleOf = (tag) => albumFor(tag)?.title || tag;
    const keyOf = (tag) => albumFor(tag)?.slug || slugify(tag);
    const el = (tag, props = {}, ...kids) => {
        const node = Object.assign(document.createElement(tag), props);
        node.append(...kids.filter((k) => k !== null && k !== undefined));
        return node;
    };

    /* Server */

    async function api(path, body, raw) {
        const opts = body === undefined ? {} : {
            method: 'POST',
            body: raw ? body : JSON.stringify(body),
            headers: raw ? {} : { 'content-type': 'application/json' },
        };
        let res;
        try {
            res = await fetch(path, opts);
        } catch {
            throw new Error('the uploader has stopped — close this window and open whatwesee studio again');
        }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `error ${res.status}`);
        return data;
    }

    let toastTimer = null;
    function toast(message, isError) {
        const t = $('toast');
        t.textContent = message;
        t.classList.toggle('is-error', Boolean(isError));
        t.hidden = false;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { t.hidden = true; }, isError ? 7000 : 3500);
    }

    async function refreshStatus() {
        try {
            const { unpublished } = await api('/api/status');
            $('pub-status').textContent = unpublished ? 'changes not on the live site yet' : 'live site is up to date';
            $('publish').disabled = !unpublished;
        } catch {
            $('pub-status').textContent = 'uploader stopped — reopen whatwesee studio';
            $('publish').disabled = true;
        }
    }

    // keepCards: a single photo's tags changed from its own card; don't rebuild the grid
    function setLibrary(next, { keepCards = false } = {}) {
        lib = next;
        const files = new Set(lib.photos.map((p) => p.file));
        [...selected].forEach((f) => { if (!files.has(f)) selected.delete(f); });
        if (filter && filter !== UNTAGGED && !lib.albums.some((a) => a.slug === filter)) filter = '';
        renderDatalist();
        renderAlbums();
        renderFilter();
        if (keepCards) updateCounts();
        else renderLibrary();
        renderBulk();
        refreshStatus();
    }

    /* Tag field: chips + a text box with suggestions from existing albums */

    function tagField(container, { value = [], compact = false, placeholder = 'add a tag', onChange }) {
        let tags = [...value];
        container.classList.add('tagfield');
        container.classList.toggle('is-compact', compact);
        container.textContent = '';
        const input = el('input', {
            type: 'text',
            placeholder,
            autocomplete: 'off',
            spellcheck: false,
            enterKeyHint: 'done',
        });
        input.setAttribute('list', 'known-tags');
        input.setAttribute('aria-label', placeholder);
        container.append(input);

        const render = () => {
            container.querySelectorAll('.chip').forEach((c) => c.remove());
            tags.forEach((t, i) => {
                const x = el('button', { type: 'button', textContent: '×', title: 'remove tag' });
                x.setAttribute('aria-label', `remove tag ${titleOf(t)}`);
                x.addEventListener('click', (e) => {
                    e.stopPropagation();
                    tags.splice(i, 1);
                    render();
                    onChange?.([...tags]);
                });
                container.insertBefore(el('span', { className: 'chip' }, titleOf(t), x), input);
            });
        };

        const commit = () => {
            const texts = input.value.split(',').map((s) => s.trim()).filter(Boolean);
            input.value = '';
            let changed = false;
            for (const text of texts) {
                const key = keyOf(text);
                if (!key || tags.some((t) => keyOf(t) === key)) continue;
                tags.push(albumFor(text)?.slug || text);
                changed = true;
            }
            if (changed) {
                render();
                onChange?.([...tags]);
            }
            return changed;
        };

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                commit();
            } else if (e.key === 'Backspace' && !input.value && tags.length) {
                tags.pop();
                render();
                onChange?.([...tags]);
            }
        });
        // picking a suggestion from the list
        input.addEventListener('input', (e) => {
            if (!e.inputType || e.inputType === 'insertReplacementText') commit();
        });
        input.addEventListener('blur', commit);
        container.addEventListener('click', (e) => {
            if (e.target === container) input.focus();
        });
        render();

        return {
            get: () => { commit(); return [...tags]; },
            clear: () => { tags = []; input.value = ''; render(); },
        };
    }

    /* Albums + filter */

    function renderDatalist() {
        $('known-tags').replaceChildren(...lib.albums.map((a) => el('option', { value: a.title })));
    }

    const countFor = (slug) =>
        slug === '' ? lib.photos.length
            : slug === UNTAGGED ? lib.photos.filter((p) => !p.tags.length).length
                : lib.photos.filter((p) => p.tags.includes(slug)).length;

    async function saveAlbums(albums) {
        try {
            setLibrary(await api('/api/albums', { albums }));
        } catch (err) {
            toast(err.message, true);
            renderAlbums();
        }
    }

    function renderAlbums() {
        const ol = $('albums');
        if (ol.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return; // don't yank a name being edited
        ol.replaceChildren(...lib.albums.map((a, i) => {
            const name = el('input', { type: 'text', value: a.title, spellcheck: false });
            name.setAttribute('aria-label', `name of album ${a.title}`);
            const save = () => {
                const title = name.value.trim();
                if (!title) { name.value = a.title; return; }
                if (title === a.title) return;
                saveAlbums(lib.albums.map((x) => (x.slug === a.slug ? { ...x, title } : x)));
            };
            name.addEventListener('change', save);
            name.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') name.blur();
                if (e.key === 'Escape') { name.value = a.title; name.blur(); }
            });
            const move = (d, label) => {
                const b = el('button', { type: 'button', textContent: d < 0 ? '↑' : '↓', title: label, disabled: i + d < 0 || i + d >= lib.albums.length });
                b.setAttribute('aria-label', `${label}: ${a.title}`);
                b.addEventListener('click', () => {
                    const next = [...lib.albums];
                    [next[i], next[i + d]] = [next[i + d], next[i]];
                    saveAlbums(next);
                });
                return b;
            };
            return el('li', { className: 'album' },
                name,
                el('span', { className: 'n', textContent: countFor(a.slug), title: 'photos' }),
                el('span', { className: 'moves' }, move(-1, 'move up'), move(1, 'move down')));
        }));
    }

    function renderFilter() {
        const items = [
            { key: '', label: 'all' },
            { key: UNTAGGED, label: 'untagged' },
            ...lib.albums.map((a) => ({ key: a.slug, label: a.title })),
        ];
        $('filter').replaceChildren(...items.map(({ key, label }) => {
            const b = el('button', { type: 'button' }, label, el('span', { className: 'n', textContent: countFor(key) }));
            b.setAttribute('aria-pressed', String(filter === key));
            b.addEventListener('click', () => {
                filter = key;
                renderFilter();
                renderLibrary();
            });
            return b;
        }));
    }

    function updateCounts() {
        renderFilter();
        $('count').textContent = `· ${lib.photos.length}`;
    }

    /* Library grid */

    // same rule as albumPhotos() in scripts/library.mjs and src/app.js
    function albumPhotos(slug) {
        const album = lib.albums.find((a) => a.slug === slug);
        const tagged = lib.photos.filter((p) => p.tags.includes(slug));
        if (!album?.order) return tagged;
        const rank = new Map(album.order.map((f, i) => [f, i]));
        return [...tagged.filter((p) => !rank.has(p.file)),
            ...tagged.filter((p) => rank.has(p.file)).sort((a, b) => rank.get(a.file) - rank.get(b.file))];
    }

    const isAlbum = () => filter !== '' && filter !== UNTAGGED;
    const shown = () =>
        filter === '' ? lib.photos
            : filter === UNTAGGED ? lib.photos.filter((p) => !p.tags.length)
                : albumPhotos(filter);

    async function removePhotos(files) {
        try {
            setLibrary(await api('/api/delete', { files }));
            toast(files.length === 1 ? 'taken off the site' : `${files.length} photos taken off the site`);
        } catch (err) {
            toast(err.message, true);
        }
    }

    function card(p) {
        const c = el('div', { className: 'card' });
        c.dataset.file = p.file;
        c.classList.toggle('is-selected', selected.has(p.file));

        const frame = el('button', { type: 'button', className: 'frame', draggable: true, title: p.file },
            el('img', { src: `/photos/thumbs/${encodeURIComponent(p.file)}`, alt: '', loading: 'lazy', decoding: 'async' }),
            el('span', { className: 'tick', textContent: '✓', ariaHidden: 'true' }));
        frame.setAttribute('aria-pressed', String(selected.has(p.file)));
        frame.setAttribute('aria-label', `select ${p.file}`);
        frame.addEventListener('click', () => {
            if (selected.has(p.file)) selected.delete(p.file);
            else selected.add(p.file);
            c.classList.toggle('is-selected', selected.has(p.file));
            frame.setAttribute('aria-pressed', String(selected.has(p.file)));
            renderBulk();
        });

        // drag to reorder
        frame.addEventListener('dragstart', (e) => {
            dragging = p.file;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', p.file);
            requestAnimationFrame(() => c.classList.add('is-dragging'));
        });
        frame.addEventListener('dragend', () => {
            dragging = null;
            document.querySelectorAll('.is-dragging, .drop-before, .drop-after')
                .forEach((n) => n.classList.remove('is-dragging', 'drop-before', 'drop-after'));
        });
        const side = (e) => {
            const r = c.getBoundingClientRect();
            return e.clientX < r.left + r.width / 2 ? 'before' : 'after';
        };
        c.addEventListener('dragover', (e) => {
            if (!dragging || dragging === p.file) return;
            e.preventDefault();
            const s = side(e);
            c.classList.toggle('drop-before', s === 'before');
            c.classList.toggle('drop-after', s === 'after');
        });
        c.addEventListener('dragleave', () => c.classList.remove('drop-before', 'drop-after'));
        c.addEventListener('drop', async (e) => {
            if (!dragging || dragging === p.file) return;
            e.preventDefault();
            const moved = dragging;
            // in an album: that album's own order; otherwise the order of "all"
            const base = isAlbum() ? albumPhotos(filter) : lib.photos;
            const order = base.map((x) => x.file).filter((f) => f !== moved);
            const at = order.indexOf(p.file) + (side(e) === 'after' ? 1 : 0);
            order.splice(at, 0, moved);
            try {
                setLibrary(await api('/api/order', isAlbum() ? { files: order, album: filter } : { files: order }));
            } catch (err) {
                toast(err.message, true);
            }
        });

        const remove = el('button', { type: 'button', className: 'link remove', textContent: 'remove' });
        let armed = null;
        remove.addEventListener('click', () => {
            if (!armed) {
                remove.textContent = 'take off site?';
                remove.classList.add('is-armed');
                armed = setTimeout(() => {
                    armed = null;
                    remove.textContent = 'remove';
                    remove.classList.remove('is-armed');
                }, 3000);
                return;
            }
            clearTimeout(armed);
            removePhotos([p.file]);
        });

        const view = el('a', { href: `/#photo/${encodeURIComponent(p.file)}`, target: '_blank', rel: 'noopener', textContent: 'view' });
        const tags = el('div');
        tagField(tags, {
            value: p.tags,
            compact: true,
            placeholder: p.tags.length ? '+ tag' : 'add a tag',
            onChange: async (next) => {
                try {
                    setLibrary(await api('/api/photo', { file: p.file, tags: next }), { keepCards: true });
                    p.tags = lib.photos.find((x) => x.file === p.file)?.tags || [];
                    if (filter && !shown().some((x) => x.file === p.file)) renderLibrary();
                } catch (err) {
                    toast(err.message, true);
                    renderLibrary(); // put the tags back as they really are
                }
            },
        });

        c.append(frame, el('div', { className: 'meta' }, el('span', { className: 'name', textContent: p.file }), view, remove), tags);
        return c;
    }

    function renderLibrary() {
        const photos = shown();
        const title = isAlbum() ? (lib.albums.find((a) => a.slug === filter)?.title || filter) : '';
        $('lib-hint').textContent = isAlbum()
            ? `drag to set the order of “${title}” (only this album changes). click a photo to select it.`
            : filter === UNTAGGED
                ? 'click photos to select them, then give them tags above.'
                : 'drag photos to set the order of “all”. click a photo to select it for tagging in bulk.';
        $('library').replaceChildren(...photos.map(card));
        $('library').classList.toggle('is-selecting', selected.size > 0);
        $('count').textContent = `· ${lib.photos.length}`;
        const empty = $('empty');
        empty.hidden = photos.length > 0;
        empty.textContent = lib.photos.length ? 'nothing here.' : 'no photos yet — add some on the left.';
    }

    /* Bulk tagging */

    let bulkField = null;
    function renderBulk() {
        const n = selected.size;
        $('bulk').hidden = n === 0;
        $('library').classList.toggle('is-selecting', n > 0);
        $('sel-count').textContent = `${n} selected`;
    }

    async function bulk(kind) {
        const files = [...selected];
        const tags = bulkField.get();
        if (!tags.length) {
            toast('type the tags first');
            return;
        }
        try {
            const body = kind === 'add' ? { files, add: tags } : { files, remove: tags.map(keyOf) };
            setLibrary(await api('/api/tags', body));
            bulkField.clear();
            toast(`${kind === 'add' ? 'tagged' : 'untagged'} ${files.length} photo${files.length === 1 ? '' : 's'}`);
        } catch (err) {
            toast(err.message, true);
        }
    }

    let bulkDeleteArmed = null;
    function bulkDelete() {
        const b = $('bulk-delete');
        if (!bulkDeleteArmed) {
            b.textContent = `really take ${selected.size} off?`;
            bulkDeleteArmed = setTimeout(() => {
                bulkDeleteArmed = null;
                b.textContent = 'take off site';
            }, 3000);
            return;
        }
        clearTimeout(bulkDeleteArmed);
        bulkDeleteArmed = null;
        b.textContent = 'take off site';
        removePhotos([...selected]);
    }

    /* Upload queue */

    let batchField = null;

    function addFiles(files) {
        for (const file of files) {
            if (queue.some((q) => q.file.name === file.name && q.file.size === file.size)) continue;
            const item = { file, url: null, state: 'ready', note: '' };
            if (UNSUPPORTED.test(file.name)) {
                item.state = 'error';
                item.note = 'export as JPEG first — this format can’t be read';
            } else if (!IMAGE.test(file.name)) {
                item.state = 'error';
                item.note = 'not a photo';
            } else {
                item.url = URL.createObjectURL(file);
                const stem = slugify(file.name.replace(/\.[^.]+$/, '')) || 'photo';
                if (lib.photos.some((p) => p.file === `${stem}.jpg`)) item.note = 'a photo with this name is already on the site';
            }
            queue.push(item);
        }
        renderQueue();
    }

    function renderQueue() {
        $('queue').replaceChildren(...queue.map((item) => {
            const x = el('button', { type: 'button', className: 'x', textContent: '×', title: 'remove from list', disabled: busy });
            x.setAttribute('aria-label', `remove ${item.file.name} from list`);
            x.addEventListener('click', () => {
                if (item.url) URL.revokeObjectURL(item.url);
                queue = queue.filter((q) => q !== item);
                renderQueue();
            });
            const thumb = item.url ? el('img', { className: 'qthumb', src: item.url, alt: '' }) : el('span', { className: 'qthumb' });
            const note = item.state === 'uploading' ? 'uploading…' : item.note;
            return el('li', { className: `qitem is-${item.state}` },
                thumb,
                el('span', { className: 'qname', textContent: item.file.name },
                    note ? el('span', { className: 'qnote', textContent: note }) : null),
                x);
        }));
        const ready = queue.filter((q) => q.state !== 'error' || q.retry).length;
        $('batch').hidden = queue.length === 0;
        const up = $('upload');
        up.disabled = busy || ready === 0;
        up.textContent = busy ? 'uploading…' : `upload ${ready} photo${ready === 1 ? '' : 's'}`;
    }

    async function upload() {
        if (busy) return;
        const tags = batchField.get();
        const items = queue.filter((q) => q.state !== 'error' || q.retry);
        if (!items.length) return;
        busy = true;
        let done = 0;
        for (const item of items) {
            item.state = 'uploading';
            renderQueue();
            try {
                const params = new URLSearchParams({ name: item.file.name, tags: JSON.stringify(tags), at: String(done) });
                setLibrary(await api(`/api/upload?${params}`, item.file, true));
                done++;
                if (item.url) URL.revokeObjectURL(item.url);
                queue = queue.filter((q) => q !== item);
            } catch (err) {
                item.state = 'error';
                item.retry = true;
                item.note = err.message;
            }
            renderQueue();
        }
        busy = false;
        renderQueue();
        if (done) {
            const where = tags.length ? ` to ${tags.map(titleOf).join(', ')}` : '';
            toast(`added ${done} photo${done === 1 ? '' : 's'}${where}`);
            if (!queue.length) batchField.clear();
            if (filter && filter !== UNTAGGED && !tags.map(keyOf).includes(filter)) {
                filter = '';
                renderFilter();
                renderLibrary();
            }
        }
        const failed = queue.filter((q) => q.state === 'error' && q.retry).length;
        if (failed) toast(`${failed} photo${failed === 1 ? '' : 's'} didn’t upload — see the list`, true);
    }

    /* Events */

    const drop = $('drop');
    $('pick').addEventListener('change', (e) => {
        addFiles(e.target.files);
        e.target.value = '';
    });
    ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => {
        if (!e.dataTransfer?.types.includes('Files')) return;
        e.preventDefault();
        drop.classList.add('is-over');
    }));
    ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, () => drop.classList.remove('is-over')));
    drop.addEventListener('drop', (e) => {
        if (!e.dataTransfer?.files.length) return;
        e.preventDefault();
        addFiles(e.dataTransfer.files);
    });
    // files dropped anywhere else on the page go to the queue too (instead of the browser opening them)
    window.addEventListener('dragover', (e) => {
        if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    });
    window.addEventListener('drop', (e) => {
        if (!e.dataTransfer?.files.length) return;
        e.preventDefault();
        addFiles(e.dataTransfer.files);
    });

    $('upload').addEventListener('click', upload);
    $('bulk-add').addEventListener('click', () => bulk('add'));
    $('bulk-remove').addEventListener('click', () => bulk('remove'));
    $('bulk-delete').addEventListener('click', bulkDelete);
    $('bulk-clear').addEventListener('click', () => {
        selected.clear();
        renderLibrary();
        renderBulk();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && selected.size && !(e.target instanceof HTMLInputElement)) {
            selected.clear();
            renderLibrary();
            renderBulk();
        }
    });

    $('publish').addEventListener('click', async () => {
        const b = $('publish');
        b.disabled = true;
        b.textContent = 'publishing…';
        try {
            const { message } = await api('/api/publish', {});
            toast(message);
        } catch (err) {
            toast(err.message, true);
        }
        b.textContent = 'publish';
        refreshStatus();
    });

    window.addEventListener('beforeunload', (e) => {
        if (busy || queue.some((q) => q.state === 'ready')) e.preventDefault();
    });

    batchField = tagField($('batch-tags'), { placeholder: 'e.g. chicago' });
    bulkField = tagField($('bulk-tags'), { placeholder: 'tags for the selected photos' });

    // also tells the server the page is still open (it quits a while after the page closes)
    setInterval(refreshStatus, 60_000);

    api('/api/library')
        .then((data) => setLibrary(data))
        .catch((err) => toast(err.message, true));
})();
