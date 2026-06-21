// Responsive Header Component for Black Room

class BlackRoomHeader {
    constructor() {
        this.isInitialized = false;
        this.currentUser = null;
        this.init();
    }

    async init() {
        if (this.isInitialized) return;

        // Check if we're on index.html - it has its own header
        const currentPage = window.location.pathname.split('/').pop() || 'index.html';
        const isIndexPage = currentPage === 'index.html' || window.location.pathname === '/';

        if (!isIndexPage) {
            // Inject header HTML and CSS for other pages
            this.injectHeaderHTML();
            this.injectHeaderCSS();

            // Wait for DOM to be ready
            await this.waitForDOM();
        } else {
            // For index.html, just wait for existing header
            await this.waitForExistingHeader();
        }

        // Setup header functionality
        this.setupElements();
        this.setupEventListeners();
        this.setActiveNavItem();
        await this.syncSession();
        this.loadUserActions();

        this.isInitialized = true;
        
        // Store global reference for reinitialization
        window.blackRoomHeaderInstance = this;
        
        console.log('✅ Black Room Header initialized');
    }

    injectHeaderCSS() {
        const css = `
        /* Header Variables */
        :root {
            --bg-primary: #000000;
            --bg-secondary: #0a0a0a;
            --bg-card: #111111;
            --text-primary: #ffffff;
            --text-secondary: #888888;
            --accent: #ffffff;
            --border: #222222;
            --header-bg: rgba(0, 0, 0, 0.9);
            --hover-bg: rgba(255, 255, 255, 0.1);
            --mobile-menu-bg: rgba(0, 0, 0, 0.98);
        }

        /* Navigation - Match Homepage Exactly */
        .nav.black-room-header {
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
            border-bottom: 1px solid #222222 !important;
            box-sizing: border-box !important;
        }

        /* Override any page-specific header styles */
        body.has-black-room-header {
            padding-top: 70px !important;
        }

        .nav-logo {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            text-decoration: none;
        }

        .nav-logo img {
            height: 40px;
        }

        .nav-links {
            display: flex;
            gap: 2.5rem;
            list-style: none;
            margin: 0;
            padding: 0;
        }

        .nav-links a {
            font-size: 0.85rem;
            font-weight: 500;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: var(--text-secondary);
            transition: color 0.3s ease;
            position: relative;
            text-decoration: none;
        }

        .nav-links a::after {
            content: '';
            position: absolute;
            bottom: -4px;
            left: 0;
            width: 0;
            height: 1px;
            background: var(--accent);
            transition: width 0.3s ease;
        }

        .nav-links a:hover {
            color: var(--text-primary);
        }

        .nav-links a:hover::after {
            width: 100%;
        }

        .nav-actions {
            display: flex;
            align-items: center;
            gap: 1.5rem;
        }

        .nav-login {
            font-size: 1.2rem;
            color: var(--text-secondary);
            transition: all 0.3s ease;
            text-decoration: none;
        }

        .nav-login:hover {
            color: var(--text-primary);
            transform: scale(1.1);
        }

        .nav-cart {
            position: relative;
            font-size: 1.2rem;
            cursor: pointer;
            transition: transform 0.3s ease;
            color: var(--text-primary);
        }

        .nav-cart:hover {
            transform: scale(1.1);
        }

        .cart-count {
            position: absolute;
            top: -8px;
            right: -8px;
            background: var(--accent);
            color: var(--bg-primary);
            font-size: 0.7rem;
            font-weight: 700;
            width: 18px;
            height: 18px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .menu-toggle {
            display: none;
            flex-direction: column;
            gap: 5px;
            cursor: pointer;
            padding: 0.5rem;
            background: none;
            border: none;
        }

        .menu-toggle span {
            width: 24px;
            height: 2px;
            background: var(--text-primary);
            transition: all 0.3s ease;
        }

        .header-nav a {
            color: var(--text-secondary);
            text-decoration: none;
            font-weight: 500;
            font-size: 0.95rem;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            padding: 0.75rem 1rem;
            border-radius: 6px;
            transition: all 0.3s ease;
            position: relative;
        }

        .header-nav a::before {
            content: '';
            position: absolute;
            bottom: 0;
            left: 50%;
            width: 0;
            height: 2px;
            background: var(--accent-primary);
            transition: all 0.3s ease;
            transform: translateX(-50%);
        }

        .header-nav a:hover,
        .header-nav a.active {
            color: var(--text-primary);
            background: var(--hover-bg);
        }

        .header-nav a:hover::before {
            width: 80%;
        }

        .header-actions {
            display: flex;
            align-items: center;
            gap: 1rem;
            min-width: 350px;
            justify-content: flex-end;
        }

        .header-actions button,
        .header-actions a {
            background: none;
            border: none;
            color: var(--text-secondary);
            font-size: 1.1rem;
            padding: 0.5rem;
            border-radius: 50%;
            transition: all 0.3s ease;
            cursor: pointer;
            text-decoration: none;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 40px;
            height: 40px;
        }

        .header-actions button:hover,
        .header-actions a:hover {
            color: var(--text-primary);
            background: var(--hover-bg);
            transform: translateY(-2px);
        }

        .header-actions a {
            width: auto;
            height: auto;
            padding: 0.75rem 1rem;
            border-radius: 6px;
            font-size: 0.9rem;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            white-space: nowrap;
        }

        .header-user-info {
            color: var(--text-primary);
            font-size: 0.9rem;
            font-weight: 500;
            white-space: nowrap;
            max-width: 120px;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .mobile-menu-btn {
            display: none;
            background: none;
            border: none;
            color: var(--text-primary);
            font-size: 1.5rem;
            cursor: pointer;
            padding: 0.5rem;
            border-radius: 6px;
            transition: all 0.3s ease;
            z-index: 1001;
        }

        .mobile-menu-btn:hover {
            background: var(--hover-bg);
        }

        .mobile-menu-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.8);
            z-index: 999;
            opacity: 0;
            visibility: hidden;
            transition: all 0.3s ease;
        }

        .mobile-menu-overlay.active {
            opacity: 1;
            visibility: visible;
        }

        .mobile-menu {
            position: fixed;
            top: 0;
            right: -100%;
            width: 280px;
            height: 100vh;
            background: var(--mobile-menu-bg);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            z-index: 1000;
            transition: right 0.3s ease;
            padding: 80px 2rem 2rem;
            overflow-y: auto;
        }

        .mobile-menu.active {
            right: 0;
        }

        .mobile-nav {
            list-style: none;
            margin: 0 0 2rem 0;
            padding: 0;
        }

        .mobile-nav li {
            margin-bottom: 0.5rem;
        }

        .mobile-nav a {
            display: block;
            color: var(--text-secondary);
            text-decoration: none;
            font-weight: 500;
            font-size: 1.1rem;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            padding: 1rem;
            border-radius: 8px;
            transition: all 0.3s ease;
        }

        .mobile-nav a:hover,
        .mobile-nav a.active {
            color: var(--text-primary);
            background: var(--hover-bg);
        }

        .mobile-actions {
            border-top: 1px solid var(--header-border);
            padding-top: 2rem;
        }

        .mobile-actions .header-user-info {
            margin-bottom: 1rem;
            padding: 1rem;
            background: var(--hover-bg);
            border-radius: 8px;
            text-align: center;
        }

        .mobile-action-buttons {
            display: flex;
            flex-wrap: wrap;
            gap: 1rem;
            justify-content: center;
        }

        .mobile-action-buttons button,
        .mobile-action-buttons a {
            background: var(--hover-bg);
            border: none;
            color: var(--text-primary);
            padding: 0.75rem 1rem;
            border-radius: 8px;
            text-decoration: none;
            font-size: 0.9rem;
            font-weight: 500;
            transition: all 0.3s ease;
            cursor: pointer;
            text-transform: uppercase;
            letter-spacing: 0.3px;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }

        .mobile-action-buttons button:hover,
        .mobile-action-buttons a:hover {
            background: var(--accent-primary);
            color: #000;
        }

        /* Mobile Close Button */
        .mobile-close {
            position: absolute;
            top: 1rem;
            right: 1rem;
            font-size: 1.5rem;
            cursor: pointer;
            color: var(--text-primary);
            padding: 0.5rem;
            transition: transform 0.3s ease;
        }

        .mobile-close:hover {
            transform: scale(1.2);
        }

        /* Responsive Design */
        @media (max-width: 992px) {
            .nav.black-room-header {
                padding: 1rem 1.5rem;
            }

            .nav-logo img {
                height: 35px;
            }

            .nav-links {
                display: none;
            }

            .nav-actions .nav-login,
            .nav-actions .nav-cart {
                display: flex;
            }

            .menu-toggle {
                display: flex;
            }
        }

        @media (max-width: 768px) {
            .nav.black-room-header {
                padding: 0.75rem 1rem;
            }

            .nav-logo img {
                height: 32px;
            }

            .nav-actions {
                gap: 1rem;
            }
        }

        @media (max-width: 480px) {
            .nav.black-room-header {
                padding: 0.5rem 0.75rem;
            }

            .nav-logo img {
                height: 28px;
            }

            .mobile-menu {
                width: 100%;
            }
        }

        /* Body padding to account for fixed header */
        body.has-black-room-header {
            padding-top: 70px !important;
        }

        @media (max-width: 992px) {
            body.has-black-room-header {
                padding-top: 65px !important;
            }
        }

        @media (max-width: 768px) {
            body.has-black-room-header {
                padding-top: 60px !important;
            }
        }

        @media (max-width: 480px) {
            body.has-black-room-header {
                padding-top: 55px !important;
            }
        }

        @media (max-width: 360px) {
            body.has-black-room-header {
                padding-top: 50px !important;
            }
        }
        `;

        const style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);
    }

    injectHeaderHTML() {
        // Prevent duplicate header injection
        if (document.querySelector('.black-room-header')) {
            console.log('ℹ️ Header already exists, skipping injection');
            return;
        }

        const headerHTML = `
        <nav class="nav black-room-header">
            <a href="/" class="nav-logo header-logo">
                <img src="/images/logo.png" alt="Black Room">
            </a>
            
            <ul class="nav-links header-nav" id="desktop-nav">
                <li><a href="/events.html">Tickets</a></li>
                <li><a href="/videos.html">Videos</a></li>
                <li><a href="/shop.html">Shop</a></li>
                <li><a href="/calendar.html">Calendar</a></li>
            </ul>

            <div class="nav-actions header-actions" id="desktop-actions">
                <a href="/login.html" class="nav-login" title="Login">
                    <i class="fas fa-user"></i>
                </a>
                <div class="nav-cart" id="nav-cart-btn">
                    <i class="fas fa-shopping-bag"></i>
                    <span class="cart-count" id="cart-count">0</span>
                </div>
                <div class="menu-toggle mobile-menu-btn" id="mobile-menu-btn">
                    <span></span>
                    <span></span>
                    <span></span>
                </div>
            </div>
        </nav>

        <div class="mobile-menu-overlay" id="mobile-menu-overlay"></div>

        <div class="mobile-menu" id="mobile-menu">
            <div class="mobile-close" id="mobile-close-btn">
                <i class="fas fa-times"></i>
            </div>
            <ul class="mobile-nav">
                <li><a href="/events.html">Tickets</a></li>
                <li><a href="/videos.html">Videos</a></li>
                <li><a href="/shop.html">Shop</a></li>
                <li><a href="/calendar.html">Calendar</a></li>
            </ul>

            <div class="mobile-actions" id="mobile-actions">
                <!-- Will be populated by JavaScript -->
            </div>
        </div>
        `;

        document.body.insertAdjacentHTML('afterbegin', headerHTML);
        document.body.classList.add('has-black-room-header');
    }

    async waitForDOM() {
        return new Promise(resolve => {
            if (document.querySelector('.black-room-header')) {
                resolve();
            } else {
                setTimeout(() => this.waitForDOM().then(resolve), 10);
            }
        });
    }

    async waitForExistingHeader() {
        return new Promise(resolve => {
            if (document.querySelector('header') || document.querySelector('.black-room-header')) {
                resolve();
            } else {
                setTimeout(() => this.waitForExistingHeader().then(resolve), 10);
            }
        });
    }

    setupElements() {
        // Try to find elements by ID first (injected header)
        this.mobileMenuBtn = document.getElementById('mobile-menu-btn');
        this.mobileMenu = document.getElementById('mobile-menu');
        this.mobileMenuOverlay = document.getElementById('mobile-menu-overlay');
        this.desktopActions = document.getElementById('desktop-actions');
        this.mobileActions = document.getElementById('mobile-actions');

        // Fallback for index.html - create missing elements if needed
        if (!this.desktopActions) {
            const header = document.querySelector('header');
            if (header) {
                // Create desktop actions container if it doesn't exist
                const actionsContainer = document.createElement('div');
                actionsContainer.id = 'desktop-actions';
                actionsContainer.className = 'header-actions';
                header.appendChild(actionsContainer);
                this.desktopActions = actionsContainer;
            }
        }
    }

    setupEventListeners() {
        if (this.mobileMenuBtn) {
            this.mobileMenuBtn.addEventListener('click', () => {
                this.toggleMobileMenu();
            });
        }

        if (this.mobileMenuOverlay) {
            this.mobileMenuOverlay.addEventListener('click', () => {
                this.closeMobileMenu();
            });
        }

        // Mobile close button
        const mobileCloseBtn = document.getElementById('mobile-close-btn');
        if (mobileCloseBtn) {
            mobileCloseBtn.addEventListener('click', () => {
                this.closeMobileMenu();
            });
        }

        // Cart button
        const navCartBtn = document.getElementById('nav-cart-btn');
        if (navCartBtn) {
            navCartBtn.addEventListener('click', () => {
                if (typeof toggleCart === 'function') {
                    toggleCart();
                } else {
                    window.location.href = '/cart.html';
                }
            });
        }

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeMobileMenu();
            }
        });

        const mobileNavLinks = document.querySelectorAll('.mobile-nav a');
        mobileNavLinks.forEach(link => {
            link.addEventListener('click', () => {
                this.closeMobileMenu();
            });
        });

        // Update cart count
        this.updateCartCount();
    }

    updateCartCount() {
        try {
            const cart = JSON.parse(localStorage.getItem('blackRoomCart') || '[]');
            const count = cart.reduce((sum, item) => sum + (item.quantity || 1), 0);
            const cartCountEl = document.getElementById('cart-count');
            if (cartCountEl) {
                cartCountEl.textContent = count;
            }
        } catch (e) {
            console.log('Cart count update skipped');
        }
    }

    setActiveNavItem() {
        const currentPage = window.location.pathname.split('/').pop() || 'index.html';
        const navLinks = document.querySelectorAll('.header-nav a, .mobile-nav a');

        navLinks.forEach(link => {
            link.classList.remove('active');
            const href = link.getAttribute('href');
            if (href === currentPage || (currentPage === 'index.html' && href === 'index.html')) {
                link.classList.add('active');
            }
        });
    }

    // Helper to set logged in state
    setLoggedIn(profile) {
      // Handle both formats: { user: {...} } and { name, fullName, ... }
      const user = profile?.user || profile;
      
      if (user && (user.name || user.email)) {
        localStorage.setItem('userName', user.name || user.email);
        localStorage.setItem('fullName', user.fullName || user.name || user.email);
        this.currentUser = user;
      } else {
        // Fallback if profile is missing
        localStorage.removeItem('userName');
        localStorage.removeItem('fullName');
        this.currentUser = null;
      }
    }

    // Helper to set logged out state
    setLoggedOut() {
      localStorage.removeItem('userName');
      localStorage.removeItem('fullName');
      this.currentUser = null;
    }

    async syncSession() {
      try {
        // Build headers with token if available
        const headers = {};
        const token = localStorage.getItem('authToken');
        console.log('🔍 Header syncSession - Token exists:', token ? 'YES' : 'NO');
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
          console.log('📤 Header syncSession - Sending Authorization header');
        }
        
        const response = await fetch('/api/profile', {
          method: 'GET',
          credentials: 'include',
          headers: headers
        });
        console.log('📥 Header syncSession - Response status:', response.status);

        if (response.ok) {
          const profile = await response.json();
          this.setLoggedIn(profile);
        } else if (response.status === 401) {
          // User not logged in - but DON'T clear token here
          // Let the profile page handle token clearing after user action
          console.log('⚠️ Header syncSession: 401 - user not authenticated');
          this.setLoggedOut();
        } else {
          console.warn('Session sync failed:', response.status);
        }
      } catch (error) {
        console.error('❌ Session sync failed:', error.message);
        // Don't clear token on network errors
      }
    }

    loadUserActions() {
        // Keep the header simple - just update login link based on auth state
        const userName = localStorage.getItem('userName');
        const navLogin = document.querySelector('.nav-login');
        
        if (userName && navLogin) {
            // User is logged in - change icon to profile
            navLogin.href = '/profile.html';
            navLogin.title = 'Profile';
        }
        
        // Update cart count
        this.updateCartCount();
    }

    // Method to reinitialize header actions (useful for SPA-like pages)
    reinitializeActions() {
        this.syncSession().then(() => {
            this.loadUserActions();
        });
    }

    renderLoggedInActions(fullName) {
        // Simplified - no longer replaces header content
        if (this.mobileActions) {
            this.mobileActions.innerHTML = `
                <div class="header-user-info">Hello, ${fullName}</div>
                <div class="mobile-action-buttons">
                    <a href="/profile.html">
                        <i class="fas fa-user"></i> Profile
                    </a>
                    <button id="mobile-logout-btn">
                        <i class="fas fa-sign-out-alt"></i> Logout
                    </button>
                </div>
            `;
            
            // Mark as header-controlled to prevent overwrites
            this.mobileActions.dataset.headerControlled = 'true';
        }

        this.setupLogoutHandlers();
        this.setupActionHandlers();
    }

    renderLoggedOutActions() {
        // Simplified - no longer replaces header content
        if (this.mobileActions) {
            this.mobileActions.innerHTML = `
                <div class="mobile-action-buttons">
                    <a href="/login.html">
                        <i class="fas fa-sign-in-alt"></i> Login
                    </a>
                    <a href="/register.html">
                        <i class="fas fa-user-plus"></i> Register
                    </a>
                </div>
            `;
            
            // Mark as header-controlled to prevent overwrites
            this.mobileActions.dataset.headerControlled = 'true';
        }

        this.setupActionHandlers();
    }

    setupLogoutHandlers() {
        const logoutHandler = async () => {
            try {
                await fetch('/api/logout', { method: 'POST', credentials: 'include' });
            } catch (error) {
                console.error('Logout error:', error);
            } finally {
                localStorage.clear();
                window.location.reload();
            }
        };

        const logoutBtn = document.getElementById('logout-btn');
        const mobileLogoutBtn = document.getElementById('mobile-logout-btn');
        if (logoutBtn) logoutBtn.onclick = logoutHandler;
        if (mobileLogoutBtn) mobileLogoutBtn.onclick = logoutHandler;
    }

    setupActionHandlers() {
        // Wait a bit for global functions to be available
        setTimeout(() => {
            const searchBtns = document.querySelectorAll('#search-btn, #mobile-search-btn');
            searchBtns.forEach(btn => {
                if (btn) {
                    btn.onclick = () => {
                        if (window.location.pathname.includes('index.html') || window.location.pathname === '/') {
                            if (typeof toggleSearch === 'function') {
                                toggleSearch();
                            } else {
                                window.location.href = 'videos.html';
                            }
                        } else {
                            window.location.href = 'videos.html';
                        }
                    };
                }
            });

            const cartBtns = document.querySelectorAll('#cart-btn, #mobile-cart-btn');
            cartBtns.forEach(btn => {
                if (btn) {
                    btn.onclick = () => {
                        if (typeof toggleCart === 'function') {
                            toggleCart();
                        } else {
                            window.location.href = 'shop.html';
                        }
                    };
                }
            });
        }, 100);
    }

    toggleMobileMenu() {
        const isActive = this.mobileMenu.classList.contains('active');
        if (isActive) {
            this.closeMobileMenu();
        } else {
            this.openMobileMenu();
        }
    }

    openMobileMenu() {
        this.mobileMenu.classList.add('active');
        this.mobileMenuOverlay.classList.add('active');
        document.body.style.overflow = 'hidden';

        const icon = this.mobileMenuBtn.querySelector('i');
        if (icon) {
            icon.className = 'fas fa-times';
        }
    }

    closeMobileMenu() {
        this.mobileMenu.classList.remove('active');
        this.mobileMenuOverlay.classList.remove('active');
        document.body.style.overflow = '';

        const icon = this.mobileMenuBtn.querySelector('i');
        if (icon) {
            icon.className = 'fas fa-bars';
        }
    }
}

