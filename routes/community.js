import { Router } from 'express';
import pool from '../database/connection.js';

const router = Router();

// ========== CATEGORIES ==========

// Obtener todas las categorías activas
router.get('/categories', async (req, res) => {
  try {
    // Sample categories data
    const sampleCategories = [
      {
        id: 1,
        name: "Events",
        description: "Share your experiences from Black Room events and other techno parties",
        color: "#ff3333",
        icon: "🎉",
        sort_order: 1
      },
      {
        id: 2,
        name: "Music",
        description: "Discover and share the hottest techno tracks and mixes",
        color: "#00ff00",
        icon: "🎵",
        sort_order: 2
      },
      
      {
        id: 4,
        name: "Photos",
        description: "Share your best shots from events and techno culture",
        color: "#ff6600",
        icon: "📸",
        sort_order: 3,
        special_action: "gallery"
      },
      {
        id: 5,
        name: "News",
        description: "Latest news and announcements from the techno world",
        color: "#9933ff",
        icon: "📰",
        sort_order: 4
      }
    ];
    
    res.json({
      success: true,
      categories: sampleCategories
    });

    return; // Return early to use sample data

    const result = await pool.query(`
      SELECT id, name, description, color, icon, sort_order
      FROM categories 
      WHERE is_active = true 
      ORDER BY sort_order, name
    `);
    
    res.json({
      success: true,
      categories: result.rows
    });
  } catch (error) {
    console.error('❌ Error fetching categories:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error loading categories' 
    });
  }
});

// ========== POSTS ==========

// Obtener posts con filtros
router.get('/posts', async (req, res) => {
  try {
    const { 
      category_id, 
      status = 'approved', 
      limit = 20, 
      offset = 0, 
      user_id,
      featured_only = false 
    } = req.query;

    // ===== USANDO BASE DE DATOS REAL =====
    let query = `
      SELECT 
        p.id, p.title, p.content, p.image_urls, p.video_embed_url, p.spotify_embed,
        p.status, p.is_featured, p.is_pinned, p.view_count, p.like_count, p.comment_count,
        p.created_at, p.updated_at,
        c.name as category_name, c.color as category_color, c.icon as category_icon,
        u.full_name as author_name, u.photo as author_photo
      FROM posts p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN users_extended u ON p.user_id = u.id
      WHERE 1=1
    `;
    
    const params = [];
    let paramIndex = 1;

    // Filtros
    if (category_id && category_id !== 'all') {
      query += ` AND p.category_id = $${paramIndex}`;
      params.push(category_id);
      paramIndex++;
    }
    
    // Handle different filter types
    if (status && status !== 'all') {
      switch (status) {
        case 'trending':
          // Keep WHERE clause for approved posts only
          query += ` AND p.status = 'approved'`;
          break;
        case 'popular':
          query += ` AND p.status = 'approved'`;
          break;
        case 'recent':
          query += ` AND p.status = 'approved'`;
          break;
        case 'this_week':
          query += ` AND p.status = 'approved' AND p.created_at >= NOW() - INTERVAL '7 days'`;
          break;
        default:
          // For legacy status filtering (approved, pending, etc)
          query += ` AND p.status = $${paramIndex}`;
          params.push(status);
          paramIndex++;
          break;
      }
    }

    if (user_id) {
      query += ` AND p.user_id = $${paramIndex}`;
      params.push(user_id);
      paramIndex++;
    }

    if (featured_only === 'true') {
      query += ` AND p.is_featured = true`;
    }

    // Different ordering based on filter type
    if (status === 'trending') {
      query += ` ORDER BY p.is_pinned DESC, (p.like_count + p.comment_count * 2) DESC, p.created_at DESC`;
    } else if (status === 'popular') {
      query += ` ORDER BY p.is_pinned DESC, p.like_count DESC, p.comment_count DESC`;
    } else if (status === 'recent') {
      query += ` ORDER BY p.is_pinned DESC, p.updated_at DESC, p.created_at DESC`;
    } else {
      // Default ordering: pinned first, then by date
      query += ` ORDER BY p.is_pinned DESC, p.created_at DESC`;
    }
    
    // Paginación
    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(parseInt(limit), parseInt(offset));

    console.log('🔍 Executing posts query:', query);
    console.log('📋 Query params:', params);

    const result = await pool.query(query, params);
    
    console.log(`✅ Found ${result.rows.length} posts from database`);
    
    res.json({
      success: true,
      posts: result.rows,
      total: result.rows.length,
      has_more: result.rows.length === parseInt(limit)
    });

    // Sample data completamente eliminado - usando base de datos real
  } catch (error) {
    console.error('❌ Error fetching posts:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error loading posts' 
    });
  }
});

