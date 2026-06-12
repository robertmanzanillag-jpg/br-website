/**
 * Smooth Page Transitions - Teletech.events Style
 * Uses Barba.js for AJAX page loading with fade + slide animations
 * TEMPORARILY DISABLED - causing script conflicts
 */

(function() {
  'use strict';

  // TEMPORARILY DISABLED - Barba.js causing conflicts with page scripts
  // Will be re-enabled after fixing script reinitialization
  console.log('ℹ️ Page transitions temporarily disabled for stability');
  return;

  if (window.pageTransitionsInitialized) return;
  window.pageTransitionsInitialized = true;

  const TRANSITION_DURATION = 400;
  let progressBar = null;

  function createProgressBar() {
    if (document.getElementById('page-progress-bar')) return;
    
    progressBar = document.createElement('div');
    progressBar.id = 'page-progress-bar';
    progressBar.innerHTML = '<div class="progress-fill"></div>';
    document.body.appendChild(progressBar);

    const style = document.createElement('style');
    style.textContent = `
      #page-progress-bar {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 2px;
        z-index: 999999;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.2s ease;
      }
      #page-progress-bar.loading {
        opacity: 1;
      }
      #page-progress-bar .progress-fill {
        height: 100%;
        width: 0%;
        background: linear-gradient(90deg, #ffffff, #888888);
        transition: width 0.3s ease;
      }
      
      .barba-leave-active,
      .barba-enter-active {
        transition: opacity ${TRANSITION_DURATION}ms ease, transform ${TRANSITION_DURATION}ms ease;
      }
      
      .barba-leave-to {
        opacity: 0;
        transform: translateY(-20px);
      }
      
      .barba-enter {
        opacity: 0;
        transform: translateY(20px);
      }
      
      .barba-enter-to {
        opacity: 1;
        transform: translateY(0);
      }
    `;
    document.head.appendChild(style);
  }

  function showProgress(percent) {
    if (!progressBar) return;
    progressBar.classList.add('loading');
    progressBar.querySelector('.progress-fill').style.width = percent + '%';
  }

  function hideProgress() {
    if (!progressBar) return;
    progressBar.querySelector('.progress-fill').style.width = '100%';
    setTimeout(() => {
      progressBar.classList.remove('loading');
      progressBar.querySelector('.progress-fill').style.width = '0%';
    }, 300);
  }

  function reinitializeScripts(container) {
    console.log('🔄 Reinitializing page scripts...');

    window.globalHeaderInitialized = false;
    if (typeof window.initGlobalHeader === 'function') {
      window.initGlobalHeader();
    }

    if (container.querySelector('.events-grid')) {
      if (typeof window.loadEvents === 'function') {
        window.loadEvents();
      }
    }

    if (container.querySelector('.video-carousel') || container.querySelector('.videos-grid')) {
      if (typeof window.loadVideos === 'function') {
        window.loadVideos();
      }
      if (typeof window.initVideoPage === 'function') {
        window.initVideoPage();
      }
    }

    if (container.querySelector('.shop-grid') || container.querySelector('.products-grid')) {
      if (typeof window.loadShop === 'function') {
        window.loadShop();
      }
      if (typeof window.initShopPage === 'function') {
        window.initShopPage();
      }
    }

    if (container.querySelector('.calendar') || container.querySelector('#calendar')) {
      if (typeof window.initCalendar === 'function') {
        window.initCalendar();
      }
    }

    if (container.querySelector('.about-liquid-bg') || container.querySelector('#about-liquid-container')) {
      if (typeof window.initAboutLiquid === 'function') {
        window.initAboutLiquid();
      }
    }

    if (typeof window.updateCartCount === 'function') {
      window.updateCartCount();
    }

    if (typeof window.observeFadeIn === 'function') {
      window.observeFadeIn();
    }

    const inlineScripts = container.querySelectorAll('script:not([src])');
    inlineScripts.forEach(script => {
      try {
        eval(script.textContent);
      } catch (e) {
        console.warn('Script reinitialization error:', e);
      }
    });

    console.log('✅ Page scripts reinitialized');
  }

  function initBarba() {
    if (typeof barba === 'undefined') {
      console.warn('⚠️ Barba.js not loaded');
      return;
    }

    barba.init({
      transitions: [{
        name: 'fade-slide',
        
        async leave(data) {
          showProgress(30);
          
          const current = data.current.container;
          current.classList.add('barba-leave-active', 'barba-leave-to');
          
          await new Promise(resolve => setTimeout(resolve, TRANSITION_DURATION));
          
          showProgress(60);
        },

        async enter(data) {
          showProgress(80);
          
          const next = data.next.container;
          next.classList.add('barba-enter-active', 'barba-enter');
          
          await new Promise(resolve => setTimeout(resolve, 50));
          
          next.classList.remove('barba-enter');
          next.classList.add('barba-enter-to');
          
          await new Promise(resolve => setTimeout(resolve, TRANSITION_DURATION));
          
          next.classList.remove('barba-enter-active', 'barba-enter-to');
          
          showProgress(100);
          hideProgress();
        },

        async after(data) {
          window.scrollTo(0, 0);
          reinitializeScripts(data.next.container);
        }
      }],

      prevent: ({ el }) => {
        if (el.classList && el.classList.contains('no-barba')) return true;
        if (el.href && el.href.includes('#')) return true;
        if (el.target === '_blank') return true;
        if (el.href && (el.href.includes('mailto:') || el.href.includes('tel:'))) return true;
        return false;
      }
    });

    console.log('✅ Barba.js page transitions initialized');
  }

  function init() {
    createProgressBar();
    
    if (typeof barba !== 'undefined') {
      initBarba();
    } else {
      const checkBarba = setInterval(() => {
        if (typeof barba !== 'undefined') {
          clearInterval(checkBarba);
          initBarba();
        }
      }, 100);
      
      setTimeout(() => clearInterval(checkBarba), 5000);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
