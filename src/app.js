(() => {
    'use strict';

    const $ = (id) => document.getElementById(id);
    const navEl = $('album-nav');
    const galleryEl = $('gallery');
    const statusEl = $('status');
    const lb = $('lightbox');
    const lbImg = $('lb-img');
    const lbCount = $('lb-count');
    const lbClose = $('lb-close');
    const lbPrev = $('lb-prev');
    const lbNext = $('lb-next');

    const SITE = 'what we see is what we are';
    const LOOSE = '_loose'; // photos dropped straight into inbox/ (no album)
    const SWIPE = 40;

    let albums = [];
    let all = [];
    let view = 'all';
    let renderedView = null;
    let list = [];
    let idx = -1;
    let opener = null;
    let touchX = null;
    let touchY = null;

    const fullSrc = (p) => `photos/${p.album}/${p.file}`;
    const thumbSrc = (p) => `photos/${p.album}/thumbs/${p.file}`;
    const photoHash = (p) => `#photo/${p.album}/${p.file}`;
    const albumHash = (slug) => (slug === 'all' ? '#' : `#album/${slug}`);
    const namedAlbums = () => albums.filter((a) => a.slug !== LOOSE);

    function renderNav() {
        const named = namedAlbums();
        navEl.textContent = '';
        navEl.hidden = named.length === 0;
        if (!named.length) return;

        const ul = document.createElement('ul');
        [{ slug: 'all', title: 'all' }, ...named].forEach((a) => {
            const li = document.createElement('li');
            if (a.slug === view) {
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
            if (i > 11) img.loading = 'lazy';
            a.appendChild(img);
            frag.appendChild(a);
        });
        galleryEl.textContent = '';
        galleryEl.appendChild(frag);
    }

    function setView(slug) {
        if (slug === renderedView) return;
        view = slug;
        renderedView = slug;
        const album = albums.find((a) => a.slug === slug);
        list = slug === 'all' || !album ? all : album.photos;
        document.title = slug === 'all' ? SITE : `${album.title} — ${SITE}`;
        renderNav();
        renderGrid();
    }

    /* Viewer */

    function preload(i) {
        if (i < 0 || i >= list.length) return;
        const img = new Image();
        img.src = fullSrc(list[i]);
    }

    function show(i) {
        idx = i;
        const p = list[i];
        lbImg.classList.add('is-loading');
        lbImg.onload = () => lbImg.classList.remove('is-loading');
        lbImg.src = fullSrc(p);
        lbCount.textContent = `${i + 1} / ${list.length}`;
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
            lbClose.focus();
        }
        show(i);
    }

    function closeBox() {
        if (lb.hidden) return;
        lb.hidden = true;
        document.body.classList.remove('no-scroll');
        lbImg.removeAttribute('src');
        if (opener && document.contains(opener)) opener.focus();
        opener = null;
    }

    function step(d) {
        const n = idx + d;
        if (n < 0 || n >= list.length) return;
        show(n);
        history.replaceState(null, '', photoHash(list[n]));
    }

    function requestClose() {
        location.hash = albumHash(view);
    }

    /* Routing: #  |  #album/<slug>  |  #photo/<album>/<file> */

    function route() {
        const h = decodeURIComponent(location.hash.slice(1));

        let m = h.match(/^photo\/([^/]+)\/(.+)$/);
        if (m) {
            const p = all.find((x) => x.album === m[1] && x.file === m[2]);
            if (p) {
                if (!list.includes(p)) setView(p.album === LOOSE ? 'all' : p.album);
                openAt(list.indexOf(p));
                return;
            }
        }

        m = h.match(/^album\/(.+)$/);
        closeBox();
        const wanted = m && namedAlbums().some((a) => a.slug === m[1]) ? m[1] : 'all';
        setView(wanted);
    }

    function init(data) {
        albums = (data.albums || []).filter((a) => a.photos && a.photos.length);
        albums.forEach((a) => a.photos.forEach((p) => { p.album = a.slug; }));
        all = albums.flatMap((a) => a.photos);

        if (!all.length) {
            statusEl.textContent = 'no photos yet.';
            return;
        }
        statusEl.hidden = true;
        route();
        window.addEventListener('hashchange', route);
    }

    /* Events */

    lbClose.addEventListener('click', requestClose);
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
            const stops = [lbClose, lbPrev, lbNext].filter((b) => !b.disabled);
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
