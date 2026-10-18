// Upload page: add photos with tags, retag, reorder, dates, hide/show, merge albums, publish.
// Talks to the small API in scripts/serve.mjs.
(() => {
    'use strict';

    const $ = (id) => document.getElementById(id);
    const IMAGE = /\.(jpe?g|png|webp|tiff?|gif|avif)$/i;
    const UNSUPPORTED = /\.(heic|heif|raw|cr2|cr3|nef|arw|dng|psd)$/i;
    const UNTAGGED = '\u0000untagged';
    const HIDDEN = '\u0000hidden';

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
    // "2024-05-03T19:50:22" -> "may 3, 2024"
    const fmtDate = (d) => (d
        ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toLowerCase()
        : '');
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
        if (!res.ok) {
            const err = new Error(data.error || `error ${res.status}`);
            err.status = res.status;
            err.duplicate = data.duplicate;
            throw err;
        }
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
        if (isAlbum() && !lib.albums.some((a) => a.slug === filter)) filter = '';
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
                : slug === HIDDEN ? lib.photos.filter((p) => p.hidden).length
                    : lib.photos.filter((p) => p.tags.includes(slug)).length;

    async function saveAlbums(albums) {
        try {
            setLibrary(await api('/api/albums', { albums }));
        } catch (err) {
            toast(err.message, true);
            renderAlbums();
        }
    }

    async function mergeAlbums(from, into) {
        try {
            setLibrary(await api('/api/merge', { from: from.slug, into: into.slug }));
            if (filter === from.slug) { filter = into.slug; renderFilter(); renderLibrary(); }
            toast(`merged “${from.title}” into “${into.title}”`);
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
                const other = lib.albums.find((x) => x !== a &&
                    (x.title.toLowerCase() === title.toLowerCase() || x.slug === slugify(title)));
                if (other) {
                    if (confirm(`“${other.title}” already exists. Merge “${a.title}” into it?\n\nIts ${countFor(a.slug)} photo(s) move into “${other.title}”, and “${a.title}” goes away.`)) {
                        mergeAlbums(a, other);
                    } else {
                        name.value = a.title;
                    }
                    return;
                }
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
            ...(countFor(HIDDEN) || filter === HIDDEN ? [{ key: HIDDEN, label: 'hidden' }] : []),
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

    function countText() {
        const hidden = countFor(HIDDEN);
        return `· ${lib.photos.length}${hidden ? ` (${hidden} hidden)` : ''}`;
    }

    function updateCounts() {
        renderFilter();
        $('count').textContent = countText();
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

    const isAlbum = () => filter !== '' && filter !== UNTAGGED && filter !== HIDDEN;
    const shown = () =>
        filter === '' ? lib.photos
            : filter === UNTAGGED ? lib.photos.filter((p) => !p.tags.length)
                : filter === HIDDEN ? lib.photos.filter((p) => p.hidden)
                    : albumPhotos(filter);
    const thumbUrl = (p) => `/${p.hidden ? 'staging' : 'photos'}/thumbs/${encodeURIComponent(p.file)}`;

    async function setHidden(files, hidden) {
        try {
            setLibrary(await api('/api/visibility', { files, hidden }));
            const n = files.length === 1 ? 'photo' : `${files.length} photos`;
            toast(hidden ? `${n} hidden — off the site after you publish` : `${n} back on the site after you publish`);
        } catch (err) {
            toast(err.message, true);
        }
    }

    async function sortByDate(newestFirst) {
        const what = isAlbum() ? `“${lib.albums.find((a) => a.slug === filter)?.title}”` : '“all”';
        const undated = shown().filter((p) => !p.date).length;
        const note = undated ? `\n\n${undated} photo(s) without a date go at the end.` : '';
        if (!confirm(`Sort ${what} by date taken, ${newestFirst ? 'newest' : 'oldest'} first? This replaces its current order.${note}`)) return;
        try {
            setLibrary(await api('/api/sort', isAlbum() ? { album: filter, newestFirst } : { newestFirst }));
        } catch (err) {
            toast(err.message, true);
        }
    }

    async function removePhotos(files) {
        try {
            setLibrary(await api('/api/delete', { files }));
            toast(files.length === 1 ? 'removed' : `${files.length} photos removed`);
        } catch (err) {
            toast(err.message, true);
        }
    }

    function card(p) {
        const c = el('div', { className: 'card' });
        c.dataset.file = p.file;
        c.classList.toggle('is-selected', selected.has(p.file));
        c.classList.toggle('is-hidden', Boolean(p.hidden));

        const frame = el('button', { type: 'button', className: 'frame', draggable: true, title: p.file },
            el('img', { src: thumbUrl(p), alt: '', loading: 'lazy', decoding: 'async' }),
            el('span', { className: 'tick', textContent: '✓', ariaHidden: 'true' }),
            p.hidden ? el('span', { className: 'badge', textContent: 'hidden' }) : null);
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

        const remove = el('button', { type: 'button', className: 'link remove', textContent: 'delete', title: 'delete from the studio and the site' });
        let armed = null;
        remove.addEventListener('click', () => {
            if (!armed) {
                remove.textContent = 'delete for good?';
                remove.classList.add('is-armed');
                armed = setTimeout(() => {
                    armed = null;
                    remove.textContent = 'delete';
                    remove.classList.remove('is-armed');
                }, 3000);
                return;
            }
            clearTimeout(armed);
            removePhotos([p.file]);
        });

        const view = p.hidden ? null
            : el('a', { href: `/#photo/${encodeURIComponent(p.file)}`, target: '_blank', rel: 'noopener', textContent: 'view' });
        const toggle = el('button', { type: 'button', className: 'link', textContent: p.hidden ? 'show' : 'hide',
            title: p.hidden ? 'put back on the site' : 'keep in the studio but off the site' });
        toggle.addEventListener('click', () => setHidden([p.file], !p.hidden));

        // date taken: click to set or change it (scans often have none)
        const date = el('button', { type: 'button', className: `date${p.date ? '' : ' is-empty'}`,
            textContent: p.date ? fmtDate(p.date) : 'add date', title: p.date ? `taken ${p.date.replace('T', ' ')}` : 'when was it taken?' });
        date.addEventListener('click', () => {
            const input = el('input', { type: 'date', className: 'date-input', value: p.date ? p.date.slice(0, 10) : '' });
            input.setAttribute('aria-label', `date taken for ${p.file}`);
            let saved = false;
            const save = async () => {
                if (saved) return;
                saved = true;
                const value = input.value;
                const before = p.date ? p.date.slice(0, 10) : '';
                if (value === before) { input.replaceWith(date); return; }
                try {
                    setLibrary(await api('/api/photo', { file: p.file, date: value }), { keepCards: true });
                    p.date = lib.photos.find((x) => x.file === p.file)?.date;
                    date.textContent = p.date ? fmtDate(p.date) : 'add date';
                    date.classList.toggle('is-empty', !p.date);
                } catch (err) {
                    toast(err.message, true);
                }
                input.replaceWith(date);
            };
            // saves on enter or when you click away (not on every keystroke: half-typed years are valid dates)
            input.addEventListener('blur', save);
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') save();
                if (e.key === 'Escape') { saved = true; input.replaceWith(date); }
            });
            date.replaceWith(input);
            input.focus();
        });
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

        c.append(frame,
            el('div', { className: 'meta' }, el('span', { className: 'name', textContent: p.file }), date),
            el('div', { className: 'actions' }, view, toggle, remove),
            tags);
        return c;
    }

    function renderLibrary() {
        const photos = shown();
        const title = isAlbum() ? (lib.albums.find((a) => a.slug === filter)?.title || filter) : '';
        $('lib-hint').textContent = isAlbum()
            ? `drag to set the order of “${title}” (only this album changes). click a photo to select it.`
            : filter === UNTAGGED
                ? 'click photos to select them, then give them tags above.'
                : filter === HIDDEN
                    ? 'hidden photos stay here but aren’t on the site (or on GitHub). “show” puts one back.'
                    : 'drag photos to set the order of “all”. click a photo to select it for tagging in bulk.';
        $('sort').hidden = !(filter === '' || isAlbum()) || photos.length < 2;
        $('library').replaceChildren(...photos.map(card));
        $('library').classList.toggle('is-selecting', selected.size > 0);
        $('count').textContent = countText();
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
            b.textContent = `really delete ${selected.size}?`;
            bulkDeleteArmed = setTimeout(() => {
                bulkDeleteArmed = null;
                b.textContent = 'delete';
            }, 3000);
            return;
        }
        clearTimeout(bulkDeleteArmed);
        bulkDeleteArmed = null;
        b.textContent = 'delete';
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

            }
            queue.push(item);
        }
        renderQueue();
    }

    const canUpload = (q) => q.state === 'ready' || (q.state === 'error' && q.retry);

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
            let anyway = null;
            if (item.state === 'dupe') {
                anyway = el('button', { type: 'button', className: 'link', textContent: 'upload anyway', disabled: busy });
                anyway.addEventListener('click', () => {
                    item.state = 'ready';
                    item.force = true;
                    item.note = 'will upload anyway';
                    renderQueue();
                });
            }
            return el('li', { className: `qitem is-${item.state}` },
                thumb,
                el('span', { className: 'qname', textContent: item.file.name },
                    note ? el('span', { className: 'qnote', textContent: note }) : null,
                    anyway),
                x);
        }));
        const ready = queue.filter(canUpload).length;
        $('batch').hidden = queue.length === 0;
        const up = $('upload');
        up.disabled = busy || ready === 0;
        up.textContent = busy ? 'uploading…' : `upload ${ready} photo${ready === 1 ? '' : 's'}`;
    }

    async function upload() {
        if (busy) return;
        const tags = batchField.get();
        const hidden = $('keep-hidden').checked;
        const items = queue.filter(canUpload);
        if (!items.length) return;
        busy = true;
        let done = 0;
        for (const item of items) {
            item.state = 'uploading';
            renderQueue();
            try {
                const params = new URLSearchParams({ name: item.file.name, tags: JSON.stringify(tags), at: String(done) });
                if (hidden) params.set('hidden', '1');
                if (item.force) params.set('force', '1');
                setLibrary(await api(`/api/upload?${params}`, item.file, true));
                done++;
                if (item.url) URL.revokeObjectURL(item.url);
                queue = queue.filter((q) => q !== item);
            } catch (err) {
                item.state = err.status === 409 ? 'dupe' : 'error';
                item.retry = err.status !== 409;
                item.note = err.message;
            }
            renderQueue();
        }
        busy = false;
        renderQueue();
        if (done) {
            const where = tags.length ? ` to ${tags.map(titleOf).join(', ')}` : '';
            toast(`added ${done} photo${done === 1 ? '' : 's'}${where}${hidden ? ' (hidden for now)' : ''}`);
            if (!queue.length) batchField.clear();
            if (filter && filter !== (hidden ? HIDDEN : UNTAGGED) && !tags.map(keyOf).includes(filter)) {
                filter = '';
                renderFilter();
                renderLibrary();
            }
        }
        const failed = queue.filter((q) => q.state === 'error' && q.retry).length;
        const dupes = queue.filter((q) => q.state === 'dupe').length;
        if (failed) toast(`${failed} photo${failed === 1 ? '' : 's'} didn’t upload — see the list`, true);
        else if (dupes) toast(`${dupes} photo${dupes === 1 ? ' looks' : 's look'} like ${dupes === 1 ? 'one' : 'ones'} already in the studio — see the list`, true);
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
    $('bulk-hide').addEventListener('click', () => setHidden([...selected], true));
    $('bulk-show').addEventListener('click', () => setHidden([...selected], false));
    $('sort-old').addEventListener('click', () => sortByDate(false));
    $('sort-new').addEventListener('click', () => sortByDate(true));
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
