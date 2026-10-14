// Verified artwork from the linked DICE events. Explicit metadata overrides defaults.
(function () {
  const defaults = [
    {
      title: 'KANDER @THE GROUND',
      url: 'https://link.dice.fm/vFE9sreUF6b',
      image: 'https://dice-media.imgix.net/attachments/2026-09-24/8b558993-dabb-4802-9ccd-57970fc7fc02.jpg?w=320&auto=format,compress'
    },
    {
      title: 'KLOUD @STUDIO60',
      url: 'https://link.dice.fm/blackroom',
      image: 'https://dice-media.imgix.net/attachments/2026-09-03/a5337700-a5ba-46bc-9c6b-7dc45d065af1.jpg?w=320&auto=format,compress'
    }
  ];

  function safeImageUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return '';
    const raw = value.trim();
    if (raw.startsWith('/') && !raw.startsWith('//') && !raw.includes('\\')) return raw;
    try {
      const url = new URL(raw);
      return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
    } catch {
      return '';
    }
  }

  function imageUrl(link) {
    const meta = link.metadata || {};
    // An empty explicit value lets the editor remove an automatic flyer.
    if (Object.prototype.hasOwnProperty.call(meta, 'image_url')) return safeImageUrl(meta.image_url);
    let destination;
    try {
      const url = new URL(link.url);
      destination = url.origin + url.pathname.replace(/\/$/, '');
    } catch {
      return '';
    }
    const title = String(link.title || '').toUpperCase().replace(/\s+/g, '');
    const match = defaults.find(item => item.url === destination && item.title.replace(/\s+/g, '') === title);
    return match ? match.image : '';
  }

  function escapeAttribute(value) {
    return String(value || '').replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }

  function render(link, fallbackIcon) {
    const image = imageUrl(link);
    if (!image) return fallbackIcon;
    return `<img class="link-flyer" src="${escapeAttribute(image)}" alt="${escapeAttribute(link.title)} flyer" loading="lazy" decoding="async" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><span hidden>${fallbackIcon}</span>`;
  }

  const pending = new Map();
  async function resolve(url) {
    if (!pending.has(url)) {
      const request = fetch('/api/admin/link-flyer', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      }).then(async response => {
        if (!response.ok) return '';
        return safeImageUrl((await response.json()).image_url);
      }).catch(() => '').finally(() => pending.delete(url));
      pending.set(url, request);
    }
    return pending.get(url);
  }

  window.LinkFlyers = { imageUrl, safeImageUrl, escapeAttribute, render, resolve };
})();
