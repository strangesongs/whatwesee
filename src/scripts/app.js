document.addEventListener('DOMContentLoaded', function() {
    const photoGallery = document.getElementById('photo-gallery');
    const apiKey = 'b78aa973eab5e39787fc5e2a08cdfaf5';  // Using direct API key for now
    const userId = '196014147@N05';
    const photosPerPage = 12;
    let currentPage = 1;
    let allPhotos = [];
    let currentPhotoIndex = 0;

    // Create pagination container
    const pagination = document.createElement('div');
    pagination.className = 'pagination';
    document.body.insertBefore(pagination, photoGallery.nextSibling);

    // Create modal container
    const modal = document.createElement('div');
    modal.className = 'modal';
    document.body.appendChild(modal);

    // Function to display photos for current page
    function displayPhotos(page) {
        const start = (page - 1) * photosPerPage;
        const end = start + photosPerPage;
        const pagePhotos = allPhotos.slice(start, end);
        
        photoGallery.innerHTML = '';
        pagePhotos.forEach((photo, index) => {
            const img = document.createElement('img');
            img.src = `https://live.staticflickr.com/${photo.server}/${photo.id}_${photo.secret}_b.jpg`;
            img.alt = photo.title;
            
            const largeImageUrl = `https://live.staticflickr.com/${photo.server}/${photo.id}_${photo.secret}_b.jpg`;
            
            img.addEventListener('click', () => {
                currentPhotoIndex = start + index;
                showPhotoInModal(currentPhotoIndex);
            });
            
            photoGallery.appendChild(img);
        });

        updatePagination();
    }

    function showPhotoInModal(index) {
        const photo = allPhotos[index];
        const largeImageUrl = `https://live.staticflickr.com/${photo.server}/${photo.id}_${photo.secret}_b.jpg`;
        modal.innerHTML = `
            <img src="${largeImageUrl}" alt="${photo.title}">
            <div class="modal-nav">
                <button class="modal-prev">&lt;</button>
                <button class="modal-next">&gt;</button>
            </div>
        `;
        modal.style.display = 'block';

        // Add click handlers for navigation buttons
        modal.querySelector('.modal-prev').addEventListener('click', (e) => {
            e.stopPropagation();
            navigatePhotos('prev');
        });

        modal.querySelector('.modal-next').addEventListener('click', (e) => {
            e.stopPropagation();
            navigatePhotos('next');
        });
    }

    function navigatePhotos(direction) {
        if (direction === 'prev' && currentPhotoIndex > 0) {
            currentPhotoIndex--;
            showPhotoInModal(currentPhotoIndex);
        } else if (direction === 'next' && currentPhotoIndex < allPhotos.length - 1) {
            currentPhotoIndex++;
            showPhotoInModal(currentPhotoIndex);
        }
    }

    // Function to update pagination buttons
    function updatePagination() {
        const totalPages = Math.ceil(allPhotos.length / photosPerPage);
        pagination.innerHTML = `
            <button ${currentPage === 1 ? 'disabled' : ''} onclick="changePage(${currentPage - 1})">←</button>
            <span>${currentPage} / ${totalPages}</span>
            <button ${currentPage === totalPages ? 'disabled' : ''} onclick="changePage(${currentPage + 1})">→</button>
        `;
    }

    // Function to change page
    window.changePage = function(page) {
        currentPage = page;
        displayPhotos(currentPage);
    };

    // Fetch photos
    const flickrAPI = `https://api.flickr.com/services/rest/?method=flickr.people.getPublicPhotos&api_key=${apiKey}&user_id=${userId}&format=json&nojsoncallback=1&per_page=500`;

    fetch(flickrAPI)
        .then(response => response.json())
        .then(data => {
            if (data.photos && data.photos.photo) {
                allPhotos = data.photos.photo;
                displayPhotos(currentPage);
            } else {
                console.error('No photos found in the response data.');
            }
        })
        .catch(error => console.error('Error fetching photos:', error));

    // Modal close handlers
    modal.addEventListener('click', () => {
        modal.style.display = 'none';
    });

    document.addEventListener('keydown', (e) => {
        if (modal.style.display === 'block') {
            switch(e.key) {
                case 'Escape':
                    modal.style.display = 'none';
                    break;
                case 'ArrowLeft':
                    navigatePhotos('prev');
                    break;
                case 'ArrowRight':
                    navigatePhotos('next');
                    break;
            }
        }
    });
});
