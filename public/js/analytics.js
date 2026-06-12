// Black Room Analytics Tracking Script
(function() {
  const SESSION_KEY = 'br_session_id';
  const TRACKED_KEY = 'br_page_tracked';
  
  function getSessionId() {
    let sessionId = sessionStorage.getItem(SESSION_KEY);
    if (!sessionId) {
      sessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      sessionStorage.setItem(SESSION_KEY, sessionId);
    }
    return sessionId;
  }
  
  const sessionId = getSessionId();
  let startTime = Date.now();
  let maxScroll = 0;
  
  // Track scroll depth
  function updateScrollDepth() {
    const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
    if (scrollHeight > 0) {
      const scrollPercent = Math.round((window.scrollY / scrollHeight) * 100);
      if (scrollPercent > maxScroll) maxScroll = scrollPercent;
    }
  }
  
  // Track page view on load
  function trackPageView() {
    const pageKey = TRACKED_KEY + '_' + window.location.pathname;
    if (sessionStorage.getItem(pageKey)) return;
    
    const data = {
      page_url: window.location.pathname,
      page_title: document.title,
      session_id: sessionId,
      referrer: document.referrer || 'direct',
      screen_width: window.screen.width,
      screen_height: window.screen.height,
      language: navigator.language,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    };
    
    fetch('/api/analytics/pageview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(() => {
      sessionStorage.setItem(pageKey, '1');
    }).catch(() => {});
  }
  
  // Update time on page before leaving
  function updateTimeOnPage() {
    const timeSpent = Math.round((Date.now() - startTime) / 1000);
    navigator.sendBeacon('/api/analytics/pageview/update', JSON.stringify({
      session_id: sessionId,
      page_url: window.location.pathname,
      time_spent: timeSpent,
      scroll_depth: maxScroll
    }));
  }
  
  // Shop tracking functions
  window.brTrackShop = function(eventType, product) {
    const data = {
      event_type: eventType,
      product_id: product.id,
      product_name: product.name,
      product_price: product.price,
      product_size: product.size || null,
      quantity: product.quantity || 1,
      session_id: sessionId,
      referrer_domain: document.referrer ? new URL(document.referrer).hostname : null
    };
    
    fetch('/api/analytics/shop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).catch(() => {});
  };
  
  // Video tracking functions
  window.brTrackVideo = function(eventType, video) {
    const data = {
      event_type: eventType,
      video_id: video.id,
      video_title: video.title,
      video_duration: video.duration || 0,
      watch_time: video.watchTime || 0,
      watch_percentage: video.watchPercentage || 0,
      session_id: sessionId
    };
    
    fetch('/api/analytics/video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).catch(() => {});
  };
  
  // Get session ID for other scripts
  window.brGetSessionId = function() {
    return sessionId;
  };
  
  // Event listeners
  window.addEventListener('scroll', updateScrollDepth, { passive: true });
  window.addEventListener('beforeunload', updateTimeOnPage);
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'hidden') updateTimeOnPage();
  });
  
  // Track page view when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', trackPageView);
  } else {
    trackPageView();
  }
})();
