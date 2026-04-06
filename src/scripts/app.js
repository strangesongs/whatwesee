document.addEventListener('DOMContentLoaded', () => {
    const apiKey = 'b78aa973eab5e39787fc5e2a08cdfaf5';
    const userId = '196014147@N05';
    const apiBase = 'https://api.flickr.com/services/rest/';
    const PAGE_SIZE = 24;

    const galleryEl = document.getElementById('photo-gallery');
    const statusEl = document.getElementById('status');
    const albumRail = document.getElementById('album-rail');
    const galleryMetaEl = document.getElementById('gallery-meta');
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

        return fetchJson(endpoint).then((data) => {
            const photos = data && data.photos && data.photos.photo ? data.photos.photo : [];
            publicPhotos = photos;
            albumPhotoCache.set('all', photos);
            return photos;
        });
    }

    function fetchAlbums() {
        const endpoint = buildFlickrUrl('flickr.photosets.getList', {
            per_page: '500'
        });

        return fetchJson(endpoint).then((data) => {
            const sets = data && data.photosets && data.photosets.photoset ? data.photosets.photoset : [];
            albums = sets.map((set) => ({
                id: set.id,
                title: set.title && set.title._content ? set.title._content : 'Untitled album',
                count: Number(set.photos || 0)
            }));

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

        return fetchJson(endpoint).then((data) => {
            const photos = data && data.photoset && data.photoset.photo ? data.photoset.photo : [];
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
        setStatus('Loading album...');

        fetchAlbumPhotos(activeAlbumId)
            .then((photos) => {
                setVisiblePhotos(photos);
            })
            .catch((error) => {
                console.error(error);
                setStatus('Could not load the selected album right now.', true);
            });
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
        lightboxEl.classList.add('is-open');
        lightboxEl.setAttribute('aria-hidden', 'false');
        document.body.classList.add('no-scroll');
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
        setStatus('Loading photos...');

        Promise.all([fetchPublicPhotos(), fetchAlbums()])
            .then(([photos]) => {
                if (!photos.length) {
                    setStatus('No public photos available yet.', true);
                    renderAlbumRail();
                    return;
                }

                renderAlbumRail();
                setVisiblePhotos(photos);
            })
            .catch((error) => {
                console.error(error);
                setStatus('Could not load Flickr photos right now. Please try again later.', true);
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

    document.addEventListener('keydown', (event) => {
        if (!lightboxEl.classList.contains('is-open')) {
            return;
        }

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