// Single initialization point - prevents duplicate headers
function initBlackRoomHeader() {
    if (window.BlackRoomHeaderInitialized) {
        console.log('ℹ️ Black Room Header already initialized');
        return;
    }
    
    console.log('🔧 Initializing Black Room Header...');
    new BlackRoomHeader();
    window.BlackRoomHeaderInitialized = true;
    console.log('✅ Black Room Header initialized successfully');
}

// Initialize based on document state
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initBlackRoomHeader, { once: true });
} else {
    initBlackRoomHeader();
}

// Make it globally available
window.BlackRoomHeader = BlackRoomHeader;

// Legacy responsive header system - disabled to prevent duplicates
function createResponsiveHeader() {
  // Skip if modern header already exists
  if (document.querySelector('.black-room-header') || document.querySelector('.nav.black-room-header')) {
    console.log('ℹ️ Modern header exists, skipping legacy header');
    return;
  }
  
  // Only create header if no header exists at all
  if (!document.querySelector('header')) {
    const header = document.createElement('header');
    header.innerHTML = `
      <div class="logo" onclick="location.href='index.html'">
        <img src="images/logo.png" alt="Black Room Logo" />
      </div>
      <nav>
        <ul class="nav-left">
          <li><a href="index.html">Home</a></li>
          <li><a href="events.html">Tickets</a></li>
          <li><a href="shop.html">Shop</a></li>
          <li><a href="videos.html">Videos</a></li>
        </ul>
        <ul class="nav-right" id="nav-right"></ul>
      </nav>
    `;

    // Insert header at the beginning of body
    document.body.insertBefore(header, document.body.firstChild);

    // Add header styles if they don't exist
    if (!document.querySelector('#header-styles')) {
      const style = document.createElement('style');
      style.id = 'header-styles';
      style.textContent = `
        :root {
          --bg-primary: #000000;
          --bg-secondary: #0d0d0d;
          --bg-tertiary: #1a1a1a;
          --header-bg: rgba(0, 0, 0, 0.98);
          --text-color: #e0e0e0;
          --text-accent: #a0a0a0;
          --accent-primary: #fff;
          --accent-secondary: #ccc;
          --border-color: #282828;
          --button-primary-bg: #fff;
          --button-primary-text: #000;
          --button-primary-hover: #eee;
          --button-secondary-bg: #333;
          --button-secondary-hover: #555;
          --error-color: #e63946;
          --shadow-dark: 0 4px 20px rgba(0, 0, 0, 0.6);
          --shadow-modal: 0 8px 40px rgba(0, 0, 0, 0.9);
        }

        header {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          background: var(--header-bg);
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 1rem 3rem;
          z-index: 1000;
          box-shadow: var(--shadow-dark);
        }

        .logo {
          display: flex;
          align-items: center;
          gap: 12px;
          cursor: pointer;
          transition: opacity 0.3s ease;
        }

        .logo:hover {
          opacity: 0.8;
        }

        .logo img {
          height: 60px;
        }

        nav {
          flex: 1;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .nav-left,
        .nav-right {
          display: flex;
          gap: 2rem;
          align-items: center;
          list-style: none;
        }

        nav a,
        nav button {
          font-weight: 600;
          text-transform: uppercase;
          font-size: 1rem;
          padding: 0.5rem 0;
          position: relative;
          background: none;
          border: none;
          color: var(--text-color);
          text-decoration: none;
          cursor: pointer;
          transition: color 0.3s ease, transform 0.2s ease;
        }

        nav a::after {
          content: "";
          position: absolute;
          width: 0;
          height: 2px;
          background: var(--accent-primary);
          bottom: 0;
          left: 0;
          transition: width 0.3s ease-in-out;
        }

        nav a:hover::after {
          width: 100%;
        }

        nav a:hover,
        nav button:hover {
          color: var(--accent-primary);
          transform: translateY(-3px);
        }

        #cart-btn-nav i,
        #search-btn-nav i,
        .calendar-nav-link i {
          font-size: 1.5rem;
          color: var(--accent-primary);
        }

        @media (max-width: 768px) {
          header {
            padding: 0.8rem 1.5rem;
          }
          .logo img {
            height: 50px;
          }
          .nav-left,
          .nav-right {
            gap: 1rem;
          }
          nav a,
          nav button {
            font-size: 0.85rem;
          }
        }

        @media (max-width: 480px) {
          header {
            padding: 0.6rem 1rem;
            flex-wrap: nowrap;
            min-height: 70px;
            height: auto;
          }
          .logo {
            flex-shrink: 0;
          }
          .logo img {
            height: 45px;
          }
          nav {
            flex: 1;
            justify-content: space-between;
          }
          .nav-left,
          .nav-right {
            gap: 0.8rem;
            flex-wrap: nowrap;
          }
          nav a,
          nav button {
            font-size: 0.75rem;
            padding: 0.3rem 0;
            white-space: nowrap;
          }
          #cart-btn-nav i,
          #search-btn-nav i,
          .calendar-nav-link i {
            font-size: 1.1rem;
          }
        }

        @media (max-width: 360px) {
          header {
            padding: 0.5rem 0.8rem;
          }
          .logo img {
            height: 40px;
          }
          nav a,
          nav button {
            font-size: 0.7rem;
          }
          .nav-left,
          .nav-right {
            gap: 0.6rem;
          }
        }
      `;
      document.head.appendChild(style);
    }
  }
}

