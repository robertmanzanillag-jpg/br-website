(() => {
  const container = document.getElementById('collections');
  const dialog = document.getElementById('lightbox');
  const fullPhoto = document.getElementById('full-photo');
  const caption = document.getElementById('caption');
  let collections = [];
  let filter = 'all';
  let photos = [];
  let photoIndex = 0;

  function element(tag, value = '', className = '') {
    const node = document.createElement(tag);
    node.textContent = value;
    node.className = className;
    return node;
  }
  function showPhoto(index) {
    photoIndex = (index + photos.length) % photos.length;
    const photo = photos[photoIndex];
    fullPhoto.src = photo.url;
    fullPhoto.alt = photo.title;
    caption.textContent = `${photo.title} · ${photo.collection}`;
    if (!dialog.open) dialog.showModal();
  }
  function render() {
    container.replaceChildren();
    photos = collections.flatMap(collection => collection.media.filter(item => item.type === 'image').map(item => ({ ...item, collection: collection.title })));
    let shown = 0;
    for (const collection of collections) {
      const items = collection.media.filter(item => filter === 'all' || item.type === filter);
      if (!items.length) continue;
      shown += items.length;
      const section = element('section', '', 'collection');
      const head = element('div', '', 'collection-head');
      head.append(element('h2', collection.title));
      const meta = element('div', `${items.length} items shown`, 'collection-meta');
      const source = element('a', 'Original collection ↗');
      source.href = collection.sourceUrl;
      source.target = '_blank';
      source.rel = 'noopener noreferrer';
      meta.append(source);
      head.append(meta);
      section.append(head);
      const grid = element('div', '', 'grid');
      for (const item of items) {
        const card = element('div', '', 'media-card');
        if (item.type === 'image') {
          const button = element('button', '', 'photo-button');
          button.type = 'button';
          button.setAttribute('aria-label', `View ${item.title}`);
          const image = document.createElement('img');
          image.src = item.url;
          image.alt = item.title;
          image.loading = 'lazy';
          button.append(image);
          button.addEventListener('click', () => showPhoto(photos.findIndex(photo => photo.url === item.url)));
          card.append(button);
        } else {
          const link = element('a', '', 'video-link');
          link.href = item.url;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.setAttribute('aria-label', `Watch ${item.title}`);
          link.append(element('span', item.title));
          card.append(link);
        }
        grid.append(card);
      }
      section.append(grid);
      container.append(section);
    }
    if (!shown) container.append(element('p', 'No media available in this category.', 'empty'));
  }
  document.querySelectorAll('.filter').forEach(button => button.addEventListener('click', () => {
    filter = button.dataset.filter;
    document.querySelectorAll('.filter').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    render();
  }));
  document.getElementById('close').addEventListener('click', () => dialog.close());
  document.getElementById('previous').addEventListener('click', () => showPhoto(photoIndex - 1));
  document.getElementById('next').addEventListener('click', () => showPhoto(photoIndex + 1));
  dialog.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft') showPhoto(photoIndex - 1);
    if (event.key === 'ArrowRight') showPhoto(photoIndex + 1);
  });
  fetch('/data/bank-media.json')
    .then(response => { if (!response.ok) throw new Error('Media unavailable'); return response.json(); })
    .then(data => { collections = data; render(); })
    .catch(() => { container.replaceChildren(element('p', 'Media could not be loaded. Please try again later.', 'empty')); });
})();
