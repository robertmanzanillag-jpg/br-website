// Community App - Miami New Times Style
class CommunityApp {
  constructor() {
    console.log('🏗️ Creating CommunityApp instance...');
    this.currentUser = null;
    this.posts = [];
    this.categories = [];
    this.currentFilter = {
      category: 'all',
      status: 'all'
    };
    this.pagination = {
      offset: 0,
      limit: 12,
      hasMore: true
    };
    this.mediaFilter = 'all';
    this.mediaItems = [];
    // Initialize immediately
    this.init().catch(error => {
      console.error('❌ Community App initialization failed:', error);
    });
  }

  async init() {
    console.log('🔧 Community App initializing...');

    try {
      // Set current date
      this.setCurrentDate();
      console.log('✅ Current date set');

      // Check authentication
      await this.checkAuth();
      console.log('✅ Authentication checked');

      // Load initial data
      await this.loadCategories();
      console.log('✅ Categories loaded');
      await this.loadPosts();
      console.log('✅ Posts loaded');
      await this.loadTrendingPosts();
      console.log('✅ Trending posts loaded');
      await this.loadMediaGallery();
      console.log('✅ Media gallery loaded');


      // Setup event listeners
      this.setupEventListeners();
      console.log('✅ Event listeners set up');

      console.log('✅ Community App fully initialized');
    } catch (error) {
      console.error('❌ Error during Community App initialization:', error);
      this.showError('Failed to initialize the app. Please try refreshing the page.');
    }
  }

  setCurrentDate() {
    const dateElement = document.querySelector('.current-date');
    if (dateElement) {
      const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
      const today = new Date().toLocaleDateString('en-US', options).toUpperCase();
      dateElement.textContent = today;
    }
  }

  // ========== AUTHENTICATION ==========

  async checkAuth() {
    try {
      const response = await fetch('/api/profile', { credentials: 'include' });
      const data = await response.json();

      if (data.authenticated) {
        this.currentUser = data.user;
        this.updateUserUI(true);
      } else {
        this.updateUserUI(false);
      }
    } catch (error) {
      console.error('❌ Error checking auth:', error);
      this.updateUserUI(false);
    }
  }

  updateUserUI(isAuthenticated) {
    // Don't interfere with the global header system
    // Just store user state for community features
    console.log('✅ User authentication state updated:', isAuthenticated ? 'logged in' : 'logged out');
  }

  async logout() {
    // Let the global header handle logout
    if (window.blackRoomHeaderInstance && window.blackRoomHeaderInstance.logout) {
      window.blackRoomHeaderInstance.logout();
    } else {
      // Fallback
      try {
        await fetch('/api/logout', { method: 'POST' });
        window.location.reload();
      } catch (error) {
        console.error('❌ Error logging out:', error);
        this.showError('Error logging out. Please try again.');
      }
    }
  }

  showLogin() {
    // Redirect to login page or show login modal
    window.location.href = '/login.html?redirect=/community.html';
  }

  // ========== DATA LOADING ==========

  async loadCategories() {
    try {
      const response = await fetch('/api/community/categories');
      const data = await response.json();

      if (data.success) {
        this.categories = data.categories;
        this.renderCategoryTabs();
        this.renderCategoryOptions();
        console.log('✅ Categories loaded:', this.categories.length);
      } else {
        console.error('❌ API error loading categories:', data.error);
        this.showError('Failed to load categories.');
      }
    } catch (error) {
      console.error('❌ Error loading categories:', error);
      this.showError('Error loading categories.');
    }
  }