// Obtener un post específico (con incremento de views)
router.get('/posts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Incrementar view count
    await pool.query(`
      UPDATE posts SET view_count = view_count + 1 
      WHERE id = $1
    `, [id]);

    // Obtener post con detalles
    const result = await pool.query(`
      SELECT 
        p.id, p.title, p.content, p.image_urls, p.video_embed_url, p.spotify_embed,
        p.status, p.is_featured, p.is_pinned, p.view_count, p.like_count, p.comment_count,
        p.created_at, p.updated_at,
        c.name as category_name, c.color as category_color, c.icon as category_icon,
        u.full_name as author_name, u.photo as author_photo, u.id as author_id
      FROM posts p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN users_extended u ON p.user_id = u.id
      WHERE p.id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Post not found'
      });
    }

    res.json({
      success: true,
      post: result.rows[0]
    });
  } catch (error) {
    console.error('❌ Error fetching post:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error loading post' 
    });
  }
});

// Crear nuevo post
router.post('/posts', async (req, res) => {
  try {
    const { title, content, category_id, image_urls = [], video_embed_url, spotify_embed, author_name } = req.body;
    let user_id = req.session?.user?.id || req.body.user_id;

    if (!title || !content || !category_id) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: title, content, category_id'
      });
    }

    // Set default user_id if not provided
    if (!user_id) {
      user_id = 1; // Default user for testing
    }

    // Insert post into database
    const result = await pool.query(`
      INSERT INTO posts (
        title, content, category_id, user_id, image_urls, video_embed_url, 
        spotify_embed, status, is_featured, is_pinned, view_count, 
        like_count, comment_count, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
      RETURNING id, created_at, status
    `, [
      title,
      content, 
      category_id,
      user_id,
      image_urls,
      video_embed_url,
      spotify_embed,
      'approved', // Auto-approve
      false, // is_featured
      false, // is_pinned
      0, // view_count
      0, // like_count
      0  // comment_count
    ]);

    const newPost = result.rows[0];

    // Log the creation for debugging
    console.log('✅ New post saved to database:', {
      id: newPost.id,
      title: title,
      author: author_name || 'Anonymous'
    });

    res.status(201).json({
      success: true,
      post: {
        id: newPost.id,
        status: newPost.status,
        created_at: newPost.created_at,
        message: 'Post published successfully!'
      }
    });
  } catch (error) {
    console.error('❌ Error creating post:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error creating post' 
    });
  }
});

// ========== COMMENTS ==========

// Obtener comentarios de un post
router.get('/posts/:postId/comments', async (req, res) => {
  try {
    const { postId } = req.params;
    
    // Sample comments data
    const sampleComments = [
      {
        id: Date.now() + Math.floor(Math.random() * 100),
        content: '¡Increíble evento! No puedo esperar a estar ahí 🎉',
        author_name: 'Maria Rodriguez',
        author_photo: null,
        author_id: 1,
        like_count: 5,
        parent_comment_id: null,
        created_at: new Date(Date.now() - 3600000), // 1 hora atrás
        replies: []
      },
      {
        id: Date.now() + Math.floor(Math.random() * 100) + 1,
        content: 'La música estuvo brutal la última vez. ¿Quién toca esta vez?',
        author_name: 'Carlos Miami',
        author_photo: null,
        author_id: 2,
        like_count: 3,
        parent_comment_id: null,
        created_at: new Date(Date.now() - 1800000), // 30 min atrás
        replies: []
      },
      {
        id: Date.now() + Math.floor(Math.random() * 100) + 2,
        content: '¡Qué buenas fotos! Me encanta el ambiente de Black Room ✨',
        author_name: 'Sofia Techno',
        author_photo: null,
        author_id: 3,
        like_count: 8,
        parent_comment_id: null,
        created_at: new Date(Date.now() - 900000), // 15 min atrás
        replies: []
      }
    ];

    console.log('💬 Loading comments for post:', postId, 'Found:', sampleComments.length);

    res.json({
      success: true,
      comments: sampleComments,
      total: sampleComments.length
    });
  } catch (error) {
    console.error('❌ Error fetching comments:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error loading comments' 
    });
  }
});

// Agregar comentario
router.post('/posts/:postId/comments', async (req, res) => {
  try {
    const { postId } = req.params;
    const { content, parent_comment_id } = req.body;
    const author_name = req.body.author_name || req.session?.user?.name || 'Usuario Anónimo';

    if (!content) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: content'
      });
    }

    // Create new comment with sample data
    const newComment = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      content: content,
      author_name: author_name,
      author_photo: null,
      author_id: Math.floor(Math.random() * 100) + 1,
      like_count: 0,
      parent_comment_id: parent_comment_id || null,
      created_at: new Date()
    };

    console.log('💬 New comment created (sample mode):', {
      id: newComment.id,
      post: postId,
      author: newComment.author_name,
      content: content.substring(0, 50) + '...'
    });

    res.status(201).json({
      success: true,
      comment: newComment,
      message: 'Comment posted successfully!'
    });
  } catch (error) {
    console.error('❌ Error creating comment:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error creating comment' 
    });
  }
});

// ========== PHOTO COMMENTS ==========

// Obtener comentarios de una foto
router.get('/photos/:photoId/comments', async (req, res) => {
  try {
    const { photoId } = req.params;
    
    // Sample photo comments data
    const samplePhotoComments = [
      {
        id: Date.now() + Math.floor(Math.random() * 100),
        content: '¡Qué ambiente tan increíble! Se ve brutal la pista 🔥',
        author_name: 'Elena Rave',
        author_photo: null,
        author_id: 1,
        like_count: 12,
        created_at: new Date(Date.now() - 2700000), // 45 min atrás
      },
      {
        id: Date.now() + Math.floor(Math.random() * 100) + 1,
        content: 'Estuve esa noche, fue épica. Black Room siempre la rompe ✨',
        author_name: 'Marco Techno',
        author_photo: null,
        author_id: 2,
        like_count: 8,
        created_at: new Date(Date.now() - 1350000), // 22 min atrás
      },
      {
        id: Date.now() + Math.floor(Math.random() * 100) + 2,
        content: 'Me encantan las luces de esta foto. ¿Quién era el DJ?',
        author_name: 'Ana Miami',
        author_photo: null,
        author_id: 3,
        like_count: 5,
        created_at: new Date(Date.now() - 600000), // 10 min atrás
      }
    ];

    console.log('📸 Loading photo comments for:', photoId, 'Found:', samplePhotoComments.length);

    res.json({
      success: true,
      comments: samplePhotoComments,
      total: samplePhotoComments.length
    });
  } catch (error) {
    console.error('❌ Error fetching photo comments:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error loading photo comments' 
    });
  }
});

// Agregar comentario a una foto
router.post('/photos/:photoId/comments', async (req, res) => {
  try {
    const { photoId } = req.params;
    const { content } = req.body;
    const author_name = req.body.author_name || req.session?.user?.name || 'Techno Fan';

    if (!content) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: content'
      });
    }

    // Create new photo comment with sample data
    const newPhotoComment = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      content: content,
      author_name: author_name,
      author_photo: null,
      author_id: Math.floor(Math.random() * 100) + 1,
      like_count: 0,
      created_at: new Date()
    };

    console.log('📸 New photo comment created (sample mode):', {
      id: newPhotoComment.id,
      photo: photoId,
      author: newPhotoComment.author_name,
      content: content.substring(0, 50) + '...'
    });

    res.status(201).json({
      success: true,
      comment: newPhotoComment,
      message: 'Photo comment posted successfully!'
    });
  } catch (error) {
    console.error('❌ Error creating photo comment:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error creating photo comment' 
    });
  }
});

// ========== LIKES ==========

// Toggle like on post
router.post('/posts/:postId/like', async (req, res) => {
  try {
    const { postId } = req.params;
    const user_id = req.session?.user?.id || req.body.user_id;

    if (!user_id) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    // Check if user already liked this post
    const existingLike = await pool.query(`
      SELECT id FROM post_likes 
      WHERE user_id = $1 AND post_id = $2
    `, [user_id, postId]);

    let liked = false;
    let likeCount = 0;

    if (existingLike.rows.length > 0) {
      // Remove like
      await pool.query(`DELETE FROM post_likes WHERE user_id = $1 AND post_id = $2`, [user_id, postId]);
      await pool.query(`UPDATE posts SET like_count = like_count - 1 WHERE id = $1`, [postId]);
    } else {
      // Add like
      await pool.query(`INSERT INTO post_likes (user_id, post_id) VALUES ($1, $2)`, [user_id, postId]);
      await pool.query(`UPDATE posts SET like_count = like_count + 1 WHERE id = $1`, [postId]);
      liked = true;
    }

    // Get updated like count
    const result = await pool.query(`SELECT like_count FROM posts WHERE id = $1`, [postId]);
    likeCount = result.rows[0]?.like_count || 0;

    res.json({
      success: true,
      liked,
      likeCount
    });
  } catch (error) {
    console.error('❌ Error toggling like:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error processing like' 
    });
  }
});

// ========== REACTIONS ==========

// Toggle reaction (like, fire, love, etc)
router.post('/reactions', async (req, res) => {
  try {
    const { post_id, comment_id, reaction_type } = req.body;
    const user_id = req.session?.user?.id || req.body.user_id; // Fallback para testing

    if (!reaction_type || !user_id || (!post_id && !comment_id)) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: reaction_type and either post_id or comment_id'
      });
    }

    // Verificar si ya existe la reacción
    const existing = await pool.query(`
      SELECT id FROM reactions 
      WHERE user_id = $1 AND reaction_type = $2 
      AND (post_id = $3 OR comment_id = $4)
    `, [user_id, reaction_type, post_id || null, comment_id || null]);

    let action = '';

    if (existing.rows.length > 0) {
      // Quitar reacción existente
      await pool.query(`
        DELETE FROM reactions WHERE id = $1
      `, [existing.rows[0].id]);
      action = 'removed';
    } else {
      // Agregar nueva reacción
      await pool.query(`
        INSERT INTO reactions (user_id, post_id, comment_id, reaction_type)
        VALUES ($1, $2, $3, $4)
      `, [user_id, post_id || null, comment_id || null, reaction_type]);
      action = 'added';
    }

    res.json({
      success: true,
      action,
      reaction_type
    });
  } catch (error) {
    console.error('❌ Error handling reaction:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error processing reaction' 
    });
  }
});

// Obtener reacciones de un post/comment
router.get('/reactions', async (req, res) => {
  try {
    const { post_id, comment_id, user_id } = req.query;

    if (!post_id && !comment_id) {
      return res.status(400).json({
        success: false,
        error: 'Either post_id or comment_id is required'
      });
    }

    let query = `
      SELECT reaction_type, COUNT(*) as count,
      ${user_id ? `BOOL_OR(user_id = ${parseInt(user_id)}) as user_reacted` : 'false as user_reacted'}
      FROM reactions 
      WHERE `;
    
    const params = [];
    if (post_id) {
      query += `post_id = $1`;
      params.push(post_id);
    } else {
      query += `comment_id = $1`;
      params.push(comment_id);
    }

    query += ` GROUP BY reaction_type ORDER BY count DESC`;

    const result = await pool.query(query, params);

    res.json({
      success: true,
      reactions: result.rows
    });
  } catch (error) {
    console.error('❌ Error fetching reactions:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error loading reactions' 
    });
  }
});

export default router;