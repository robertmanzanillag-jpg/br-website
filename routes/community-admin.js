import { Router } from 'express';
import pool from '../database/connection.js';

const router = Router();

// Middleware para verificar que el usuario es admin
const requireAdmin = (req, res, next) => {
  const userEmail = req.session?.user?.email;
  if (userEmail !== 'robert.manzanillag@gmail.com') {
    return res.status(403).json({
      success: false,
      error: 'Admin access required'
    });
  }
  next();
};

// ========== MODERATION ==========

// Obtener posts pendientes de moderación
router.get('/posts/pending', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        p.id, p.title, p.content, p.image_urls, p.video_embed_url, p.spotify_embed,
        p.status, p.created_at,
        c.name as category_name, c.color as category_color, c.icon as category_icon,
        u.full_name as author_name, u.photo as author_photo, u.email as author_email
      FROM posts p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN users_extended u ON p.user_id = u.id
      WHERE p.status = 'pending'
      ORDER BY p.created_at ASC
    `);

    res.json({
      success: true,
      posts: result.rows
    });
  } catch (error) {
    console.error('❌ Error fetching pending posts:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error loading pending posts' 
    });
  }
});

// Aprobar/rechazar post
router.patch('/posts/:id/moderate', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { action, reason } = req.body; // action: 'approve' | 'reject'
    
    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({
        success: false,
        error: 'Action must be approve or reject'
      });
    }

    const status = action === 'approve' ? 'approved' : 'rejected';
    const adminId = req.session?.user?.id || 1; // Fallback para testing

    const result = await pool.query(`
      UPDATE posts 
      SET status = $1, approved_at = NOW(), approved_by = $2
      WHERE id = $3
      RETURNING id, status, approved_at
    `, [status, adminId, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Post not found'
      });
    }

    // Si se rechaza, crear notificación al usuario
    if (action === 'reject') {
      await pool.query(`
        INSERT INTO notifications (user_id, type, title, message, post_id)
        SELECT user_id, 'post_rejected', 'Post Rejected', $1, id
        FROM posts WHERE id = $2
      `, [reason || 'Your post was rejected by a moderator', id]);
    }

    res.json({
      success: true,
      post: result.rows[0],
      message: `Post ${action}d successfully`
    });
  } catch (error) {
    console.error('❌ Error moderating post:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error moderating post' 
    });
  }
});

// Feature/unfeature post
router.patch('/posts/:id/feature', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { featured } = req.body; // boolean

    const result = await pool.query(`
      UPDATE posts 
      SET is_featured = $1
      WHERE id = $2
      RETURNING id, is_featured
    `, [featured, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Post not found'
      });
    }

    res.json({
      success: true,
      post: result.rows[0],
      message: `Post ${featured ? 'featured' : 'unfeatured'} successfully`
    });
  } catch (error) {
    console.error('❌ Error featuring post:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error featuring post' 
    });
  }
});

// Pin/unpin post
router.patch('/posts/:id/pin', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { pinned } = req.body; // boolean

    const result = await pool.query(`
      UPDATE posts 
      SET is_pinned = $1
      WHERE id = $2
      RETURNING id, is_pinned
    `, [pinned, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Post not found'
      });
    }

    res.json({
      success: true,
      post: result.rows[0],
      message: `Post ${pinned ? 'pinned' : 'unpinned'} successfully`
    });
  } catch (error) {
    console.error('❌ Error pinning post:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error pinning post' 
    });
  }
});

// Eliminar post
router.delete('/posts/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    // Crear notificación al usuario antes de eliminar
    if (reason) {
      await pool.query(`
        INSERT INTO notifications (user_id, type, title, message, post_id)
        SELECT user_id, 'post_deleted', 'Post Deleted', $1, id
        FROM posts WHERE id = $2
      `, [reason, id]);
    }

    const result = await pool.query(`
      DELETE FROM posts WHERE id = $1 RETURNING id
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Post not found'
      });
    }

    res.json({
      success: true,
      message: 'Post deleted successfully'
    });
  } catch (error) {
    console.error('❌ Error deleting post:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error deleting post' 
    });
  }
});

// ========== REPORTS MANAGEMENT ==========

// Obtener reportes pendientes
router.get('/reports', requireAdmin, async (req, res) => {
  try {
    const { status = 'pending' } = req.query;
    
    const result = await pool.query(`
      SELECT 
        r.id, r.reason, r.description, r.status, r.created_at,
        r.post_id, r.comment_id,
        p.title as post_title,
        c.content as comment_content,
        u_reporter.full_name as reporter_name, u_reporter.email as reporter_email,
        u_author.full_name as author_name, u_author.email as author_email
      FROM reports r
      LEFT JOIN posts p ON r.post_id = p.id
      LEFT JOIN comments c ON r.comment_id = c.id
      LEFT JOIN users_extended u_reporter ON r.reporter_user_id = u_reporter.id
      LEFT JOIN users_extended u_author ON (
        CASE 
          WHEN r.post_id IS NOT NULL THEN p.user_id
          WHEN r.comment_id IS NOT NULL THEN c.user_id
        END
      ) = u_author.id
      WHERE r.status = $1
      ORDER BY r.created_at DESC
    `, [status]);

    res.json({
      success: true,
      reports: result.rows
    });
  } catch (error) {
    console.error('❌ Error fetching reports:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error loading reports' 
    });
  }
});

