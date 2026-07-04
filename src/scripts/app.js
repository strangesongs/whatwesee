document.addEventListener('DOMContentLoaded', () => {
    const apiKey = 'b78aa973eab5e39787fc5e2a08cdfaf5';
    const flickrUserId = '196014147@N05';
    const apiBase = 'https://api.flickr.com/services/rest/';
    const PAGE_SIZE = 24;

    const galleryEl = document.getElementById('photo-gallery');
    const statusEl = document.getElementById('status');
    const albumNav = document.getElementById('album-nav');
    const galleryMetaEl = document.getElementById('gallery-meta');
    const retryLoadBtn = document.getElementById('retry-load');
    const loadMoreBtn = document.getElementById('load-more');
    const lastUpdatedEl = document.getElementById('last-updated');

    const lightboxEl = document.getElementById('lightbox');
    const lightboxImage = document.getElementById('lightbox-image');
    const lightboxClose = document.getElementById('lightbox-close');
    const lightboxPrev = document.getElementById('lightbox-prev');
    const lightboxNext = document.getElementById('lightbox-next');

    let visiblePhotos = [];
    let renderedCount = 0;
    let activeAlbumId = 'all';
    let currentPhotoIndex = -1;
    let publicPhotos = [];
    const albumPhotoCache = new Map();
    let albums = [];
    let lightboxLastFocusedEl = null;
    let pendingAlbumSlug = null;
    let pendingPhotoId = null;

    const FETCH_TIMEOUT_MS = 9000;
    const FETCH_MAX_RETRIES = 2;
    const CACHE_PUBLIC_PHOTOS_KEY = 'whatwesee.publicPhotos.v1';
    const CACHE_ALBUMS_KEY = 'whatwesee.albums.v1';
    const CACHE_TTL_MS = 1000 * 60 * 60 * 24;
    const ERROR_MONITOR_URL = '';
    const PHOTO_EXTRAS = [
        'url_z,url_c,url_l,url_b,url_h,url_k,url_o',
        'width_z,height_z,width_c,height_c,width_l,height_l',
        'width_b,height_b,width_h,height_h,width_k,height_k,width_o,height_o',
        'date_taken'
    ].join(',');

    parseLocationHash();

    function clampText(text, maxLength) {
        const value = typeof text === 'string' ? text : String(text || '');
        if (value.length <= maxLength) {
            return value;
        }

        return `${value.slice(0, maxLength)}...`;
    }

    function isLikelyPhoto(item) {
        return Boolean(item && item.id && item.server && item.secret);
    }

    function normalizePhotoList(list) {
        if (!Array.isArray(list)) {
            return [];
        }

        return list.filter(isLikelyPhoto);
    }

    function normalizeAlbumList(list) {
        if (!Array.isArray(list)) {
            return [];
        }

        return list
            .filter((item) => item && item.id)
            .map((item) => ({
                id: String(item.id),
                title: item.title ? String(item.title) : 'Untitled album',
                count: Number(item.count || 0)
            }));
    }

    function formatPhotoDate(photo) {
        if (!photo || !photo.date_taken) {
            return '';
        }

        const parsed = new Date(photo.date_taken);
        if (Number.isNaN(parsed.getTime())) {
            return photo.date_taken.split(' ')[0] || '';
        }

        return parsed.toISOString().slice(0, 10);
    }

    function albumSlug(item) {
        if (item.id === 'all') {
            return 'all';
        }

        return item.title.toLowerCase().replace(/\s+/g, '-');
    }

    function findAlbumIdBySlug(slug) {
        if (slug === 'all') {
            return 'all';
        }

        const match = albums.find((album) => albumSlug(album) === slug);
        return match ? match.id : null;
    }

    function parseLocationHash() {
        const hash = window.location.hash.slice(1);
        if (!hash) {
            return;
        }

        const photoMatch = hash.match(/^photo\/(.+)$/);
        if (photoMatch) {
            pendingPhotoId = photoMatch[1];
            return;
        }

        const albumMatch = hash.match(/^album\/(.+)$/);
        if (albumMatch) {
            pendingAlbumSlug = albumMatch[1];
        }
    }

    function setLocationHash(nextHash) {
        const target = nextHash ? `#${nextHash}` : '';
        if (window.location.hash === target) {
            return;
        }

        history.replaceState(null, '', `${window.location.pathname}${window.location.search}${target}`);
    }

    function updateAlbumHash() {
        if (activeAlbumId === 'all') {
            setLocationHash('album/all');
            return;
        }

        const album = albums.find((item) => item.id === activeAlbumId);
        if (album) {
            setLocationHash(`album/${albumSlug(album)}`);
        }
    }

    function updatePhotoHash(photo) {
        if (photo && photo.id) {
            setLocationHash(`photo/${photo.id}`);
        }
    }


    function reportClientIssue(payload) {
        if (!ERROR_MONITOR_URL) {
            return;
        }

        try {
            const safePayload = {
                type: payload && payload.type ? String(payload.type) : 'unknown',
                message: clampText(payload && payload.message ? payload.message : 'No message', 280),
                file: payload && payload.file ? clampText(payload.file, 200) : undefined,
                line: payload && Number.isFinite(payload.line) ? payload.line : undefined,
                column: payload && Number.isFinite(payload.column) ? payload.column : undefined
            };

            const body = JSON.stringify({
                source: 'whatwesee-client',
                page: window.location.pathname,
                time: new Date().toISOString(),
                ...safePayload
            });

            if (navigator.sendBeacon) {
                const blob = new Blob([body], { type: 'application/json' });
                navigator.sendBeacon(ERROR_MONITOR_URL, blob);
                return;
            }

            fetch(ERROR_MONITOR_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body,
                keepalive: true
            }).catch(() => {});
        } catch (error) {
            console.warn('Client issue reporting failed', error);
        }
    }

    function wait(ms) {
        return new Promise((resolve) => {
            window.setTimeout(resolve, ms);
        });
    }

    function withTimeout(promise, timeoutMs, timeoutMessage) {
        const timeoutPromise = new Promise((_, reject) => {
            window.setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
        });

        return Promise.race([promise, timeoutPromise]);
    }

    function fetchJsonWithRetry(url, options) {
        const maxRetries = options && Number.isInteger(options.maxRetries) ? options.maxRetries : FETCH_MAX_RETRIES;
        const timeoutMs = options && Number.isFinite(options.timeoutMs) ? options.timeoutMs : FETCH_TIMEOUT_MS;
        let attempt = 0;

        function runAttempt() {
            return withTimeout(fetchJson(url), timeoutMs, 'Request timed out')
                .catch((error) => {
                    if (attempt >= maxRetries) {
                        throw error;
                    }

                    attempt += 1;
                    const backoffMs = Math.min(350 * Math.pow(2, attempt), 1800);
                    return wait(backoffMs).then(runAttempt);
                });
        }

        return runAttempt();
    }

    function saveToCache(key, value) {
        try {
            const payload = {
                savedAt: Date.now(),
                data: value
            };

            localStorage.setItem(key, JSON.stringify(payload));
        } catch (error) {
            console.warn('Cache write failed', error);
        }
    }

    function readFromCache(key) {
        try {
            const rawValue = localStorage.getItem(key);
            if (!rawValue) {
                return null;
            }

            const parsed = JSON.parse(rawValue);

            if (Array.isArray(parsed)) {
                return parsed;
            }

            if (!parsed || !Number.isFinite(parsed.savedAt)) {
                return null;
            }

            if (Date.now() - parsed.savedAt > CACHE_TTL_MS) {
                localStorage.removeItem(key);
                return null;
            }

            return parsed.data;
        } catch (error) {
            console.warn('Cache read failed', error);
            return null;
        }
    }

    function updateRetryButton(show) {
        if (!retryLoadBtn) {
            return;
        }

        retryLoadBtn.hidden = !show;
    }

    const PHOTO_SIZE_KEYS = [
        ['url_o', 'width_o', 'height_o'],
        ['url_k', 'width_k', 'height_k'],
        ['url_h', 'width_h', 'height_h'],
        ['url_b', 'width_b', 'height_b'],
        ['url_l', 'width_l', 'height_l'],
        ['url_c', 'width_c', 'height_c'],
        ['url_z', 'width_z', 'height_z']
    ];

    const GALLERY_SIZE_KEYS = [
        ['url_c', 'width_c', 'height_c'],
        ['url_z', 'width_z', 'height_z']
    ];

    function photoSourceFromKeys(photo, sizeKeys) {
        for (const [urlKey, widthKey, heightKey] of sizeKeys) {
            if (photo[urlKey] && photo[widthKey] && photo[heightKey]) {
                return {
                    url: photo[urlKey],
                    width: Number(photo[widthKey]),
                    height: Number(photo[heightKey])
                };
            }
        }

        return null;
    }

    function fallbackPhotoSource(photo) {
        return {
            url: `https://live.staticflickr.com/${photo.server}/${photo.id}_${photo.secret}_z.jpg`,
            width: 4,
            height: 5
        };
    }

    function galleryPhotoSource(photo) {
        return photoSourceFromKeys(photo, GALLERY_SIZE_KEYS) || fallbackPhotoSource(photo);
    }

    function lightboxPhotoSource(photo) {
        return photoSourceFromKeys(photo, PHOTO_SIZE_KEYS) || fallbackPhotoSource(photo);
    }

    function setStatus(message, isError) {
        if (!statusEl) {
            if (isError) {
                console.error(message);
            }
            return;
        }

        statusEl.textContent = message;
        statusEl.classList.toggle('is-error', Boolean(isError));
    }

    function showUiLoadingState(message) {
        setStatus(message || 'Loading photos...');
        updateRetryButton(false);
    }

    function clearStatus() {
        setStatus('', false);
    }

    function showUiErrorState(message) {
        setStatus(message, true);
        updateRetryButton(true);
    }

    function currentRenderedPhotos() {
        return visiblePhotos.slice(0, renderedCount);
    }

    function updateLastUpdated() {
        if (!lastUpdatedEl || !publicPhotos.length) {
            return;
        }

        let newest = null;

        publicPhotos.forEach((photo) => {
            const label = formatPhotoDate(photo);
            if (!label) {
                return;
            }

            if (!newest || label > newest) {
                newest = label;
            }
        });

        if (newest) {
            lastUpdatedEl.textContent = `last updated: ${newest}`;
        }
    }

    function photoCard(photo, index) {
        const entry = document.createElement('div');
        entry.className = 'photo-entry';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'photo-card';
        button.setAttribute('aria-label', photo.title || 'Open photo');

        const source = galleryPhotoSource(photo);

        const image = document.createElement('img');
        image.src = source.url;
        image.alt = photo.title || 'Flickr photo';
        image.loading = 'lazy';
        image.decoding = 'async';

        button.appendChild(image);
        button.addEventListener('click', () => openLightbox(index));
        entry.appendChild(button);

        const dateLabel = formatPhotoDate(photo);
        if (dateLabel) {
            const caption = document.createElement('p');
            caption.className = 'photo-caption';
            caption.textContent = dateLabel;
            entry.appendChild(caption);
        }

        return entry;
    }

    function renderGallery() {
        galleryEl.innerHTML = '';
        const renderedPhotos = currentRenderedPhotos();

        if (!renderedPhotos.length) {
            const emptyState = document.createElement('p');
            emptyState.className = 'empty-state';
            emptyState.textContent = 'No photos found in this album yet.';
            galleryEl.appendChild(emptyState);
            return;
        }

        renderedPhotos.forEach((photo, index) => {
            galleryEl.appendChild(photoCard(photo, index));
        });
    }

    function updateGalleryMeta() {
        if (!galleryMetaEl) {
            return;
        }

        if (!visiblePhotos.length) {
            galleryMetaEl.textContent = '0 photos';
            return;
        }

        galleryMetaEl.textContent = `showing ${Math.min(renderedCount, visiblePhotos.length)} of ${visiblePhotos.length}`;
    }

    function updateLoadMoreButton() {
        if (!loadMoreBtn) {
            return;
        }

        const remaining = visiblePhotos.length - renderedCount;
        if (remaining <= 0) {
            loadMoreBtn.hidden = true;
            return;
        }

        loadMoreBtn.hidden = false;
        loadMoreBtn.textContent = 'load more';
    }

    function setVisiblePhotos(photos, options) {
        const opts = options || {};
        visiblePhotos = photos.slice();
        renderedCount = Math.min(PAGE_SIZE, visiblePhotos.length);
        updateGalleryMeta();
        updateLoadMoreButton();
        renderGallery();

        if (opts.updateHash !== false && !pendingPhotoId) {
            updateAlbumHash();
        }
    }

    function buildFlickrUrl(method, params) {
        const query = new URLSearchParams({
            method,
            api_key: apiKey,
            user_id: flickrUserId,
            format: 'json',
            nojsoncallback: '1',
            ...params
        });

        return `${apiBase}?${query.toString()}`;
    }

    function fetchJson(url) {
        return fetch(url).then((response) => {
            if (!response.ok) {
                throw new Error(`Request failed with status ${response.status}`);
            }
            return response.json();
        });
    }

    function albumLinkLabel(item) {
        if (item.id === 'all') {
            return 'all';
        }

        return item.title.toLowerCase();
    }

    function renderAlbumNav() {
        if (!albumNav) {
            return;
        }

        albumNav.innerHTML = '';

        const allItem = {
            id: 'all',
            title: 'All photos',
            count: publicPhotos.length
        };

        const items = [allItem].concat(albums);

        items.forEach((item, index) => {
            if (index > 0) {
                const sep = document.createElement('span');
                sep.className = 'album-sep';
                sep.setAttribute('aria-hidden', 'true');
                sep.textContent = '|';
                albumNav.appendChild(sep);
            }

            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'album-link';
            button.textContent = albumLinkLabel(item);
            button.setAttribute('data-album-id', item.id);

            if (item.id === activeAlbumId) {
                button.classList.add('is-active');
                button.setAttribute('aria-current', 'true');
            }

            button.addEventListener('click', () => {
                if (item.id !== activeAlbumId) {
                    pendingPhotoId = null;
                    selectAlbum(item.id);
                }
            });

            albumNav.appendChild(button);
        });
    }

    function fetchPublicPhotos() {
        const endpoint = buildFlickrUrl('flickr.people.getPublicPhotos', {
            per_page: '500',
            extras: PHOTO_EXTRAS
        });

        return fetchJsonWithRetry(endpoint).then((data) => {
            const photos = normalizePhotoList(data && data.photos && data.photos.photo ? data.photos.photo : []);
            publicPhotos = photos;
            albumPhotoCache.set('all', photos);
            saveToCache(CACHE_PUBLIC_PHOTOS_KEY, photos);
            updateLastUpdated();
            return photos;
        });
    }

    function fetchAlbums() {
        const endpoint = buildFlickrUrl('flickr.photosets.getList', {
            per_page: '500'
        });

        return fetchJsonWithRetry(endpoint).then((data) => {
            const sets = data && data.photosets && data.photosets.photoset ? data.photosets.photoset : [];
            albums = normalizeAlbumList(sets.map((set) => ({
                id: set.id,
                title: set.title && set.title._content ? set.title._content : 'Untitled album',
                count: Number(set.photos || 0)
            })));

            saveToCache(CACHE_ALBUMS_KEY, albums);

            return albums;
        });
    }

    function fetchAlbumPhotos(albumId) {
        if (albumPhotoCache.has(albumId)) {
            return Promise.resolve(albumPhotoCache.get(albumId));
        }

        const endpoint = buildFlickrUrl('flickr.photosets.getPhotos', {
            photoset_id: albumId,
            per_page: '500',
            extras: PHOTO_EXTRAS
        });

        return fetchJsonWithRetry(endpoint).then((data) => {
            const photos = normalizePhotoList(data && data.photoset && data.photoset.photo ? data.photoset.photo : []);
            albumPhotoCache.set(albumId, photos);
            return photos;
        });
    }

    function selectAlbum(albumId, options) {
        const opts = options || {};
        activeAlbumId = albumId;
        renderAlbumNav();

        if (!opts.skipLoadingState) {
            showUiLoadingState('Loading album...');
        }

        return fetchAlbumPhotos(activeAlbumId)
            .then((photos) => {
                setVisiblePhotos(photos, { updateHash: !opts.skipHashUpdate });
                clearStatus();
            })
            .catch((error) => {
                console.error(error);
                showUiErrorState('Could not load the selected album right now.');
            });
    }

    function ensurePhotoRendered(photoId) {
        const index = visiblePhotos.findIndex((photo) => String(photo.id) === String(photoId));
        if (index === -1) {
            return -1;
        }

        if (index >= renderedCount) {
            renderedCount = index + 1;
            updateGalleryMeta();
            updateLoadMoreButton();
            renderGallery();
        }

        return currentRenderedPhotos().findIndex((photo) => String(photo.id) === String(photoId));
    }

    function openPhotoById(photoId) {
        const renderedIndex = ensurePhotoRendered(photoId);
        if (renderedIndex === -1) {
            return false;
        }

        openLightbox(renderedIndex);
        return true;
    }

    function applyPendingHashRoute() {
        if (pendingAlbumSlug) {
            const albumId = findAlbumIdBySlug(pendingAlbumSlug);
            pendingAlbumSlug = null;

            if (albumId && albumId !== activeAlbumId) {
                return selectAlbum(albumId, { skipLoadingState: true, skipHashUpdate: true })
                    .then(() => applyPendingPhotoHash());
            }
        }

        return applyPendingPhotoHash();
    }

    function applyPendingPhotoHash() {
        if (!pendingPhotoId) {
            return Promise.resolve();
        }

        const photoId = pendingPhotoId;
        pendingPhotoId = null;

        if (openPhotoById(photoId)) {
            return Promise.resolve();
        }

        setLocationHash('');
        return Promise.resolve();
    }

    function lightboxFocusableElements() {
        return Array.from(lightboxEl.querySelectorAll('button:not([disabled])'));
    }

    function trapLightboxFocus(event) {
        if (event.key !== 'Tab') {
            return;
        }

        const focusables = lightboxFocusableElements();
        if (!focusables.length) {
            event.preventDefault();
            return;
        }

        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;

        if (event.shiftKey && active === first) {
            event.preventDefault();
            last.focus();
            return;
        }

        if (!event.shiftKey && active === last) {
            event.preventDefault();
            first.focus();
        }
    }

    function updateLightbox() {
        const renderedPhotos = currentRenderedPhotos();
        const photo = renderedPhotos[currentPhotoIndex];
        if (!photo) {
            return;
        }

        lightboxImage.src = lightboxPhotoSource(photo).url;
        lightboxImage.alt = photo.title || 'Flickr photo';

        lightboxPrev.disabled = currentPhotoIndex <= 0;
        lightboxNext.disabled = currentPhotoIndex >= renderedPhotos.length - 1;

        updatePhotoHash(photo);
    }

    function openLightbox(index) {
        currentPhotoIndex = index;
        updateLightbox();
        lightboxLastFocusedEl = document.activeElement;
        lightboxEl.classList.add('is-open');
        lightboxEl.setAttribute('aria-hidden', 'false');
        document.body.classList.add('no-scroll');
        lightboxClose.focus();
    }

    function closeLightbox() {
        lightboxEl.classList.remove('is-open');
        lightboxEl.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('no-scroll');
        currentPhotoIndex = -1;
        updateAlbumHash();

        if (lightboxLastFocusedEl && typeof lightboxLastFocusedEl.focus === 'function') {
            lightboxLastFocusedEl.focus();
        }
    }

    function moveLightbox(step) {
        const renderedPhotos = currentRenderedPhotos();
        const nextIndex = currentPhotoIndex + step;
        if (nextIndex < 0 || nextIndex >= renderedPhotos.length) {
            return;
        }

        currentPhotoIndex = nextIndex;
        updateLightbox();
    }

    function fetchPhotos() {
        showUiLoadingState('Loading photos...');

        Promise.all([fetchPublicPhotos(), fetchAlbums()])
            .then(([photos]) => {
                if (!photos.length) {
                    setStatus('No public photos available yet.', false);
                    renderAlbumNav();
                    return applyPendingHashRoute();
                }

                renderAlbumNav();
                setVisiblePhotos(photos, { updateHash: !pendingAlbumSlug && !pendingPhotoId });
                clearStatus();
                return applyPendingHashRoute();
            })
            .catch((error) => {
                console.error(error);

                const cachedPhotos = readFromCache(CACHE_PUBLIC_PHOTOS_KEY);
                const cachedAlbums = readFromCache(CACHE_ALBUMS_KEY);

                const safeCachedPhotos = normalizePhotoList(cachedPhotos);
                const safeCachedAlbums = normalizeAlbumList(cachedAlbums);

                if (safeCachedPhotos.length) {
                    publicPhotos = safeCachedPhotos;
                    albumPhotoCache.set('all', safeCachedPhotos);

                    if (safeCachedAlbums.length) {
                        albums = safeCachedAlbums;
                    }

                    updateLastUpdated();
                    renderAlbumNav();
                    setVisiblePhotos(safeCachedPhotos, { updateHash: !pendingAlbumSlug && !pendingPhotoId });
                    setStatus('Live data is unavailable. Showing your last loaded gallery.', false);
                    updateRetryButton(true);
                    return applyPendingHashRoute();
                }

                showUiErrorState('Could not load Flickr photos right now. Please try again.');
            });
    }

    if (loadMoreBtn) {
        loadMoreBtn.addEventListener('click', () => {
            renderedCount = Math.min(renderedCount + PAGE_SIZE, visiblePhotos.length);
            updateGalleryMeta();
            updateLoadMoreButton();
            renderGallery();
        });
    }

    if (retryLoadBtn) {
        retryLoadBtn.addEventListener('click', () => {
            fetchPhotos();
        });
    }

    lightboxClose.addEventListener('click', closeLightbox);
    lightboxPrev.addEventListener('click', (event) => {
        event.stopPropagation();
        moveLightbox(-1);
    });
    lightboxNext.addEventListener('click', (event) => {
        event.stopPropagation();
        moveLightbox(1);
    });
    lightboxEl.addEventListener('click', (event) => {
        if (event.target === lightboxEl) {
            closeLightbox();
        }
    });

    window.addEventListener('error', (event) => {
        reportClientIssue({
            type: 'error',
            message: event.message,
            file: event.filename,
            line: event.lineno,
            column: event.colno
        });
    });

    window.addEventListener('unhandledrejection', (event) => {
        reportClientIssue({
            type: 'unhandledrejection',
            message: event.reason && event.reason.message ? event.reason.message : String(event.reason)
        });
    });

    window.addEventListener('offline', () => {
        setStatus('You appear to be offline. Some actions may fail until connection returns.', true);
    });

    window.addEventListener('online', () => {
        setStatus('Connection restored.', false);
    });

    document.addEventListener('keydown', (event) => {
        if (!lightboxEl.classList.contains('is-open')) {
            return;
        }

        trapLightboxFocus(event);

        if (event.key === 'Escape') {
            closeLightbox();
            return;
        }

        if (event.key === 'ArrowLeft') {
            moveLightbox(-1);
            return;
        }

        if (event.key === 'ArrowRight') {
            moveLightbox(1);
        }
    });

    fetchPhotos();
});
