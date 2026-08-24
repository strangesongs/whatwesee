document.addEventListener('DOMContentLoaded', () => {
    const statusEl = document.getElementById('status');
    const galleryEl = document.getElementById('photo-gallery');
    const albumNav = document.getElementById('album-nav');
    const loadMoreBtn = document.getElementById('load-more');
    const retryLoadBtn = document.getElementById('retry-load');
    const lightboxEl = document.getElementById('lightbox');

    if (albumNav) albumNav.hidden = true;
    if (loadMoreBtn) loadMoreBtn.hidden = true;
    if (retryLoadBtn) retryLoadBtn.hidden = true;
    if (lightboxEl) lightboxEl.hidden = true;

    if (galleryEl) {
        galleryEl.innerHTML = '';
    }

    if (statusEl) {
        statusEl.classList.remove('is-error');
        statusEl.innerHTML = 'This archive no longer loads from Flickr. Live gallery: <a href="https://strangesongs.github.io/photography.html">strangesongs.github.io/photography.html</a>';
    }
});
