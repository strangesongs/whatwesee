document.addEventListener('DOMContentLoaded', function() {
    const photoGallery = document.getElementById('photo-gallery');
    const apiKey = 'b78aa973eab5e39787fc5e2a08cdfaf5';  // Using direct API key for now
    const userId = '196014147@N05';
    const photosPerPage = 12;
    let currentPage = 1;
    let allPhotos = [];

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
        pagePhotos.forEach(photo => {
            const img = document.createElement('img');
            img.src = `https://live.staticflickr.com/${photo.server}/${photo.id}_${photo.secret}_b.jpg`;
            img.alt = photo.title;
            
            const largeImageUrl = `https://live.staticflickr.com/${photo.server}/${photo.id}_${photo.secret}_b.jpg`;
            
            img.addEventListener('click', () => {
                modal.innerHTML = `<img src="${largeImageUrl}" alt="${photo.title}">`;
                modal.style.display = 'block';
            });
            
            photoGallery.appendChild(img);
        });

        // Update pagination buttons
        updatePagination();
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
        if (e.key === 'Escape' && modal.style.display === 'block') {
            modal.style.display = 'none';
        }
    });
});
