/**
 * Global Header Component - Single Source of Truth
 * This file contains the exact header from index.html
 * All pages must use this component for consistency
 */

(function() {
  'use strict';

  // Prevent duplicate initialization
  if (window.globalHeaderInitialized) return;
  window.globalHeaderInitialized = true;

  function initGlobalHeader() {
    // Check if we're on index.html - it has its own header
    const currentPath = window.location.pathname;
    const isIndexPage = currentPath === '/' || currentPath === '/index.html' || currentPath.endsWith('/');
    
    if (isIndexPage) {
      console.log('ℹ️ Index page detected, using built-in header');
      initHeaderFunctionality();
      return;
    }

    // Inject CSS first
    injectHeaderCSS();
    
    // Inject HTML
    injectHeaderHTML();
    
    // Initialize functionality
    initHeaderFunctionality();
    
    console.log('✅ Global Header initialized');
  }

  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGlobalHeader);
  } else {
    initGlobalHeader();
  }

  function injectHeaderCSS() {
    const css = `
    /* ===== GLOBAL HEADER CSS - SINGLE SOURCE OF TRUTH ===== */
    /* Uses !important to override any page-specific styles */
    
    :root {
      --gh-bg-primary: #000000;
      --gh-text-primary: #ffffff;
      --gh-text-secondary: #888888;
      --gh-accent: #ffffff;
      --gh-border: #222222;
    }

    /* Body padding for fixed header */
    body {
      padding-top: 70px !important;
    }

    .nav {
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      right: 0 !important;
      z-index: 1000 !important;
      padding: 1rem 2rem !important;
      display: flex !important;
      justify-content: space-between !important;
      align-items: center !important;
      background: rgba(0, 0, 0, 0.9) !important;
      backdrop-filter: blur(20px) !important;
      -webkit-backdrop-filter: blur(20px) !important;
      border-bottom: 1px solid var(--gh-border) !important;
      box-sizing: border-box !important;
    }

    .nav .nav-logo {
      display: flex !important;
      align-items: center !important;
      gap: 0.75rem !important;
      text-decoration: none !important;
    }

    .nav .nav-logo img {
      height: 40px !important;
    }

    .nav .nav-links {
      display: flex !important;
      gap: 2.5rem !important;
      list-style: none !important;
      margin: 0 !important;
      padding: 0 !important;
    }

    .nav .nav-links a {
      font-family: 'Inter', sans-serif !important;
      font-size: 0.85rem !important;
      font-weight: 500 !important;
      text-transform: uppercase !important;
      letter-spacing: 1px !important;
      color: var(--gh-text-secondary) !important;
      transition: color 0.3s ease !important;
      position: relative !important;
      text-decoration: none !important;
    }

    .nav .nav-links a::after {
      content: '' !important;
      position: absolute !important;
      bottom: -4px !important;
      left: 0 !important;
      width: 0 !important;
      height: 1px !important;
      background: var(--gh-accent) !important;
      transition: width 0.3s ease !important;
    }

    .nav .nav-links a:hover {
      color: var(--gh-text-primary) !important;
    }

    .nav .nav-links a:hover::after {
      width: 100% !important;
    }

    .nav .nav-links a.active {
      color: var(--gh-text-primary) !important;
    }

    .nav .nav-actions {
      display: flex !important;
      align-items: center !important;
      gap: 1.5rem !important;
    }

    .nav .nav-login {
      font-size: 1.2rem !important;
      color: var(--gh-text-secondary) !important;
      transition: all 0.3s ease !important;
      text-decoration: none !important;
    }

    .nav .nav-login:hover {
      color: var(--gh-text-primary) !important;
      transform: scale(1.1) !important;
    }

    .nav .nav-cart {
      position: relative !important;
      font-size: 1.2rem !important;
      cursor: pointer !important;
      transition: transform 0.3s ease !important;
      color: var(--gh-text-primary) !important;
    }

    .nav .nav-cart:hover {
      transform: scale(1.1) !important;
    }

    .nav .cart-count {
      position: absolute !important;
      top: -8px !important;
      right: -8px !important;
      background: var(--gh-accent) !important;
      color: var(--gh-bg-primary) !important;
      font-size: 0.7rem !important;
      font-weight: 700 !important;
      width: 18px !important;
      height: 18px !important;
      border-radius: 50% !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
    }

    .nav .menu-toggle {
      display: none !important;
      flex-direction: column !important;
      gap: 5px !important;
      cursor: pointer !important;
      padding: 0.5rem !important;
      background: none !important;
      border: none !important;
    }

    .nav .menu-toggle span {
      width: 24px !important;
      height: 2px !important;
      background: var(--gh-text-primary) !important;
      transition: all 0.3s ease !important;
    }

    /* Mobile Menu */
    .mobile-menu {
      position: fixed !important;
      top: 0 !important;
      right: -100% !important;
      width: 280px !important;
      height: 100vh !important;
      background: rgba(0, 0, 0, 0.98) !important;
      backdrop-filter: blur(20px) !important;
      -webkit-backdrop-filter: blur(20px) !important;
      z-index: 1001 !important;
      transition: right 0.3s ease !important;
      padding: 80px 2rem 2rem !important;
      overflow-y: auto !important;
    }

    .mobile-menu.active {
      right: 0 !important;
    }

    .mobile-menu ul {
      list-style: none !important;
      padding: 0 !important;
      margin: 0 !important;
    }

    .mobile-menu li {
      margin-bottom: 0.5rem !important;
    }

    .mobile-menu a {
      display: block !important;
      color: var(--gh-text-secondary) !important;
      text-decoration: none !important;
      font-weight: 500 !important;
      font-size: 1.1rem !important;
      text-transform: uppercase !important;
      letter-spacing: 0.5px !important;
      padding: 1rem !important;
      border-radius: 8px !important;
      transition: all 0.3s ease !important;
    }

    .mobile-menu a:hover,
    .mobile-menu a.active {
      color: var(--gh-text-primary) !important;
      background: rgba(255, 255, 255, 0.1) !important;
    }

    .mobile-menu .mobile-close {
      position: absolute !important;
      top: 1rem !important;
      right: 1rem !important;
      font-size: 1.5rem !important;
      cursor: pointer !important;
      color: var(--gh-text-primary) !important;
      padding: 0.5rem !important;
      transition: transform 0.3s ease !important;
    }

    .mobile-menu .mobile-close:hover {
      transform: scale(1.2) !important;
    }

    /* Mobile Overlay */
    .mobile-overlay {
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      right: 0 !important;
      bottom: 0 !important;
      background: rgba(0, 0, 0, 0.8) !important;
      z-index: 1000 !important;
      opacity: 0 !important;
      visibility: hidden !important;
      transition: all 0.3s ease !important;
    }

    .mobile-overlay.active {
      opacity: 1 !important;
      visibility: visible !important;
    }

    /* Responsive */
    @media (max-width: 992px) {
      body {
        padding-top: 65px !important;
      }
      
      .nav {
        padding: 1rem 1.5rem !important;
      }

      .nav .nav-logo img {
        height: 35px !important;
      }

      .nav .nav-links {
        display: none !important;
      }

      .nav .menu-toggle {
        display: flex !important;
      }
    }

    @media (max-width: 768px) {
      body {
        padding-top: 60px !important;
      }
      
      .nav {
        padding: 0.75rem 1rem !important;
      }

      .nav .nav-logo img {
        height: 32px !important;
      }

      .nav .nav-actions {
        gap: 1rem !important;
      }
    }

    @media (max-width: 480px) {
      body {
        padding-top: 55px !important;
      }
      
      .nav {
        padding: 0.5rem 0.75rem !important;
      }

      .nav .nav-logo img {
        height: 28px !important;
      }

      .mobile-menu {
        width: 100% !important;
      }
    }
    `;

    const style = document.createElement('style');
    style.id = 'global-header-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function injectHeaderHTML() {
    // Remove any existing headers
    const existingHeaders = document.querySelectorAll('.nav, .black-room-header, header, nav');
    existingHeaders.forEach(el => {
      if (!el.classList.contains('global-nav')) {
        el.remove();
      }
    });

    const headerHTML = `
    <!-- Navigation -->
    <nav class="nav">
      <a href="/" class="nav-logo">
        <img src="/images/logo.png" alt="Black Room">
      </a>
      
      <ul class="nav-links">
        <li><a href="/events.html">Tickets</a></li>
        <li><a href="/videos.html">Videos</a></li>
        <li><a href="/shop.html">Shop</a></li>
        <li><a href="/calendar.html">Calendar</a></li>
        <li><a href="/residents.html">Residents</a></li>
        <li><a href="/academy.html">Academy</a></li>
      </ul>

      <div class="nav-actions">
        <a href="/login.html" class="nav-login" title="Login">
          <i class="fas fa-user"></i>
        </a>
        <div class="nav-cart" id="nav-cart-btn">
          <i class="fas fa-shopping-bag"></i>
          <span class="cart-count" id="cart-count">0</span>
        </div>
        <div class="menu-toggle" id="menu-toggle">
          <span></span>
          <span></span>
          <span></span>
        </div>
      </div>
    </nav>

    <!-- Mobile Overlay -->
    <div class="mobile-overlay" id="mobile-overlay"></div>

    <!-- Mobile Menu -->
    <div class="mobile-menu" id="mobile-menu">
      <div class="mobile-close" id="mobile-close-btn">
        <i class="fas fa-times"></i>
      </div>
      <ul>
        <li><a href="/events.html">Tickets</a></li>
        <li><a href="/videos.html">Videos</a></li>
        <li><a href="/shop.html">Shop</a></li>
        <li><a href="/calendar.html">Calendar</a></li>
        <li><a href="/residents.html">Residents</a></li>
        <li><a href="/academy.html">Academy</a></li>
      </ul>
    </div>
    `;

    document.body.insertAdjacentHTML('afterbegin', headerHTML);
  }

  async function initHeaderFunctionality() {
    // Set active nav item
    const currentPage = window.location.pathname.split('/').pop() || 'index.html';
    const navLinks = document.querySelectorAll('.nav .nav-links a, .mobile-menu a, .nav-links a');
    
    navLinks.forEach(link => {
      const href = link.getAttribute('href');
      if (href && href.includes(currentPage)) {
        link.classList.add('active');
      }
    });
    
    // Sync session and update login/profile link
    await syncSessionAndUpdateUI();

    // Mobile menu toggle
    const menuToggle = document.getElementById('menu-toggle');
    const mobileMenu = document.getElementById('mobile-menu');
    const mobileOverlay = document.getElementById('mobile-overlay');
    const mobileClose = document.getElementById('mobile-close-btn');

    function openMobileMenu() {
      if (mobileMenu) mobileMenu.classList.add('active');
      if (mobileOverlay) mobileOverlay.classList.add('active');
      document.body.style.overflow = 'hidden';
    }

    function closeMobileMenu() {
      if (mobileMenu) mobileMenu.classList.remove('active');
      if (mobileOverlay) mobileOverlay.classList.remove('active');
      document.body.style.overflow = '';
    }

    if (menuToggle) {
      menuToggle.addEventListener('click', openMobileMenu);
    }

    if (mobileClose) {
      mobileClose.addEventListener('click', closeMobileMenu);
    }

    if (mobileOverlay) {
      mobileOverlay.addEventListener('click', closeMobileMenu);
    }

    // Close on escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeMobileMenu();
    });

    // Close when clicking mobile nav links
    const mobileLinks = document.querySelectorAll('.mobile-menu a');
    mobileLinks.forEach(link => {
      link.addEventListener('click', closeMobileMenu);
    });

    // Cart button
    const cartBtn = document.getElementById('nav-cart-btn');
    if (cartBtn) {
      cartBtn.addEventListener('click', () => {
        window.location.href = '/cart.html';
      });
    }

    // Update cart count
    updateCartCount();

    // Also expose global functions for index.html compatibility
    window.toggleMenu = function() {
      const menu = document.getElementById('mobile-menu') || document.getElementById('mobile-menu');
      if (menu) {
        menu.classList.toggle('active');
        const overlay = document.getElementById('mobile-overlay');
        if (overlay) overlay.classList.toggle('active');
      }
    };
  }

  function updateCartCount() {
    try {
      const cart = JSON.parse(localStorage.getItem('blackRoomCart') || '[]');
      const count = cart.reduce((sum, item) => sum + (item.quantity || 1), 0);
      const cartCountEl = document.getElementById('cart-count');
      if (cartCountEl) {
        cartCountEl.textContent = count;
      }
    } catch (e) {
      // Ignore cart errors
    }
  }

  // Expose updateCartCount globally
  window.updateGlobalCartCount = updateCartCount;

  // Sync session using JWT token and update UI
  async function syncSessionAndUpdateUI() {
    try {
      const token = localStorage.getItem('authToken');
      console.log('🔍 Global Header - Token exists:', token ? 'YES' : 'NO');
      
      const headers = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
        console.log('📤 Global Header - Sending Authorization header');
      }
      
      const response = await fetch('/api/profile', {
        method: 'GET',
        credentials: 'include',
        headers: headers
      });
      
      console.log('📥 Global Header - Response status:', response.status);
      
      if (response.ok) {
        const profile = await response.json();
        console.log('✅ Global Header - User authenticated:', profile.email);
        
        // Store user info
        localStorage.setItem('userName', profile.email);
        localStorage.setItem('fullName', profile.fullName || profile.name || profile.email);
        
        // Update login link to profile
        updateLoginToProfile(profile);
      } else {
        console.log('⚠️ Global Header - Not authenticated, showing login');
        localStorage.removeItem('userName');
        localStorage.removeItem('fullName');
      }
    } catch (error) {
      console.log('❌ Global Header - Session sync error:', error.message);
    }
  }
  
  // Update the login button/link to show profile
  function updateLoginToProfile(profile) {
    // Find login links and update them
    const loginLinks = document.querySelectorAll('a[href="/login.html"], a[href="login.html"]');
    loginLinks.forEach(link => {
      link.href = '/profile.html';
      link.title = 'Profile';
      console.log('🔄 Updated login link to profile');
    });
    
    // Update nav-login class elements
    const navLogin = document.querySelector('.nav-login');
    if (navLogin) {
      navLogin.href = '/profile.html';
      navLogin.title = 'Profile';
    }
    
    // Update mobile menu login link
    const mobileLoginLink = document.querySelector('.mobile-menu a[href="/login.html"]');
    if (mobileLoginLink) {
      mobileLoginLink.href = '/profile.html';
      mobileLoginLink.textContent = 'Profile';
    }
  }
  
  // Expose syncSession globally
  window.syncSession = syncSessionAndUpdateUI;

})();