// Resolver reporte
router.patch('/reports/:id/resolve', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { action, reason } = req.body; // action: 'resolved' | 'dismissed'
    
    if (!['resolved', 'dismissed'].includes(action)) {
      return res.status(400).json({
        success: false,
        error: 'Action must be resolved or dismissed'
      });
    }

    const adminId = req.session?.user?.id || 1; // Fallback para testing

    const result = await pool.query(`
      UPDATE reports 
      SET status = $1, reviewed_by = $2, reviewed_at = NOW()
      WHERE id = $3
      RETURNING id, status, reviewed_at
    `, [action, adminId, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Report not found'
      });
    }

    res.json({
      success: true,
      report: result.rows[0],
      message: `Report ${action} successfully`
    });
  } catch (error) {
    console.error('❌ Error resolving report:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error resolving report' 
    });
  }
});

// ========== CATEGORIES MANAGEMENT ==========

// Crear nueva categoría
router.post('/categories', requireAdmin, async (req, res) => {
  try {
    const { name, description, color, icon, auto_approve = true, sort_order = 0 } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'Category name is required'
      });
    }

    const result = await pool.query(`
      INSERT INTO categories (name, description, color, icon, auto_approve, sort_order)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [name, description, color, icon, auto_approve, sort_order]);

    res.status(201).json({
      success: true,
      category: result.rows[0]
    });
  } catch (error) {
    console.error('❌ Error creating category:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error creating category' 
    });
  }
});

// Actualizar categoría
router.patch('/categories/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, color, icon, auto_approve, sort_order, is_active } = req.body;

    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramIndex}`);
      values.push(name);
      paramIndex++;
    }
    if (description !== undefined) {
      updates.push(`description = $${paramIndex}`);
      values.push(description);
      paramIndex++;
    }
    if (color !== undefined) {
      updates.push(`color = $${paramIndex}`);
      values.push(color);
      paramIndex++;
    }
    if (icon !== undefined) {
      updates.push(`icon = $${paramIndex}`);
      values.push(icon);
      paramIndex++;
    }
    if (auto_approve !== undefined) {
      updates.push(`auto_approve = $${paramIndex}`);
      values.push(auto_approve);
      paramIndex++;
    }
    if (sort_order !== undefined) {
      updates.push(`sort_order = $${paramIndex}`);
      values.push(sort_order);
      paramIndex++;
    }
    if (is_active !== undefined) {
      updates.push(`is_active = $${paramIndex}`);
      values.push(is_active);
      paramIndex++;
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No fields to update'
      });
    }

    values.push(id); // Add ID for WHERE clause
    const query = `UPDATE categories SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`;

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Category not found'
      });
    }

    res.json({
      success: true,
      category: result.rows[0]
    });
  } catch (error) {
    console.error('❌ Error updating category:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error updating category' 
    });
  }
});

// ========== COMMUNITY STATS ==========

// Obtener estadísticas de la comunidad
router.get('/stats', requireAdmin, async (req, res) => {
  try {
    const stats = await Promise.all([
      // Total posts por status
      pool.query(`
        SELECT status, COUNT(*) as count 
        FROM posts 
        GROUP BY status
      `),
      
      // Posts por categoría
      pool.query(`
        SELECT c.name, COUNT(p.id) as post_count
        FROM categories c
        LEFT JOIN posts p ON c.id = p.category_id
        GROUP BY c.id, c.name
        ORDER BY post_count DESC
      `),
      
      // Usuarios más activos
      pool.query(`
        SELECT u.full_name, u.email, COUNT(p.id) as post_count
        FROM users_extended u
        LEFT JOIN posts p ON u.id = p.user_id
        GROUP BY u.id, u.full_name, u.email
        ORDER BY post_count DESC
        LIMIT 10
      `),
      
      // Estadísticas generales
      pool.query(`
        SELECT 
          (SELECT COUNT(*) FROM posts) as total_posts,
          (SELECT COUNT(*) FROM posts WHERE status = 'pending') as pending_posts,
          (SELECT COUNT(*) FROM comments) as total_comments,
          (SELECT COUNT(*) FROM reactions) as total_reactions,
          (SELECT COUNT(*) FROM reports WHERE status = 'pending') as pending_reports
      `)
    ]);

    res.json({
      success: true,
      stats: {
        posts_by_status: stats[0].rows,
        posts_by_category: stats[1].rows,
        top_users: stats[2].rows,
        general: stats[3].rows[0]
      }
    });
  } catch (error) {
    console.error('❌ Error fetching community stats:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error loading stats' 
    });
  }
});

export default router;