  async loadPosts(reset = false) {
    if (this.loading) {
      console.log('⏳ Posts already loading, skipping...');
      return;
    }

    console.log('📋 Loading posts...', { reset, category: this.currentFilter.category, filter: this.currentFilter.status, offset: this.pagination.offset });
    this.loading = true;

    if (reset) {
      this.pagination.offset = 0;
      this.pagination.hasMore = true;
      this.posts = []; // Clear posts array completely when resetting
    }

    try {
      const params = new URLSearchParams({
        status: this.currentFilter.status,
        limit: this.pagination.limit,
        offset: this.pagination.offset
      });

      if (this.currentFilter.category !== 'all') {
        params.append('category_id', this.currentFilter.category);
      }

      console.log('📡 Fetching posts with params:', params.toString());
      const response = await fetch(`/api/community/posts?${params}`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      console.log('📊 Posts response:', data);

      if (data.success) {
        if (reset) {
          this.posts = data.posts;
          console.log('🔄 Posts reset and reloaded:', data.posts.length);
        } else {
          this.posts = [...this.posts, ...data.posts];
        }

        console.log('📝 Posts array after update:', this.posts.length);

        this.pagination.offset += data.posts.length;
        this.pagination.hasMore = data.has_more;

        this.renderPosts(reset);
        this.renderHeroSection();

        console.log(`✅ Posts loaded: ${data.posts.length} new, ${this.posts.length} total`);
      } else {
        console.error('❌ API returned error:', data.error);
        this.showError(data.error || 'Error loading posts');
      }
    } catch (error) {
      console.error('❌ Error loading posts:', error);
      this.showError('Error loading posts: ' + error.message);
    } finally {
      this.loading = false;
    }
  }

  async loadTrendingPosts() {
    try {
      const response = await fetch('/api/community/posts?limit=5&sort=views');
      const data = await response.json();

      if (data.success) {
        this.renderTrendingPosts(data.posts);
      } else {
        console.error('❌ API error loading trending posts:', data.error);
      }
    } catch (error) {
      console.error('❌ Error loading trending posts:', error);
    }
  }

  async loadMediaGallery() {
    try {
      // Load posts with images
      const response = await fetch('/api/community/posts?has_media=true&limit=9');
      const data = await response.json();

      if (data.success) {
        this.mediaItems = data.posts.filter(post => post.image_urls && post.image_urls.length > 0);
        this.renderMediaPreview();
        this.renderMediaGallery();
      } else {
        console.error('❌ API error loading media:', data.error);
      }
    } catch (error) {
      console.error('❌ Error loading media:', error);
    }
  }



  // ========== RENDERING ==========

  renderCategoryTabs() {
    const container = document.getElementById('categoryTabs');
    if (!container) return;

    let html = `
      <button class="tab-btn ${this.currentFilter.category === 'all' ? 'active' : ''}" 
              data-category="all">
        ALL POSTS
      </button>
    `;

    this.categories.forEach(cat => {
      html += `
        <button class="tab-btn ${this.currentFilter.category === cat.id ? 'active' : ''}" 
                data-category="${cat.id}" ${cat.special_action ? `data-special-action="${cat.special_action}"` : ''}>
          ${cat.icon} ${cat.name.toUpperCase()}
        </button>
      `;
    });

    container.innerHTML = html;
  }

  renderCategoryOptions() {
    const select = document.getElementById('postCategory');
    if (!select) return;

    select.innerHTML = this.categories.map(cat =>
      `<option value="${cat.id}">${cat.icon} ${cat.name}</option>`
    ).join('');
  }

  renderHeroSection() {
    const container = document.getElementById('heroSection');
    if (!container || this.posts.length === 0) return;

    // Find featured post or use first post
    const heroPost = this.posts.find(p => p.is_featured) || this.posts[0];
    if (!heroPost) return;

    const imageUrl = heroPost.image_urls && heroPost.image_urls[0]
      ? heroPost.image_urls[0]
      : 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=800';

    container.innerHTML = `
      <div class="hero-post" onclick="communityApp.viewPost(${heroPost.id})">
        <div class="hero-image">
          <img src="${imageUrl}" alt="${this.escapeHtml(heroPost.title)}">
          ${heroPost.is_featured ? '<div class="hero-badge">FEATURED</div>' : ''}
        </div>
        <div class="hero-content">
          <div class="hero-category">${heroPost.category_name || 'COMMUNITY'}</div>
          <h2 class="hero-title">${this.escapeHtml(heroPost.title)}</h2>
          <p class="hero-excerpt">${this.escapeHtml(heroPost.content.substring(0, 200))}...</p>
          <div class="hero-meta">
            <div class="hero-author">
              <i class="fas fa-user"></i>
              <span>${heroPost.author_name || 'Anonymous'}</span>
            </div>
            <div class="hero-stats">
              <span><i class="fas fa-eye"></i> ${heroPost.view_count || 0}</span>
              <span><i class="fas fa-heart"></i> ${heroPost.like_count || 0}</span>
              <span><i class="fas fa-comment"></i> ${heroPost.comment_count || 0}</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  createPostCard(post) {
    const imageUrl = post.image_urls && post.image_urls[0]
      ? post.image_urls[0]
      : `https://source.unsplash.com/400x300/?techno,music,party&sig=${post.id}`;

    // Format date
    const postDate = new Date(post.created_at).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric'
    });

    // Add special styling for pinned posts
    const pinnedClass = post.is_pinned ? 'pinned-post' : '';
    const pinnedBadge = post.is_pinned ? '<div class="pinned-badge"><i class="fas fa-thumbtack"></i> PINNED</div>' : '';