async function syncSession() {
  try {
    // Build headers with token if available
    const headers = {};
    const token = localStorage.getItem('authToken');
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    
    const response = await fetch(`${window.location.origin}/api/profile`, {
      credentials: 'include',
      headers: headers
    });
    if (!response.ok) {
      throw new Error('No session');
    }
    const profile = await response.json();
    // Handle both formats: { user: {...} } and { name, fullName, ... }
    const user = profile?.user || profile;
    if (user && (user.name || user.email)) {
      localStorage.setItem('userName', user.name || user.email);
      localStorage.setItem('fullName', user.fullName || user.name || user.email);
    }
  } catch (error) {
    // Don't clear token on errors - let user retry
    console.log('⚠️ Global syncSession error:', error.message);
  }
}

function renderNavigation() {
  const navRight = document.getElementById('nav-right');
  if (!navRight) return;

  const userName = localStorage.getItem('userName');
  const fullName = localStorage.getItem('fullName') || userName;

  let navHtml = `
    <li><button id="search-btn-nav"><i class="fas fa-search"></i></button></li>
    <li><button id="cart-btn-nav"><i class="fas fa-shopping-cart"></i></button></li>
    <li><a href="calendar.html" class="calendar-nav-link" title="Event Calendar"><i class="fas fa-calendar"></i></a></li>
  `;

  if (userName) {
    navHtml += `
      <li><span style="color: var(--accent-primary); font-weight: 600;">Hello, ${fullName}</span></li>
      <li><button id="profile-btn" style="color: var(--accent-primary);">Profile</button></li>
      <li><button id="logout-btn" style="color: var(--accent-primary);">Logout</button></li>
    `;
  } else {
    navHtml += `
      <li><a href="login.html" style="color: var(--accent-primary);">Login</a></li>
      <li><a href="register.html" style="color: var(--accent-primary);">Register</a></li>
    `;
  }

  navRight.innerHTML = navHtml;
}

