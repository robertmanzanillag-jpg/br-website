(() => {
  const container = document.getElementById('collections');
  const photoDialog = document.getElementById('lightbox');
  const fullPhoto = document.getElementById('full-photo');
  const caption = document.getElementById('caption');
  const videoDialog = document.getElementById('video-viewer');
  const videoStage = document.getElementById('video-stage');
  const videoTitle = document.getElementById('video-title');
  let collections = [];
  let filter = 'all';
  let photos = [];
  let photoIndex = 0;
  let touchStartX = null;
  const previewObserver = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.src = entry.target.dataset.src;
      entry.target.preload = 'metadata';
      previewObserver.unobserve(entry.target);
    }
  }, { rootMargin: '400px' }) : null;

  function element(tag, value = '', className = '') {
    const node = document.createElement(tag);
    node.textContent = value;
    node.className = className;
    return node;
  }

  function driveId(url) {
    return url?.match(/drive\.google\.com\/file\/d\/([^/]+)/)?.[1] || null;
  }

  function posterFor(item) {
    const id = driveId(item.url);
    return item.poster || (id ? `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w640` : '/images/logo.png');
  }

  function showPhoto(index) {
    if (!photos.length) return;
    photoIndex = (index + photos.length) % photos.length;
    const photo = photos[photoIndex];
    fullPhoto.src = photo.url;
    fullPhoto.alt = photo.title;
    caption.textContent = photo.collection;
    if (!photoDialog.open) photoDialog.showModal();
  }

  function closeVideo() {
    videoDialog.close();
    videoStage.replaceChildren();
  }

  function showVideo(item, collectionTitle) {
    videoStage.replaceChildren();
    videoTitle.textContent = collectionTitle;
    const id = driveId(item.url);
    if (item.sourceProvider === 'zoho' || item.sourceProvider === 'dropbox' || item.mimeType?.startsWith('video/') || (item.url && /\.(mp4|webm|ogg)(\?|$)/i.test(item.url))) {
      const video = document.createElement('video');
      video.src = item.url;
      video.poster = posterFor(item);
      video.controls = true;
      video.playsInline = true;
      video.preload = 'metadata';
      videoStage.append(video);
    } else if (id || item.embedUrl) {
      const frame = document.createElement('iframe');
      frame.src = item.embedUrl || `https://drive.google.com/file/d/${encodeURIComponent(id)}/preview`;
      frame.title = item.title;
      frame.allow = 'autoplay; fullscreen; picture-in-picture';
      frame.allowFullscreen = true;
      frame.referrerPolicy = 'no-referrer-when-downgrade';
      videoStage.append(frame);
    } else {
      videoStage.append(element('p', 'This video is temporarily unavailable.', 'video-unavailable'));
    }
    videoDialog.showModal();
  }

  function makeCard(item, collectionTitle) {
    const card = element('div', '', 'media-card');
    const button = element('button', '', item.type === 'image' ? 'photo-button' : 'video-button');
    button.type = 'button';
    button.setAttribute('aria-label', `${item.type === 'image' ? 'View' : 'Play'} ${item.title}`);
    if (item.type === 'video') {
      if (item.sourceProvider === 'dropbox' && !item.poster) {
        const preview = document.createElement('video');
        preview.className = 'video-preview';
        preview.dataset.src = item.url;
        preview.preload = 'none';
        preview.muted = true;
        preview.playsInline = true;
        preview.setAttribute('aria-hidden', 'true');
        if (previewObserver) previewObserver.observe(preview);
        else { preview.src = item.url; preview.preload = 'metadata'; }
        button.append(preview);
      } else {
        const image = document.createElement('img');
        image.src = posterFor(item);
        image.alt = `Preview of ${item.title}`;
        image.loading = 'lazy';
        image.decoding = 'async';
        image.addEventListener('error', () => {
          if (!image.src.endsWith('/images/logo.png')) image.src = '/images/logo.png';
        }, { once: true });
        button.append(image);
      }
      button.append(element('span', '▶', 'play-icon'));
      button.addEventListener('click', () => showVideo(item, collectionTitle));
    } else {
      const image = document.createElement('img');
      image.src = item.url;
      image.alt = item.title;
      image.loading = 'lazy';
      image.decoding = 'async';
      button.append(image);
      button.addEventListener('click', () => {
        const index = photos.findIndex(photo => photo.url === item.url);
        if (index >= 0) showPhoto(index);
      });
    }
    card.append(button);
    return card;
  }

  function makeCarousel(items, title) {
    const shell = element('div', '', 'carousel-shell');
    const track = element('div', '', 'media-track');
    track.setAttribute('role', 'region');
    track.setAttribute('aria-label', `${title} carousel`);
    track.tabIndex = 0;
    let rendered = 0;
    const appendBatch = () => {
      const fragment = document.createDocumentFragment();
      for (const item of items.slice(rendered, rendered + 24)) fragment.append(makeCard(item, title));
      rendered = Math.min(rendered + 24, items.length);
      track.append(fragment);
    };
    appendBatch();
    track.addEventListener('scroll', () => {
      if (track.scrollLeft + track.clientWidth >= track.scrollWidth - track.clientWidth * 1.5 && rendered < items.length) appendBatch();
    }, { passive: true });
    const controls = element('div', '', 'carousel-nav');
    const previous = element('button', '‹', 'carousel-arrow');
    previous.type = 'button';
    previous.setAttribute('aria-label', `Scroll ${title} left`);
    const next = element('button', '›', 'carousel-arrow');
    next.type = 'button';
    next.setAttribute('aria-label', `Scroll ${title} right`);
    const scroll = direction => {
      if (direction > 0 && track.scrollLeft + track.clientWidth >= track.scrollWidth - track.clientWidth * 2 && rendered < items.length) appendBatch();
      const card = track.querySelector('.media-card');
      if (!card) return;
      const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
      track.scrollBy({ left: direction * (card.getBoundingClientRect().width + gap) * 2, behavior: 'smooth' });
    };
    previous.addEventListener('click', () => scroll(-1));
    next.addEventListener('click', () => scroll(1));
    track.addEventListener('keydown', event => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        scroll(event.key === 'ArrowRight' ? 1 : -1);
      }
    });
    controls.append(previous, next);
    shell.append(track, controls);
    return shell;
  }

  function render() {
    previewObserver?.disconnect();
    container.replaceChildren();
    photos = collections.flatMap(collection => collection.media
      .filter(item => item.type === 'image')
      .map(item => ({ ...item, collection: collection.title })));
    let shown = 0;
    for (const collection of collections) {
      const items = collection.media.filter(item => filter === 'all' || item.type === filter);
      if (!items.length) continue;
      shown += items.length;
      const section = element('section', '', 'collection');
      const head = element('div', '', 'collection-head');
      head.append(element('h2', collection.title));
      section.append(head, makeCarousel(items, collection.title));
      container.append(section);
    }
    if (!shown) container.append(element('p', 'No media available in this category.', 'empty'));
  }

  document.querySelectorAll('.filter').forEach(button => button.addEventListener('click', () => {
    filter = button.dataset.filter;
    document.querySelectorAll('.filter').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    render();
  }));
  document.getElementById('close').addEventListener('click', () => photoDialog.close());
  document.getElementById('previous').addEventListener('click', () => showPhoto(photoIndex - 1));
  document.getElementById('next').addEventListener('click', () => showPhoto(photoIndex + 1));
  document.getElementById('close-video').addEventListener('click', closeVideo);
  videoDialog.addEventListener('close', () => videoStage.replaceChildren());
  photoDialog.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft') showPhoto(photoIndex - 1);
    if (event.key === 'ArrowRight') showPhoto(photoIndex + 1);
  });
  photoDialog.addEventListener('touchstart', event => {
    touchStartX = event.changedTouches[0]?.screenX ?? null;
  }, { passive: true });
  photoDialog.addEventListener('touchend', event => {
    if (touchStartX === null) return;
    const delta = (event.changedTouches[0]?.screenX ?? touchStartX) - touchStartX;
    if (Math.abs(delta) > 55) showPhoto(photoIndex + (delta < 0 ? 1 : -1));
    touchStartX = null;
  }, { passive: true });

  fetch('/data/bank-media.json', { cache: 'no-store' })
    .then(response => { if (!response.ok) throw new Error('Media unavailable'); return response.json(); })
    .then(data => {
      collections = data.filter(collection => collection.row !== 46 && collection.row !== 47 && !/high voltage/i.test(collection.title));
      render();
    })
    .catch(() => { container.replaceChildren(element('p', 'Media could not be loaded. Please try again later.', 'empty')); });
})();
