document.addEventListener('DOMContentLoaded', () => {
    const apiKey = 'b78aa973eab5e39787fc5e2a08cdfaf5';
    const userId = '196014147@N05';
    const apiBase = 'https://api.flickr.com/services/rest/';
    const PAGE_SIZE = 24;

    const galleryEl = document.getElementById('photo-gallery');
    const statusEl = document.getElementById('status');
    const albumRail = document.getElementById('album-rail');
    const galleryMetaEl = document.getElementById('gallery-meta');
    const retryLoadBtn = document.getElementById('retry-load');
    const loadMoreBtn = document.getElementById('load-more');

    const lightboxEl = document.getElementById('lightbox');
    const lightboxImage = document.getElementById('lightbox-image');
    const lightboxClose = document.getElementById('lightbox-close');
    const lightboxPrev = document.getElementById('lightbox-prev');
    const lightboxNext = document.getElementById('lightbox-next');

    let visiblePhotos = [];
    let renderedCount = 0;
    let activeAlbumId = 'all';
    let activeAlbumLabel = 'All photos';
    let currentPhotoIndex = -1;
    let publicPhotos = [];
    const albumPhotoCache = new Map();
    let albums = [];
    let isRailPointerDown = false;
    let isRailDragging = false;
    let railStartX = 0;
    let railStartScrollLeft = 0;
    let suppressRailClick = false;
    const desktopHoverMedia = window.matchMedia('(hover: hover) and (pointer: fine)');
    let lightboxControlsTimer = null;
    let lightboxLastFocusedEl = null;

    const FETCH_TIMEOUT_MS = 9000;
    const FETCH_MAX_RETRIES = 2;
    const CACHE_PUBLIC_PHOTOS_KEY = 'whatwesee.publicPhotos.v1';
    const CACHE_ALBUMS_KEY = 'whatwesee.albums.v1';
    const CACHE_TTL_MS = 1000 * 60 * 60 * 24;
    const ERROR_MONITOR_URL = '';

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
                // Backward compatibility with older cache format.
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

    function bestPhotoSource(photo) {
        if (photo.url_l && photo.width_l && photo.height_l) {
            return {
                url: photo.url_l,
                width: Number(photo.width_l),
                height: Number(photo.height_l)
            };
        }

        if (photo.url_c && photo.width_c && photo.height_c) {
            return {
                url: photo.url_c,
                width: Number(photo.width_c),
                height: Number(photo.height_c)
            };
        }

        if (photo.url_z && photo.width_z && photo.height_z) {
            return {
                url: photo.url_z,
                width: Number(photo.width_z),
                height: Number(photo.height_z)
            };
        }

        return {
            url: `https://live.staticflickr.com/${photo.server}/${photo.id}_${photo.secret}_z.jpg`,
            width: 4,
            height: 5
        };
    }

    function setStatus(message, isError) {
        if (galleryMetaEl) {
            galleryMetaEl.textContent = message;
        }

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

    function photoCard(photo, index) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'photo-card';
        button.setAttribute('aria-label', photo.title || 'Open photo');

        const source = bestPhotoSource(photo);
        button.style.aspectRatio = `${source.width} / ${source.height}`;

        const image = document.createElement('img');
        image.src = source.url;
        image.alt = photo.title || 'Flickr photo';
        image.loading = 'lazy';
        image.decoding = 'async';
        image.width = source.width;
        image.height = source.height;

        button.appendChild(image);
        button.addEventListener('click', () => openLightbox(index));
        return button;
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
            galleryMetaEl.textContent = `0 photos in ${activeAlbumLabel}`;
            return;
        }

        galleryMetaEl.textContent = `Showing ${Math.min(renderedCount, visiblePhotos.length)} of ${visiblePhotos.length} in ${activeAlbumLabel}`;
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
        loadMoreBtn.textContent = `Load ${Math.min(PAGE_SIZE, remaining)} more`;
    }

    function setVisiblePhotos(photos) {
        visiblePhotos = photos.slice();
        renderedCount = Math.min(PAGE_SIZE, visiblePhotos.length);
        updateGalleryMeta();
        updateLoadMoreButton();
        renderGallery();
    }

    function buildFlickrUrl(method, params) {
        const query = new URLSearchParams({
            method,
            api_key: apiKey,
            user_id: userId,
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

    function renderAlbumRail() {
        albumRail.innerHTML = '';

        const allItem = {
            id: 'all',
            title: 'All photos',
            count: publicPhotos.length
        };

        const items = [allItem].concat(albums);

        items.forEach((item) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'album-pill';
            button.textContent = `${item.title} (${item.count})`;
            button.setAttribute('data-album-id', item.id);

            if (item.id === activeAlbumId) {
                button.classList.add('is-active');
            }

            albumRail.appendChild(button);
        });

        const activePill = albumRail.querySelector('.album-pill.is-active');
        if (activePill) {
            activePill.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        }
    }

    function setupAlbumRailDrag() {
        albumRail.addEventListener('pointerdown', (event) => {
            if (event.pointerType !== 'mouse' || event.button !== 0) {
                return;
            }

            isRailPointerDown = true;
            isRailDragging = false;
            railStartX = event.clientX;
            railStartScrollLeft = albumRail.scrollLeft;
            suppressRailClick = false;
        });

        albumRail.addEventListener('pointermove', (event) => {
            if (!isRailPointerDown) {
                return;
            }

            const deltaX = event.clientX - railStartX;
            if (Math.abs(deltaX) > 6) {
                isRailDragging = true;
                suppressRailClick = true;
                albumRail.classList.add('is-dragging');
                albumRail.scrollLeft = railStartScrollLeft - deltaX;
            }
        });

        function stopRailDrag() {
            isRailPointerDown = false;
            isRailDragging = false;
            albumRail.classList.remove('is-dragging');
        }

        albumRail.addEventListener('pointerup', stopRailDrag);
        albumRail.addEventListener('pointercancel', stopRailDrag);
        albumRail.addEventListener('pointerleave', () => {
            if (isRailDragging) {
                stopRailDrag();
            }
        });

        albumRail.addEventListener('click', (event) => {
            if (suppressRailClick) {
                event.preventDefault();
                event.stopPropagation();
                suppressRailClick = false;
                return;
            }

            const pill = event.target.closest('.album-pill');
            if (!pill) {
                return;
            }

            const nextAlbumId = pill.getAttribute('data-album-id');
            if (nextAlbumId && nextAlbumId !== activeAlbumId) {
                selectAlbum(nextAlbumId);
            }
        });
    }

    function fetchPublicPhotos() {
        const endpoint = buildFlickrUrl('flickr.people.getPublicPhotos', {
            per_page: '500',
            extras: 'url_z,url_c,url_l,width_z,height_z,width_c,height_c,width_l,height_l'
        });

        return fetchJsonWithRetry(endpoint).then((data) => {
            const photos = normalizePhotoList(data && data.photos && data.photos.photo ? data.photos.photo : []);
            publicPhotos = photos;
            albumPhotoCache.set('all', photos);
            saveToCache(CACHE_PUBLIC_PHOTOS_KEY, photos);
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
            extras: 'url_z,url_c,url_l,width_z,height_z,width_c,height_c,width_l,height_l'
        });

        return fetchJsonWithRetry(endpoint).then((data) => {
            const photos = normalizePhotoList(data && data.photoset && data.photoset.photo ? data.photoset.photo : []);
            albumPhotoCache.set(albumId, photos);
            return photos;
        });
    }

    function selectAlbum(albumId) {
        activeAlbumId = albumId;
        if (albumId === 'all') {
            activeAlbumLabel = 'All photos';
        } else {
            const match = albums.find((album) => album.id === albumId);
            activeAlbumLabel = match ? match.title : 'Album';
        }

        renderAlbumRail();
        showUiLoadingState('Loading album...');

        fetchAlbumPhotos(activeAlbumId)
            .then((photos) => {
                setVisiblePhotos(photos);
            })
            .catch((error) => {
                console.error(error);
                showUiErrorState('Could not load the selected album right now.');
            });
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

        lightboxImage.src = bestPhotoSource(photo).url;
        lightboxImage.alt = photo.title || 'Flickr photo';

        lightboxPrev.disabled = currentPhotoIndex <= 0;
        lightboxNext.disabled = currentPhotoIndex >= renderedPhotos.length - 1;
    }

    function openLightbox(index) {
        currentPhotoIndex = index;
        updateLightbox();
        lightboxLastFocusedEl = document.activeElement;
        lightboxEl.classList.add('is-open');
        lightboxEl.setAttribute('aria-hidden', 'false');
        document.body.classList.add('no-scroll');
        lightboxClose.focus();
        if (desktopHoverMedia.matches) {
            showLightboxArrows();
        }
    }

    function closeLightbox() {
        lightboxEl.classList.remove('is-open');
        lightboxEl.classList.remove('show-lightbox-arrows');
        lightboxEl.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('no-scroll');
        currentPhotoIndex = -1;
        if (lightboxControlsTimer) {
            window.clearTimeout(lightboxControlsTimer);
            lightboxControlsTimer = null;
        }

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

    function showLightboxArrows() {
        if (!desktopHoverMedia.matches || !lightboxEl.classList.contains('is-open')) {
            return;
        }

        lightboxEl.classList.add('show-lightbox-arrows');

        if (lightboxControlsTimer) {
            window.clearTimeout(lightboxControlsTimer);
        }

        lightboxControlsTimer = window.setTimeout(() => {
            lightboxEl.classList.remove('show-lightbox-arrows');
        }, 1100);
    }

    function fetchPhotos() {
        showUiLoadingState('Loading photos...');

        Promise.all([fetchPublicPhotos(), fetchAlbums()])
            .then(([photos]) => {
                if (!photos.length) {
                    setStatus('No public photos available yet.', false);
                    renderAlbumRail();
                    return;
                }

                renderAlbumRail();
                setVisiblePhotos(photos);
                clearStatus();
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

                    renderAlbumRail();
                    setVisiblePhotos(safeCachedPhotos);
                    setStatus('Live data is unavailable. Showing your last loaded gallery.', false);
                    updateRetryButton(true);
                    return;
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

    lightboxEl.addEventListener('mousemove', () => {
        showLightboxArrows();
    });

    lightboxEl.addEventListener('focusin', () => {
        if (desktopHoverMedia.matches) {
            lightboxEl.classList.add('show-lightbox-arrows');
        }
    });

    desktopHoverMedia.addEventListener('change', (event) => {
        if (!event.matches) {
            lightboxEl.classList.remove('show-lightbox-arrows');
            if (lightboxControlsTimer) {
                window.clearTimeout(lightboxControlsTimer);
                lightboxControlsTimer = null;
            }
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

    setupAlbumRailDrag();
    fetchPhotos();
});