function setupEventListeners() {
  // Cart functionality
  const cartBtn = document.getElementById('cart-btn-nav');
  if (cartBtn) {
    cartBtn.onclick = function() {
      if (typeof toggleCart === 'function') {
        toggleCart();
      } else {
        window.location.href = 'shop.html';
      }
    };
  }

  // Search functionality  
  const searchBtn = document.getElementById('search-btn-nav');
  if (searchBtn) {
    searchBtn.onclick = function() {
      // If page has search functionality, use it
      if (typeof toggleSearch === 'function') {
        toggleSearch();
      } else {
        // Basic search redirect
        const query = prompt('¿Qué estás buscando?');
        if (query) {
          location.href = `videos.html?search=${encodeURIComponent(query)}`;
        }
      }
    };
  }

  // Profile and logout
  const profileBtn = document.getElementById('profile-btn');
  const logoutBtn = document.getElementById('logout-btn');

  if (profileBtn) {
    profileBtn.onclick = () => location.href = 'profile.html';
  }

  if (logoutBtn) {
    logoutBtn.onclick = async () => {
      try {
        await fetch(`${window.location.origin}/api/logout`, {
          method: 'POST',
          credentials: 'include',
        });
      } finally {
        localStorage.clear();
        location.reload();
      }
    };
  }
}

// Export functions for pages that need them
window.syncSession = syncSession;
window.renderNavigation = renderNavigation;// Cache buster: 1769129616
