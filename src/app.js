(() => {
    'use strict';

    const $ = (id) => document.getElementById(id);
    const navEl = $('album-nav');
    const galleryEl = $('gallery');
    const noteEl = $('album-note');
    const coverEl = $('cover');
    const statusEl = $('status');
    const lb = $('lightbox');
    const lbImg = $('lb-img');
    const lbCount = $('lb-count');
    const lbTags = $('lb-tags');
    const lbClose = $('lb-close');
    const lbPrev = $('lb-prev');
    const lbNext = $('lb-next');

    const SITE = 'what we see is what we are';
    const SWIPE = 40;
    const COVER_TAG = 'cover'; // photos tagged "cover" are the landing page's picks; never shown as an album
    const COVER = Symbol('cover'); // renderedView while the landing page's cover photo is showing
    const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

    // photos.json: { albums: [{ slug, title, note? }], photos: [{ file, w, h, tags: [slug], date? }] }
    // Each tag is an album; a photo can be in several. '' is the "all" view (#all).
    // The landing page (#) shows one cover photo instead, picked at random on each load.
    let albums = [];
    let photos = [];
    let view = '';
    let renderedView = null;
    let list = [];
    let idx = -1;
    let opener = null;
    let touchX = null;
    let touchY = null;
    let cover = null;

    const fullSrc = (p) => `photos/${p.file}`;
    const thumbSrc = (p) => `photos/thumbs/${p.file}`;
    const albumHash = (slug) => (slug ? `#album/${slug}` : '#all');
    const photoHash = (p) => (view ? `#album/${view}/${p.file}` : `#photo/${p.file}`);
    // an album's own order (set on the upload page); photos not placed yet come first
    function inAlbum(slug) {
        const album = albums.find((a) => a.slug === slug);
        const tagged = photos.filter((p) => p.tags.includes(slug));
        if (!album || !Array.isArray(album.order)) return tagged;
        const rank = new Map(album.order.map((f, i) => [f, i]));
        return [...tagged.filter((p) => !rank.has(p.file)),
            ...tagged.filter((p) => rank.has(p.file)).sort((a, b) => rank.get(a.file) - rank.get(b.file))];
    }

    function renderNav() {
        navEl.textContent = '';
        navEl.hidden = albums.length === 0;
        if (!albums.length) return;

        const ul = document.createElement('ul');
        [{ slug: '', title: 'all' }, ...albums].forEach((a) => {
            const li = document.createElement('li');
            if (a.slug === view && renderedView !== COVER) {
                const span = document.createElement('span');
                span.className = 'is-active';
                span.textContent = a.title;
                span.setAttribute('aria-current', 'page');
                li.appendChild(span);
            } else {
                const link = document.createElement('a');
                link.href = albumHash(a.slug);
                link.textContent = a.title;
                li.appendChild(link);
            }
            ul.appendChild(li);
        });
        navEl.appendChild(ul);
        // phones show the albums as one sideways-scrolling line: keep the current one in view
        const cur = ul.querySelector('.is-active');
        if (cur && ul.scrollWidth > ul.clientWidth) {
            ul.scrollLeft += cur.getBoundingClientRect().left - ul.getBoundingClientRect().left - 16;
        }
    }

    function renderGrid() {
        const frag = document.createDocumentFragment();
        list.forEach((p, i) => {
            const a = document.createElement('a');
            a.className = 'tile';
            a.href = photoHash(p);
            a.style.setProperty('--ar', (p.w / p.h).toFixed(4));
            a.setAttribute('aria-label', `open photo ${i + 1} of ${list.length}`);

            const img = document.createElement('img');
            img.src = thumbSrc(p);
            img.width = p.w;
            img.height = p.h;
            img.alt = '';
            img.decoding = 'async';
            img.classList.add('fade');
            const shown = () => img.classList.add('is-loaded');
            img.addEventListener('load', shown, { once: true });
            img.addEventListener('error', shown, { once: true });
            if (i > 11) img.loading = 'lazy';
            a.appendChild(img);
            if (img.complete && img.naturalWidth) shown();
            frag.appendChild(a);
        });
        galleryEl.textContent = '';
        galleryEl.appendChild(frag);
    }

    // An album's note: plain text. Blank line = new paragraph, line break kept,
    // web addresses become links. Built from text nodes, never HTML.
    const URL_RE = /(https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]'])/g;
    function renderNote(album) {
        noteEl.textContent = '';
        noteEl.classList.remove('is-loaded');
        const text = album && typeof album.note === 'string' ? album.note.trim() : '';
        noteEl.hidden = !text;
        if (!text) return;
        for (const para of text.split(/\n\s*\n/)) {
            const p = document.createElement('p');
            para.split('\n').forEach((line, i) => {
                if (i) p.appendChild(document.createElement('br'));
                line.split(URL_RE).forEach((part, j) => {
                    if (!part) return;
                    if (j % 2) {
                        const a = document.createElement('a');
                        a.href = part;
                        a.textContent = part.replace(/^https?:\/\//, '');
                        a.rel = 'noopener';
                        p.appendChild(a);
                    } else {
                        p.appendChild(document.createTextNode(part));
                    }
                });
            });
            noteEl.appendChild(p);
        }
        requestAnimationFrame(() => requestAnimationFrame(() => noteEl.classList.add('is-loaded')));
    }

    function setView(slug) {
        if (slug === renderedView) return;
        const album = albums.find((a) => a.slug === slug);
        view = album ? slug : '';
        renderedView = view;
        list = album ? inAlbum(slug) : photos;
        document.title = album ? `${album.title} — ${SITE}` : SITE;
        coverEl.hidden = true;
        galleryEl.hidden = false;
        renderNav();
        renderNote(album);
        renderGrid();
    }

    /* Landing page: one landscape photo, scaled up where the grid would be.
       A new one is picked on every page load. Clicking it opens its album. */

    // photos tagged "cover", else any landscape, else anything
    function pickCover() {
        const chosen = photos.filter((p) => p.tags.includes(COVER_TAG));
        const wide = photos.filter((p) => p.w / p.h >= 1.2);
        const pool = chosen.length ? chosen : wide.length ? wide : photos;
        return pool[Math.floor(Math.random() * pool.length)];
    }

    // the photo's most specific album (fewest photos), so a place beats "b/w" or "color"
    function homeAlbum(p) {
        let best = null;
        let size = Infinity;
        for (const a of albums) {
            if (!p.tags.includes(a.slug)) continue;
            const n = inAlbum(a.slug).length;
            if (n < size) {
                best = a;
                size = n;
            }
        }
        return best;
    }

    function formatDate(d) {
        const m = typeof d === 'string' && d.match(/^(\d{4})-(\d{2})-(\d{2})/);
        return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : '';
    }

    function renderCover() {
        const p = cover;
        const home = homeAlbum(p);
        coverEl.textContent = '';
        coverEl.style.setProperty('--ar', (p.w / p.h).toFixed(4));

        const link = document.createElement('a');
        link.className = 'cover-link';
        link.href = home ? albumHash(home.slug) : `#photo/${p.file}`;
        link.setAttribute('aria-label', home ? `open the album ${home.title}` : 'open photo');
        // phones get the 800px grid copy (plenty at phone width, a fraction of the download)
        const picture = document.createElement('picture');
        const small = document.createElement('source');
        small.media = '(max-width: 860px)';
        small.srcset = thumbSrc(p);
        picture.appendChild(small);
        const img = document.createElement('img');
        img.src = fullSrc(p);
        img.width = p.w;
        img.height = p.h;
        img.alt = '';
        img.decoding = 'async';
        img.classList.add('fade');
        const shown = () => img.classList.add('is-loaded');
        img.addEventListener('load', shown, { once: true });
        img.addEventListener('error', shown, { once: true });
        picture.appendChild(img);
        link.appendChild(picture);
        if (img.complete && img.naturalWidth) shown();
        coverEl.appendChild(link);

        // underneath: the albums it's in (sidebar order) and the date it was taken
        const meta = document.createElement('figcaption');
        meta.className = 'cover-meta';
        const tags = document.createElement('span');
        tags.className = 'cover-tags';
        for (const a of albums.filter((x) => p.tags.includes(x.slug))) {
            const t = document.createElement('a');
            t.href = albumHash(a.slug);
            t.textContent = a.title;
            tags.appendChild(t);
        }
        meta.appendChild(tags);
        const date = formatDate(p.date);
        if (date) {
            const time = document.createElement('time');
            time.className = 'cover-date';
            time.dateTime = p.date.slice(0, 10);
            time.textContent = date;
            meta.appendChild(time);
        }
        coverEl.appendChild(meta);
    }

    function showCover() {
        if (renderedView === COVER) return;
        if (!cover) cover = pickCover();
        view = '';
        renderedView = COVER;
        list = photos;
        document.title = SITE;
        renderNav();
        renderNote(null);
        galleryEl.textContent = '';
        galleryEl.hidden = true;
        renderCover();
        coverEl.hidden = false;
    }

    /* Viewer */

    function preload(i) {
        if (i < 0 || i >= list.length) return;
        const img = new Image();
        img.src = fullSrc(list[i]);
    }

    // the albums this photo is in, in sidebar order; each opens that album (and its note)
    function renderPhotoTags(p) {
        lbTags.textContent = '';
        for (const a of albums.filter((x) => p.tags.includes(x.slug))) {
            let item;
            if (a.slug === view) {
                item = document.createElement('span');
                item.setAttribute('aria-current', 'page');
            } else {
                item = document.createElement('a');
                item.href = albumHash(a.slug);
            }
            item.textContent = a.title;
            lbTags.appendChild(item);
        }
        lbTags.hidden = !lbTags.childElementCount;
    }

    function show(i) {
        idx = i;
        const p = list[i];
        lbImg.classList.add('is-loading');
        lbImg.onload = () => lbImg.classList.remove('is-loading');
        lbImg.src = fullSrc(p);
        lbCount.textContent = `${i + 1} / ${list.length}`;
        renderPhotoTags(p);
        lbPrev.disabled = i === 0;
        lbNext.disabled = i === list.length - 1;
        preload(i - 1);
        preload(i + 1);
    }

    function openAt(i) {
        if (i < 0) return;
        if (lb.hidden) {
            opener = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
            lb.hidden = false;
            document.body.classList.add('no-scroll');
            lb.focus(); // the viewer itself, not the close button, so no focus ring shows on a tap
        }
        show(i);
    }

    function closeBox() {
        if (lb.hidden) return;
        setImmersive(false);
        lb.hidden = true;
        document.body.classList.remove('no-scroll');
        lbImg.removeAttribute('src');
        if (opener && document.contains(opener)) opener.focus();
        opener = null;
    }

    // full screen: tap the photo to hide the controls (black background); tap again to bring them back.
    // Where the browser allows it (not iPhone Safari), the browser's own chrome goes too.
    function setImmersive(on) {
        lb.classList.toggle('is-immersive', on);
        if (on && lb.requestFullscreen && !document.fullscreenElement) {
            lb.requestFullscreen().catch(() => {});
        } else if (!on && document.fullscreenElement && document.exitFullscreen) {
            document.exitFullscreen().catch(() => {});
        }
    }

    function step(d) {
        const n = idx + d;
        if (n < 0 || n >= list.length) return;
        show(n);
        history.replaceState(null, '', photoHash(list[n]));
    }

    function requestClose() {
        location.hash = renderedView === COVER ? '' : albumHash(view);
    }

    /* Routing:  # (cover)  |  #all  |  #album/<tag>  |  #album/<tag>/<file>  |  #photo/<file>
       (old links like #photo/<album>/<file> still open the photo) */

    function route() {
        const h = decodeURIComponent(location.hash.slice(1));
        const byFile = (file) => photos.find((p) => p.file === file);

        let m = h.match(/^album\/([^/]+)\/([^/]+)$/);
        if (m && byFile(m[2])) {
            const p = byFile(m[2]);
            setView(p.tags.includes(m[1]) ? m[1] : '');
            openAt(list.indexOf(p));
            return;
        }

        m = h.match(/^photo\/(?:[^/]+\/)?([^/]+)$/);
        if (m && byFile(m[1])) {
            const p = byFile(m[1]);
            if (!list.includes(p)) setView('');
            openAt(list.indexOf(p));
            return;
        }

        closeBox();
        m = h.match(/^album\/([^/]+)$/);
        if (m) setView(m[1]);
        else if (h === 'all') setView('');
        else showCover();
    }

    function init(data) {
        photos = (Array.isArray(data.photos) ? data.photos : [])
            .filter((p) => p && p.file && p.w && p.h)
            .map((p) => ({ ...p, tags: Array.isArray(p.tags) ? p.tags : [] }));
        albums = (Array.isArray(data.albums) ? data.albums : [])
            .filter((a) => a && a.slug && a.slug !== COVER_TAG && inAlbum(a.slug).length);

        if (!photos.length) {
            statusEl.textContent = 'no photos yet.';
            return;
        }
        statusEl.hidden = true;
        route();
        window.addEventListener('hashchange', route);
    }

    /* Events */

    lbClose.addEventListener('click', requestClose);
    lbImg.addEventListener('click', () => setImmersive(!lb.classList.contains('is-immersive')));
    document.addEventListener('fullscreenchange', () => {
        if (!document.fullscreenElement) lb.classList.remove('is-immersive');
    });
    lbPrev.addEventListener('click', () => step(-1));
    lbNext.addEventListener('click', () => step(1));

    document.addEventListener('keydown', (e) => {
        if (lb.hidden) return;
        if (e.key === 'Escape') {
            requestClose();
        } else if (e.key === 'ArrowLeft') {
            step(-1);
        } else if (e.key === 'ArrowRight') {
            step(1);
        } else if (e.key === 'Tab') {
            const stops = [lbClose, ...lbTags.querySelectorAll('a'), lbPrev, lbNext].filter((b) => !b.disabled);
            const at = stops.indexOf(document.activeElement);
            const next = e.shiftKey ? at - 1 : at + 1;
            e.preventDefault();
            stops[(next + stops.length) % stops.length].focus();
        }
    });

    lb.addEventListener('touchstart', (e) => {
        const t = e.changedTouches[0];
        touchX = t.clientX;
        touchY = t.clientY;
    }, { passive: true });

    lb.addEventListener('touchend', (e) => {
        if (touchX === null) return;
        const t = e.changedTouches[0];
        const dx = t.clientX - touchX;
        const dy = t.clientY - touchY;
        touchX = touchY = null;
        if (Math.abs(dx) > SWIPE && Math.abs(dx) > Math.abs(dy)) step(dx < 0 ? 1 : -1);
    }, { passive: true });

    fetch('photos.json', { cache: 'no-cache' })
        .then((r) => {
            if (!r.ok) throw new Error(`photos.json: ${r.status}`);
            return r.json();
        })
        .then(init)
        .catch(() => {
            statusEl.textContent = 'no photos yet.';
        });
})();