    return `
      <div class="post-card ${pinnedClass}" data-post-id="${post.id}">
        <div class="post-image" onclick="communityApp.viewPost(${post.id})">
          <img src="${imageUrl}" alt="${this.escapeHtml(post.title)}" 
               onerror="this.onerror=null; this.src='https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=400';">
          <div class="post-category-badge" style="background: ${post.category_color || '#ff3333'}">
            ${post.category_icon || '📝'} ${post.category_name || 'COMMUNITY'}
          </div>
          ${pinnedBadge}
        </div>
        <div class="post-content">
          <h3 class="post-title" onclick="communityApp.viewPost(${post.id})">${this.escapeHtml(post.title)}</h3>
          <p class="post-excerpt" onclick="communityApp.viewPost(${post.id})">${this.escapeHtml(post.content.substring(0, 120))}...</p>
          <div class="post-meta">
            <div class="post-author-info">
              <i class="fas fa-user"></i>
              <span class="post-author">${post.author_name || 'Anonymous'}</span>
              <span class="post-date">${postDate}</span>
            </div>
            <div class="post-actions">
              <button class="action-btn like-btn ${post.user_liked ? 'liked' : ''}" onclick="communityApp.toggleLike(${post.id}, this)" data-post-id="${post.id}">
                <i class="fas fa-heart"></i> <span class="like-count">${post.like_count || 0}</span>
              </button>
              <button class="action-btn comment-btn" onclick="communityApp.showComments(${post.id})">
                <i class="fas fa-comment"></i> ${post.comment_count || 0}
              </button>
              <button class="action-btn share-btn" onclick="communityApp.sharePost(${post.id})">
                <i class="fas fa-share"></i>
              </button>
            </div>
          </div>
        </div>
        <!-- Comments Section - Always rendered but initially hidden -->
        <div class="comment-section" id="comments-${post.id}" style="display: none;">
          <div class="comments-header">
            <h4>Comments</h4>
          </div>
          <div class="comment-form">
            <textarea placeholder="Write a comment..." rows="2" id="comment-input-${post.id}"></textarea>
            <button onclick="communityApp.submitComment(${post.id}, this)">Post Comment</button>
          </div>
          <div class="comments-list" id="comments-list-${post.id}">
            <!-- Comments will be loaded here -->
          </div>
        </div>
      </div>
    `;
  }

  renderPosts(reset = false) {
    const grid = document.getElementById('postsGrid');
    if (!grid) {
      console.error('❌ Posts grid element not found');
      return;
    }

    console.log('🎨 Rendering posts:', this.posts.length);

    if (this.posts.length === 0) {
      grid.innerHTML = `
        <div class="no-posts" style="
            grid-column: 1 / -1;
            text-align: center;
            padding: 3rem;
            color: var(--text-secondary);
            font-size: 1.2rem;
        ">
            <i class="fas fa-comments" style="font-size: 3rem; margin-bottom: 1rem; opacity: 0.5;"></i>
            <div>No posts found</div>
            <div style="font-size: 0.9rem; margin-top: 0.5rem; opacity: 0.7;">
                Be the first to create a post!
            </div>
        </div>
      `;
      return;
    }

    try {
      grid.innerHTML = this.posts.map(post => this.createPostCard(post)).join('');
      console.log('✅ Posts rendered successfully');
    } catch (error) {
      console.error('❌ Error rendering posts:', error);
      this.showError('Error displaying posts: ' + error.message);
    }

    // Update load more button
    const loadMoreBtn = document.getElementById('loadMoreBtn');
    if (loadMoreBtn) {
      loadMoreBtn.style.display = this.pagination.hasMore ? 'block' : 'none';
    }
  }

  renderTrendingPosts(posts) {
    const container = document.getElementById('trendingPosts');
    if (!container) return;

    container.innerHTML = posts.slice(0, 5).map((post, index) => `
      <div class="trending-item" onclick="communityApp.viewPost(${post.id})">
        <div class="trending-number">${index + 1}</div>
        <div class="trending-content">
          <div class="trending-title">${this.escapeHtml(post.title)}</div>
          <div class="trending-meta">
            <i class="fas fa-eye"></i> ${post.view_count || 0} views
          </div>
        </div>
      </div>
    `).join('');
  }

  renderMediaPreview() {
    const container = document.getElementById('mediaPreview');
    if (!container) return;

    const previewItems = this.mediaItems.slice(0, 6);
    container.innerHTML = previewItems.map(item => {
      const imageUrl = item.image_urls[0];
      return `
        <div class="media-thumb" onclick="communityApp.openLightbox('${imageUrl}', '${this.escapeHtml(item.title)}', 'photo_${item.id}')">
          <img src="${imageUrl}" alt="${this.escapeHtml(item.title)}">
        </div>
      `;
    }).join('');
  }

  renderMediaGallery() {
    const container = document.getElementById('galleryGrid');
    if (!container) return;

    // Add sample official Black Room photos
    const officialPhotos = [
      { url: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=400', title: 'NYE 2024 Party', type: 'official' },
      { url: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=400', title: 'Techno Tuesday', type: 'official' },
      { url: 'https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?w=400', title: 'Underground Sessions', type: 'official' },
      { url: 'https://images.unsplash.com/photo-1504680177321-2e6a8797aac86?w=400', title: 'DJ Set Live', type: 'official' }
    ];

    const allMedia = [...officialPhotos, ...this.mediaItems.map(item => ({
      url: item.image_urls[0],
      title: item.title,
      type: 'community'
    }))];

    const filteredMedia = this.mediaFilter === 'all'
      ? allMedia
      : allMedia.filter(item => item.type === this.mediaFilter);

    container.innerHTML = filteredMedia.map((item, index) => `
      <div class="gallery-item" onclick="communityApp.openLightbox('${item.url}', '${this.escapeHtml(item.title)}', 'photo_${item.id || index}')">
        <img src="${item.url}" alt="${this.escapeHtml(item.title)}">
        <div class="gallery-overlay">
          <div class="gallery-info">
            <div class="gallery-event">${this.escapeHtml(item.title)}</div>
            <div class="gallery-date">${item.type === 'official' ? 'Black Room Official' : 'Community Upload'}</div>
          </div>
        </div>
      </div>
    `).join('');
  }



  // ========== INTERACTIONS ==========

  async toggleLike(postId, buttonElement) {
    try {
      const response = await fetch(`/api/community/posts/${postId}/like`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      const data = await response.json();

      if (data.success) {
        // Update button appearance
        const likeCount = buttonElement.querySelector('.like-count');
        likeCount.textContent = data.likeCount;

        if (data.liked) {
          buttonElement.classList.add('liked');
        } else {
          buttonElement.classList.remove('liked');
        }

        // Update post data
        const post = this.posts.find(p => p.id === postId);
        if (post) {
          post.like_count = data.likeCount;
          post.user_liked = data.liked;
        }
      } else {
        if (response.status === 401) {
          this.showError('Please login to like posts');
        } else {
          this.showError(data.error || 'Failed to like post');
        }
      }
    } catch (error) {
      console.error('❌ Error liking post:', error);
      this.showError('Failed to like post');
    }
  }

  showComments(postId) {
    // Toggle the visibility of the comment section
    const commentSection = document.getElementById(`comments-${postId}`);
    if (commentSection) {
      const isCurrentlyHidden = commentSection.style.display === 'none';
      commentSection.style.display = isCurrentlyHidden ? 'block' : 'none';

      // Load comments if showing for the first time
      if (isCurrentlyHidden) {
        this.loadCommentsForPost(postId);
      }
    }
  }

  async loadCommentsForPost(postId) {
    try {
      const response = await fetch(`/api/community/posts/${postId}/comments`);
      const data = await response.json();

      if (data.success) {
        const commentsList = document.getElementById(`comments-list-${postId}`);
        if (commentsList) {
          commentsList.innerHTML = data.comments.map(comment => `
            <div class="comment-item">
              <div class="comment-author">${this.escapeHtml(comment.author_name || 'Anonymous')}</div>
              <div class="comment-content">${this.escapeHtml(comment.content)}</div>
              <div class="comment-meta">
                <span class="comment-date">${new Date(comment.created_at).toLocaleDateString()}</span>
                <button class="comment-like-btn" onclick="communityApp.likeComment(${comment.id})">
                  <i class="fas fa-heart"></i> ${comment.like_count || 0}
                </button>
              </div>
            </div>
          `).join('');

          // Update comments header
          const header = document.querySelector(`#comments-${postId} .comments-header h4`);
          if (header) {
            header.textContent = `Comments (${data.comments.length})`;
          }
        }
      } else {
        console.error('❌ API error loading comments:', data.error);
      }
    } catch (error) {
      console.error('❌ Error loading comments:', error);
    }
  }

  async submitComment(postId, buttonElement) {
    const textarea = document.getElementById(`comment-input-${postId}`);
    const content = textarea.value.trim();

    if (!content) {
      this.showError('Please enter a comment');
      return;
    }

    try {
      const response = await fetch(`/api/community/posts/${postId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          user_id: this.currentUser?.id || 1 // Fallback for anonymous users
        })
      });

      const data = await response.json();

      if (data.success) {
        textarea.value = '';

        // Reload comments to show the new one
        this.loadCommentsForPost(postId);

        // Update comment count in post
        const post = this.posts.find(p => p.id === postId);
        if (post) {
          post.comment_count = (post.comment_count || 0) + 1;

          // Update the comment button count
          const commentBtn = document.querySelector(`[data-post-id="${postId}"] .comment-btn`);
          if (commentBtn) {
            commentBtn.innerHTML = `<i class="fas fa-comment"></i> ${post.comment_count}`;
          }
        }

        this.showSuccess('Comment posted successfully!');
      } else {
        this.showError(data.error || 'Failed to post comment');
      }
    } catch (error) {
      console.error('❌ Error posting comment:', error);
      this.showError('Failed to post comment');
    }
  }

  sharePost(postId) {
    const post = this.posts.find(p => p.id === postId);
    if (post && navigator.share) {
      navigator.share({
        title: post.title,
        text: post.content.substring(0, 100) + '...',
        url: window.location.href
      });
    } else {
      // Fallback: copy to clipboard
      navigator.clipboard.writeText(window.location.href);
      this.showSuccess('Link copied to clipboard!');
    }
  }

  selectCategory(categoryId) {
    const category = this.categories.find(cat => cat.id.toString() === categoryId.toString());

    // Check if it's the photos/gallery category by name or special action
    if (category && (category.special_action === 'gallery' || category.name.toLowerCase().includes('foto') || category.name.toLowerCase().includes('photo'))) {
      // First scroll to top
      window.scrollTo({ top: 0, behavior: 'smooth' });

      // Then navigate to gallery section after a short delay
      setTimeout(() => {
        const galleryTitle = document.querySelector('.gallery-title');
        const gallerySection = document.getElementById('gallerySection');

        if (galleryTitle) {
          // Get the title element's position and scroll with proper offset
          const titleRect = galleryTitle.getBoundingClientRect();
          const headerHeight = 120; // Increased to account for fixed header and navbar
          const scrollPosition = window.pageYOffset + titleRect.top - headerHeight;

          // Ensure we don't scroll above the title
          const finalPosition = Math.max(0, scrollPosition);

          window.scrollTo({
            top: finalPosition,
            behavior: 'smooth'
          });

          console.log('🎯 Scrolled to gallery title at position:', finalPosition);
        } else if (gallerySection) {
          // Fallback: scroll to section with block: start
          gallerySection.scrollIntoView({ behavior: 'smooth', block: 'start' });
          console.log('🎯 Fallback scroll to gallery section');
        }

        // Ensure "All Photos" tab is active by default when navigating to gallery
        setTimeout(() => {
          const allPhotosTab = document.querySelector('.gallery-tab[data-filter="all"]');
          if (allPhotosTab) {
            document.querySelectorAll('.gallery-tab').forEach(t => t.classList.remove('active'));
            allPhotosTab.classList.add('active');
            this.mediaFilter = 'all';
            this.renderMediaGallery();
          }
        }, 300);
      }, 300);

      // Update active tab in navbar
      document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.category === categoryId);
      });
      return; // Prevent default post loading
    }

    // For all other categories, scroll to top first
    window.scrollTo({ top: 0, behavior: 'smooth' });

    this.currentFilter.category = categoryId;
    this.loadPosts(true);

    // Update active tab
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.category === categoryId);
    });
  }

  viewPost(postId) {
    console.log('Viewing post:', postId);

    // Navigate to article page
    window.location.href = `/article.html?id=${postId}`;
  }

  showPostModal(post) {
    const modal = document.createElement('div');
    modal.className = 'post-modal';
    modal.innerHTML = `
      <div class="post-modal-content">
        <div class="post-modal-header">
          <h2>${this.escapeHtml(post.title)}</h2>
          <button class="post-modal-close">&times;</button>
        </div>
        <div class="post-modal-body">
          ${post.image_urls && post.image_urls[0] ?
            `<img src="${post.image_urls[0]}" alt="${this.escapeHtml(post.title)}" class="post-modal-image">` :
            ''}
          <div class="post-modal-meta">
            <span class="post-modal-category" style="color: ${post.category_color || '#ff3333'}">
              ${post.category_icon || '📝'} ${post.category_name || 'COMMUNITY'}
            </span>
            <span class="post-modal-author">by ${post.author_name || 'Anonymous'}</span>
            <span class="post-modal-stats">
              👁️ ${post.view_count || 0} • ❤️ ${post.like_count || 0} • 💬 ${post.comment_count || 0}
            </span>
          </div>
          <div class="post-modal-content-text">
            ${this.escapeHtml(post.content)}
          </div>
          ${post.spotify_embed ?
            `<iframe src="${post.spotify_embed}" width="300" height="380" frameborder="0" allowtransparency="true" allow="encrypted-media"></iframe>` :
            ''}
          ${post.video_embed_url ?
            `<iframe src="${post.video_embed_url}" width="100%" height="315" frameborder="0" allowfullscreen></iframe>` :
            ''}

          <!-- Comments Section in Modal -->
          <div class="post-modal-comments">
            <div class="comments-header">
              <h4>Comentarios</h4>
            </div>
            <div class="comment-form">
              <textarea placeholder="Escribe un comentario..." rows="2" id="modal-comment-input-${post.id}"></textarea>
              <button onclick="communityApp.submitModalComment(${post.id}, this)">Comentar</button>
            </div>
            <div class="comments-list" id="modal-comments-list-${post.id}">
              <!-- Comments will be loaded here -->
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Close modal functionality
    const closeBtn = modal.querySelector('.post-modal-close');
    closeBtn.addEventListener('click', () => {
      document.body.removeChild(modal);
    });

    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        document.body.removeChild(modal);
      }
    });

    // Load comments for this post in the modal
    this.loadModalComments(post.id);
  }

  async loadModalComments(postId) {
    try {
      const response = await fetch(`/api/community/posts/${postId}/comments`);
      const data = await response.json();

      if (data.success) {
        const commentsList = document.getElementById(`modal-comments-list-${postId}`);
        if (commentsList) {
          commentsList.innerHTML = data.comments.map(comment => `
            <div class="comment-item">
              <div class="comment-author">${this.escapeHtml(comment.author_name || 'Anonymous')}</div>
              <div class="comment-content">${this.escapeHtml(comment.content)}</div>
              <div class="comment-meta">
                <span class="comment-date">${new Date(comment.created_at).toLocaleDateString()}</span>
                <button class="comment-like-btn" onclick="communityApp.likeComment(${comment.id})">
                  <i class="fas fa-heart"></i> ${comment.like_count || 0}
                </button>
              </div>
            </div>
          `).join('');

          // Update comments header
          const header = document.querySelector('.post-modal-comments .comments-header h4');
          if (header) {
            header.textContent = `Comentarios (${data.comments.length})`;
          }
        }
      } else {
        console.error('❌ API error loading modal comments:', data.error);
      }
    } catch (error) {
      console.error('❌ Error loading modal comments:', error);
    }
  }

  async submitModalComment(postId, buttonElement) {
    const textarea = document.getElementById(`modal-comment-input-${postId}`);
    const content = textarea?.value?.trim();

    if (!content) {
      this.showError('Please enter a comment');
      return;
    }

    try {
      const response = await fetch(`/api/community/posts/${postId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: content,
          author_name: this.currentUser?.full_name || 'Techno Fan'
        })
      });

      const data = await response.json();

      if (data.success) {
        // Clear textarea
        textarea.value = '';

        // Reload comments to show the new one
        this.loadModalComments(postId);

        this.showSuccess('Comment posted successfully!');
      } else {
        this.showError(data.error || 'Failed to post comment');
      }
    } catch (error) {
      console.error('❌ Error posting modal comment:', error);
      this.showError('Failed to post comment');
    }
  }

  openLightbox(imageUrl, caption, photoId = null) {
    const lightbox = document.getElementById('lightbox');
    const img = document.getElementById('lightboxImage');
    const captionText = document.getElementById('lightboxCaption');

    if (lightbox && img && captionText) {
      img.src = imageUrl;
      captionText.textContent = caption;

      // Store current photo ID for comments
      this.currentPhotoId = photoId || `photo_${Date.now()}`;

      // Show lightbox
      lightbox.style.display = 'block';

      // Load comments for this photo
      this.loadPhotoComments(this.currentPhotoId);
    }
  }

  navigateToGallery() {
    const galleryTitle = document.querySelector('.gallery-title');
    const gallerySection = document.getElementById('gallerySection');

    if (galleryTitle) {
      // Calculate dynamic offset by measuring actual elements
      const header = document.querySelector('.black-room-header');
      const navbar = document.querySelector('.community-navbar') || document.querySelector('.navbar-container');

      const headerHeight = header ? header.offsetHeight : 70;
      const navbarHeight = navbar ? navbar.offsetHeight : 0;
      const totalOffset = headerHeight + navbarHeight + 20; // Add 20px margin

      // Get the title element's position and scroll with proper offset
      const titleRect = galleryTitle.getBoundingClientRect();
      const scrollPosition = window.pageYOffset + titleRect.top - totalOffset;

      // Ensure we don't scroll above the title
      const finalPosition = Math.max(0, scrollPosition);

      window.scrollTo({
        top: finalPosition,
        behavior: 'smooth'
      });

      console.log('📸 Navigated to gallery with title visible. Offset:', totalOffset, 'Header:', headerHeight, 'Navbar:', navbarHeight);
    } else if (gallerySection) {
      // Fallback: scroll to section with dynamic offset
      const header = document.querySelector('.black-room-header');
      const navbar = document.querySelector('.community-navbar') || document.querySelector('.navbar-container');

      const headerHeight = header ? header.offsetHeight : 70;
      const navbarHeight = navbar ? navbar.offsetHeight : 0;
      const totalOffset = headerHeight + navbarHeight + 20;

      const elementPosition = gallerySection.getBoundingClientRect().top;
      const offsetPosition = elementPosition + window.pageYOffset - totalOffset;

      window.scrollTo({
        top: offsetPosition,
        behavior: 'smooth'
      });
      console.log('📸 Fallback navigation to gallery section. Offset:', totalOffset);
    }

    // Ensure "All Photos" tab is active when navigating to gallery
    setTimeout(() => {
      const allPhotosTab = document.querySelector('.gallery-tab[data-filter="all"]');
      if (allPhotosTab) {
        document.querySelectorAll('.gallery-tab').forEach(t => t.classList.remove('active'));
        allPhotosTab.classList.add('active');
        this.mediaFilter = 'all';
        this.renderMediaGallery();
      }
    }, 100);
  }

  closeLightbox() {
    const lightbox = document.getElementById('lightbox');
    if (lightbox) {
      lightbox.style.display = 'none';
      // Clear photo ID
      this.currentPhotoId = null;
      // Clear comments
      const commentsList = document.getElementById('lightboxCommentsList');
      if (commentsList) {
        commentsList.innerHTML = '';
      }
    }
  }

  async loadPhotoComments(photoId) {
    try {
      const response = await fetch(`/api/community/photos/${photoId}/comments`);
      const data = await response.json();

      if (data.success) {
        const commentsList = document.getElementById('lightboxCommentsList');
        if (commentsList) {
          commentsList.innerHTML = data.comments.map(comment => `
            <div class="lightbox-comment-item">
              <div class="lightbox-comment-author">${this.escapeHtml(comment.author_name || 'Anonymous')}</div>
              <div class="lightbox-comment-content">${this.escapeHtml(comment.content)}</div>
              <div class="lightbox-comment-meta">
                <span class="lightbox-comment-date">${new Date(comment.created_at).toLocaleDateString()}</span>
                <button class="lightbox-comment-like-btn" onclick="communityApp.likePhotoComment(${comment.id})">
                  <i class="fas fa-heart"></i> ${comment.like_count || 0}
                </button>
              </div>
            </div>
          `).join('');
        }

        // Update comments header
        const header = document.querySelector('#lightboxComments .lightbox-comments-header h4');
        if (header) {
          header.textContent = `Comentarios en esta foto (${data.comments.length})`;
        }
      } else {
        console.error('❌ API error loading photo comments:', data.error);
      }
    } catch (error) {
      console.error('❌ Error loading photo comments:', error);
    }
  }

  async submitPhotoComment() {
    const textarea = document.getElementById('lightboxCommentInput');
    const content = textarea?.value?.trim();

    if (!content) {
      this.showError('Please enter a comment');
      return;
    }

    if (!this.currentPhotoId) {
      this.showError('No photo selected');
      return;
    }

    try {
      const response = await fetch(`/api/community/photos/${this.currentPhotoId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: content,
          author_name: this.currentUser?.full_name || 'Techno Fan'
        })
      });

      const data = await response.json();

      if (data.success) {
        // Clear textarea
        textarea.value = '';

        // Reload comments to show the new one
        this.loadPhotoComments(this.currentPhotoId);

        this.showSuccess('Comment posted successfully!');
      } else {
        this.showError(data.error || 'Failed to post comment');
      }
    } catch (error) {
      console.error('❌ Error posting photo comment:', error);
      this.showError('Failed to post comment');
    }
  }

  async likePhotoComment(commentId) {
    // Placeholder for photo comment likes
    console.log('👍 Photo comment like functionality:', commentId);
    this.showInfo('Photo comment likes coming soon!');
  }

  // ========== CREATE POST ==========

  async createPost(formData) {
    try {
      // If user is not logged in, use author_name from form
      if (!this.currentUser) {
        const authorName = document.getElementById('authorName')?.value;
        if (!authorName) {
          this.showError('Please enter your name');
          return;
        }
        formData.author_name = authorName;
        formData.user_id = null; // Will be handled by backend
      } else {
        formData.user_id = this.currentUser.id;
        formData.author_name = this.currentUser.full_name || this.currentUser.email;
      }

      console.log('📝 Creating post with data:', formData);

      const response = await fetch('/api/community/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      const data = await response.json();
      console.log('📝 Post creation response:', data);

      if (data.success) {
        this.closeModal();

        // Clear form
        document.getElementById('createPostForm').reset();

        // Reset pagination to force complete reload
        this.pagination.offset = 0;
        this.pagination.hasMore = true;
        this.posts = []; // Clear existing posts

        // Force complete reload of all data
        await this.loadPosts(true);

        // Scroll to top to see the new post
        window.scrollTo({ top: 0, behavior: 'smooth' });

        this.showSuccess('¡Post creado exitosamente y visible!');
        console.log('✅ Post created, all data reloaded');

      } else {
        this.showError(data.error || 'Failed to create post');
      }
    } catch (error) {
      console.error('❌ Error creating post:', error);
      this.showError('Failed to create post');
    }
  }

  // ========== UI HELPERS ==========

  showModal() {
    const modal = document.getElementById('createPostModal');
    if (modal) modal.style.display = 'block';
  }

  closeModal() {
    const modal = document.getElementById('createPostModal');
    if (modal) modal.style.display = 'none';
  }

  showError(message) {
    console.error('❌', message);

    // Create temporary error message
    const errorDiv = document.createElement('div');
    errorDiv.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: #ff3333;
      color: white;
      padding: 15px 20px;
      border-radius: 8px;
      z-index: 10000;
      font-weight: bold;
      box-shadow: 0 4px 15px rgba(0,0,0,0.3);
    `;
    errorDiv.textContent = message;
    document.body.appendChild(errorDiv);

    setTimeout(() => {
      if (errorDiv.parentNode) {
        document.body.removeChild(errorDiv);
      }
    }, 5000);
  }

  showSuccess(message) {
    console.log('✅', message);

    // Create temporary success message
    const successDiv = document.createElement('div');
    successDiv.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: #00ff00;
      color: black;
      padding: 15px 20px;
      border-radius: 8px;
      z-index: 10000;
      font-weight: bold;
      box-shadow: 0 4px 15px rgba(0,0,0,0.3);
    `;
    successDiv.textContent = message;
    document.body.appendChild(successDiv);

    setTimeout(() => {
      if (successDiv.parentNode) {
        document.body.removeChild(successDiv);
      }
    }, 3000);
  }

  handleMediaTabSwitch(type) {
    const mediaInput = document.getElementById('mediaInput');
    const mediaUrl = document.getElementById('mediaUrl');
    const imageUploadSection = document.getElementById('imageUploadSection');

    if (type === 'none') {
      mediaInput.style.display = 'none';
    } else {
      mediaInput.style.display = 'block';

      if (type === 'image') {
        mediaUrl.style.display = 'none';
        imageUploadSection.style.display = 'block';
        this.showUploadPlaceholder();
      } else {
        mediaUrl.style.display = 'block';
        imageUploadSection.style.display = 'none';
        // Update placeholder text based on type
        if (type === 'video') {
          mediaUrl.placeholder = 'Enter YouTube video URL';
        } else if (type === 'spotify') {
          mediaUrl.placeholder = 'Enter Spotify track/playlist URL';
        }
      }
    }
  }

  showUploadPlaceholder() {
    const uploadPreview = document.getElementById('uploadPreview');
    if (uploadPreview) {
      uploadPreview.innerHTML = `
        <div class="upload-placeholder">
          <i class="fas fa-cloud-upload-alt"></i>
          <span>Selecciona fotos para subir</span>
        </div>
      `;
    }
  }

  handleFileSelection(event) {
    const files = event.target.files;
    const uploadPreview = document.getElementById('uploadPreview');

    if (files.length === 0) {
      this.showUploadPlaceholder();
      return;
    }

    // Limit to 5 files
    const limitedFiles = Array.from(files).slice(0, 5);

    uploadPreview.innerHTML = '';
    uploadPreview.classList.add('has-files');

    limitedFiles.forEach((file, index) => {
      if (file.size > 5 * 1024 * 1024) { // 5MB limit
        this.showError(`File "${file.name}" is too large (max 5MB)`);
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        const previewItem = document.createElement('div');
        previewItem.className = 'preview-item';
        previewItem.innerHTML = `
          <img src="${e.target.result}" alt="Preview">
          <button type="button" class="preview-remove" onclick="communityApp.removePreviewItem(${index})">
            <i class="fas fa-times"></i>
          </button>
        `;
        uploadPreview.appendChild(previewItem);
      };
      reader.readAsDataURL(file);
    });

    // Store files for later upload
    this.selectedFiles = limitedFiles;
  }

  removePreviewItem(index) {
    // Remove from selectedFiles array
    if (this.selectedFiles) {
      this.selectedFiles.splice(index, 1);

      // Update file input
      const imageFiles = document.getElementById('imageFiles');
      if (imageFiles && this.selectedFiles.length === 0) {
        imageFiles.value = '';
        this.showUploadPlaceholder();
      } else if (this.selectedFiles.length > 0) {
        // Re-render preview
        this.handleFileSelection({ target: { files: this.selectedFiles } });
      }
    }
  }

  async uploadFiles(files) {
    try {
      const formData = new FormData();

      // Add all files to FormData
      Array.from(files).forEach((file, index) => {
        formData.append('images', file);
      });

      console.log('📤 Uploading', files.length, 'files...');

      const response = await fetch('/api/upload/images', {
        method: 'POST',
        body: formData
      });

      const data = await response.json();

      if (data.success) {
        console.log('✅ Upload successful:', data.files);
        return {
          success: true,
          files: data.files
        };
      } else {
        console.error('❌ Upload failed:', data.error);
        return {
          success: false,
          error: data.error
        };
      }
    } catch (error) {
      console.error('❌ Upload error:', error);
      return {
        success: false,
        error: 'Network error during upload'
      };
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Added showError method for displaying errors in the grid
  showError(message) {
    const grid = document.getElementById('postsGrid');
    if (grid) {
      grid.innerHTML = `
        <div class="error-message" style="
            grid-column: 1 / -1;
            text-align: center;
            padding: 2rem;
            background: rgba(255, 0, 0, 0.1);
            border: 1px solid #ff0000;
            border-radius: 8px;
            color: #ff6666;
            font-weight: 600;
        ">
            <i class="fas fa-exclamation-triangle" style="margin-right: 0.5rem;"></i>
            ${message}
        </div>
      `;
    }
  }


  // ========== EVENT LISTENERS ==========

  setupEventListeners() {
    // Category tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const categoryId = btn.dataset.category;

        // Always scroll to top first for any tab click
        window.scrollTo({ top: 0, behavior: 'smooth' });

        // Update active tab
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // Handle category selection (including special actions like gallery)
        this.selectCategory(categoryId);
      });
    });

    // Gallery filter tabs
    document.querySelectorAll('.gallery-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.gallery-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        const filter = tab.dataset.filter;
        this.mediaFilter = filter === 'official' ? 'official' : filter === 'community' ? 'community' : 'all';
        this.renderMediaGallery();
      });
    });

    // Create post button
    const createBtn = document.getElementById('createPostBtn');
    if (createBtn) {
      createBtn.addEventListener('click', () => {
        this.showModal();
        // Show author name field if not logged in
        const authorNameGroup = document.getElementById('authorNameGroup');
        if (authorNameGroup) {
          authorNameGroup.style.display = this.currentUser ? 'none' : 'block';
        }
      });
    }

    // Modal close button
    const closeBtn = document.getElementById('closeModalBtn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.closeModal());
    }

    // Media tab switching
    document.querySelectorAll('.media-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.media-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.handleMediaTabSwitch(tab.dataset.type);
      });
    });

    // File input change handler
    const imageFiles = document.getElementById('imageFiles');
    if (imageFiles) {
      imageFiles.addEventListener('change', (e) => this.handleFileSelection(e));
    }

    // Create post form
    const form = document.getElementById('createPostForm');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();

        // Validar campos requeridos
        const title = document.getElementById('postTitle').value.trim();
        const content = document.getElementById('postContent').value.trim();
        const categoryId = document.getElementById('postCategory').value;

        if (!title || !content || !categoryId) {
          this.showError('Por favor completa todos los campos requeridos');
          return;
        }

        const formData = {
          category_id: categoryId,
          title: title,
          content: content
        };

        // Handle media based on selected type
        const activeMediaTab = document.querySelector('.media-tab.active');
        if (activeMediaTab && activeMediaTab.dataset.type !== 'none') {
          if (activeMediaTab.dataset.type === 'image') {
            // Handle file uploads for images
            if (this.selectedFiles && this.selectedFiles.length > 0) {
              console.log('📤 Uploading files first...');
              const uploadResult = await this.uploadFiles(this.selectedFiles);
              if (uploadResult.success) {
                formData.image_urls = uploadResult.files;
                console.log('✅ Files uploaded:', uploadResult.files);
              } else {
                this.showError(uploadResult.error || 'Failed to upload images');
                return;
              }
            }
          } else {
            // Handle URL inputs for video/spotify
            const mediaUrl = document.getElementById('mediaUrl')?.value?.trim();
            if (mediaUrl) {
              if (activeMediaTab.dataset.type === 'video') {
                formData.video_embed_url = mediaUrl;
              } else if (activeMediaTab.dataset.type === 'spotify') {
                formData.spotify_embed = mediaUrl;
              }
            }
          }
        }

        console.log('📝 Enviando post:', formData);
        await this.createPost(formData);
      });
    }


    // Filter select
    const filterSelect = document.getElementById('filterSelect');
    if (filterSelect) {
      filterSelect.addEventListener('change', () => {
        this.currentFilter.status = filterSelect.value;
        this.loadPosts(true);
      });
    }

    // View toggles
    document.querySelectorAll('.view-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const grid = document.getElementById('postsGrid');
        if (btn.dataset.view === 'list') {
          grid.style.gridTemplateColumns = '1fr';
        } else {
          grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(280px, 1fr))';
        }
      });
    });

    // Load more button
    const loadMoreBtn = document.getElementById('loadMoreBtn');
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', () => this.loadPosts());
    }

    // Lightbox close
    const lightboxClose = document.querySelector('.lightbox-close');
    if (lightboxClose) {
      lightboxClose.addEventListener('click', () => this.closeLightbox());
    }

    // Click outside lightbox to close
    const lightbox = document.getElementById('lightbox');
    if (lightbox) {
      lightbox.addEventListener('click', (e) => {
        if (e.target === lightbox) {
          this.closeLightbox();
        }
      });
    }
  }
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  // Wait a bit for header to fully initialize and render
  // This delay helps ensure that elements like category tabs are available
  setTimeout(() => {
    if (typeof window.communityApp === 'undefined') {
      window.communityApp = new CommunityApp();
    }
  }, 150); // A small delay to ensure the DOM is ready and header is rendered
});