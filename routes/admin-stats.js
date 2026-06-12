import express from "express";
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Middleware para verificar admin
function requireAdmin(req, res, next) {
  if (!req.session?.user || req.session.user.email !== 'robert.manzanillag@gmail.com') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// 📊 Dashboard principal de estadísticas
router.get('/dashboard', requireAdmin, async (req, res) => {
  try {
    console.log('📊 Fetching admin dashboard stats...');

    // Estadísticas generales
    const totalUsersQuery = 'SELECT COUNT(*) as count FROM users_extended';
    const activeUsersQuery = `
      SELECT COUNT(DISTINCT user_email) as count 
      FROM user_sessions 
      WHERE start_time >= NOW() - INTERVAL '30 days'
    `;
    const totalSessionsQuery = 'SELECT COUNT(*) as count FROM user_sessions';
    const totalPageViewsQuery = 'SELECT COUNT(*) as count FROM page_views';
    const totalInteractionsQuery = 'SELECT COUNT(*) as count FROM user_interactions';

    const [totalUsers, activeUsers, totalSessions, totalPageViews, totalInteractions] = await Promise.all([
      pool.query(totalUsersQuery),
      pool.query(activeUsersQuery),
      pool.query(totalSessionsQuery),
      pool.query(totalPageViewsQuery),
      pool.query(totalInteractionsQuery)
    ]);

    // Top páginas más visitadas
    const topPagesQuery = `
      SELECT page_url, page_title, COUNT(*) as views,
             AVG(time_spent_seconds) as avg_time_spent
      FROM page_views 
      WHERE timestamp >= NOW() - INTERVAL '30 days'
      GROUP BY page_url, page_title
      ORDER BY views DESC
      LIMIT 10
    `;

    // Usuarios más activos
    const activeUsersDetailsQuery = `
      SELECT ue.email, ue.full_name, 
             COUNT(pv.id) as page_views,
             COUNT(DISTINCT us.session_id) as sessions,
             MAX(us.start_time) as last_activity
      FROM users_extended ue
      LEFT JOIN page_views pv ON ue.email = pv.user_email
      LEFT JOIN user_sessions us ON ue.email = us.user_email
      WHERE pv.timestamp >= NOW() - INTERVAL '30 days' 
         OR us.start_time >= NOW() - INTERVAL '30 days'
      GROUP BY ue.email, ue.full_name
      ORDER BY page_views DESC
      LIMIT 10
    `;

    // Actividad por día (últimos 7 días)
    const dailyActivityQuery = `
      SELECT DATE(timestamp) as date,
             COUNT(*) as page_views,
             COUNT(DISTINCT user_email) as unique_users
      FROM page_views
      WHERE timestamp >= NOW() - INTERVAL '7 days'
      GROUP BY DATE(timestamp)
      ORDER BY date DESC
    `;

    const [topPages, activeUsersDetails, dailyActivity] = await Promise.all([
      pool.query(topPagesQuery),
      pool.query(activeUsersDetailsQuery),
      pool.query(dailyActivityQuery)
    ]);

    const stats = {
      overview: {
        totalUsers: parseInt(totalUsers.rows[0].count),
        activeUsers: parseInt(activeUsers.rows[0].count),
        totalSessions: parseInt(totalSessions.rows[0].count),
        totalPageViews: parseInt(totalPageViews.rows[0].count),
        totalInteractions: parseInt(totalInteractions.rows[0].count)
      },
      topPages: topPages.rows,
      activeUsers: activeUsersDetails.rows,
      dailyActivity: dailyActivity.rows
    };

    console.log('✅ Admin dashboard stats fetched successfully');
    res.json(stats);
  } catch (error) {
    console.error('Error fetching admin dashboard:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard stats' });
  }
});

// 👥 Lista detallada de todos los usuarios
router.get('/users', requireAdmin, async (req, res) => {
  try {
    const query = `
      SELECT ue.email, ue.full_name, ue.phone, ue.city, ue.instagram, 
             ue.role, ue.registration_date, ue.last_login,
             ue.total_sessions, ue.total_page_views, ue.is_active,
             COUNT(DISTINCT us.id) as session_count,
             COUNT(DISTINCT pv.id) as page_view_count,
             COUNT(DISTINCT ui.id) as interaction_count,
             MAX(us.start_time) as last_session
      FROM users_extended ue
      LEFT JOIN user_sessions us ON ue.email = us.user_email
      LEFT JOIN page_views pv ON ue.email = pv.user_email
      LEFT JOIN user_interactions ui ON ue.email = ui.user_email
      GROUP BY ue.email, ue.full_name, ue.phone, ue.city, ue.instagram,
               ue.role, ue.registration_date, ue.last_login,
               ue.total_sessions, ue.total_page_views, ue.is_active
      ORDER BY ue.last_login DESC NULLS LAST
    `;

    const result = await pool.query(query);
    console.log(`📋 Fetched ${result.rows.length} users with detailed stats`);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching users list:', error);
    res.status(500).json({ error: 'Failed to fetch users list' });
  }
});

// 🔍 Detalles específicos de un usuario
router.get('/user/:email', requireAdmin, async (req, res) => {
  try {
    const { email } = req.params;
    
    // Información básica del usuario
    const userQuery = 'SELECT * FROM users_extended WHERE email = $1';
    
    // Sesiones recientes
    const sessionsQuery = `
      SELECT * FROM user_sessions 
      WHERE user_email = $1 
      ORDER BY start_time DESC 
      LIMIT 20
    `;
    
    // Páginas más visitadas por este usuario
    const pagesQuery = `
      SELECT page_url, page_title, COUNT(*) as visits,
             AVG(time_spent_seconds) as avg_time_spent,
             MAX(timestamp) as last_visit
      FROM page_views 
      WHERE user_email = $1 
      GROUP BY page_url, page_title
      ORDER BY visits DESC
      LIMIT 15
    `;
    
    // Interacciones recientes
    const interactionsQuery = `
      SELECT interaction_type, target_element, target_url,
             event_id, video_id, timestamp, additional_data
      FROM user_interactions 
      WHERE user_email = $1 
      ORDER BY timestamp DESC 
      LIMIT 50
    `;

    // Eventos que ha visto
    const eventsQuery = `
      SELECT event_id, event_name, interaction_type,
             time_spent_seconds, timestamp
      FROM event_interactions 
      WHERE user_email = $1 
      ORDER BY timestamp DESC 
      LIMIT 20
    `;

    const [user, sessions, pages, interactions, events] = await Promise.all([
      pool.query(userQuery, [email]),
      pool.query(sessionsQuery, [email]),
      pool.query(pagesQuery, [email]),
      pool.query(interactionsQuery, [email]),
      pool.query(eventsQuery, [email])
    ]);

    if (user.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userDetails = {
      user: user.rows[0],
      sessions: sessions.rows,
      topPages: pages.rows,
      recentInteractions: interactions.rows,
      eventInteractions: events.rows
    };

    console.log(`🔍 Fetched detailed info for user ${email}`);
    res.json(userDetails);
  } catch (error) {
    console.error('Error fetching user details:', error);
    res.status(500).json({ error: 'Failed to fetch user details' });
  }
});

// 📈 Estadísticas de eventos
router.get('/events-stats', requireAdmin, async (req, res) => {
  try {
    const query = `
      SELECT event_id, event_name, 
             COUNT(*) as total_interactions,
             COUNT(DISTINCT user_email) as unique_users,
             AVG(time_spent_seconds) as avg_time_spent,
             MAX(timestamp) as last_interaction
      FROM event_interactions
      GROUP BY event_id, event_name
      ORDER BY total_interactions DESC
    `;

    const result = await pool.query(query);
    console.log(`📈 Fetched stats for ${result.rows.length} events`);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching events stats:', error);
    res.status(500).json({ error: 'Failed to fetch events stats' });
  }
});

// 🌐 Estadísticas de navegación
router.get('/navigation-stats', requireAdmin, async (req, res) => {
  try {
    // Estadísticas de dispositivos
    const devicesQuery = `
      SELECT device_type, COUNT(*) as count,
             COUNT(DISTINCT user_email) as unique_users
      FROM page_views 
      WHERE device_type IS NOT NULL
      GROUP BY device_type
      ORDER BY count DESC
    `;

    // Estadísticas de navegadores
    const browsersQuery = `
      SELECT browser, COUNT(*) as count,
             COUNT(DISTINCT user_email) as unique_users
      FROM page_views 
      WHERE browser IS NOT NULL
      GROUP BY browser
      ORDER BY count DESC
    `;

    // Referrers principales
    const referrersQuery = `
      SELECT referrer_url, COUNT(*) as count
      FROM page_views 
      WHERE referrer_url IS NOT NULL AND referrer_url != ''
      GROUP BY referrer_url
      ORDER BY count DESC
      LIMIT 10
    `;

    const [devices, browsers, referrers] = await Promise.all([
      pool.query(devicesQuery),
      pool.query(browsersQuery),
      pool.query(referrersQuery)
    ]);

    const navigationStats = {
      devices: devices.rows,
      browsers: browsers.rows,
      referrers: referrers.rows
    };

    console.log('🌐 Navigation stats fetched successfully');
    res.json(navigationStats);
  } catch (error) {
    console.error('Error fetching navigation stats:', error);
    res.status(500).json({ error: 'Failed to fetch navigation stats' });
  }
});

export default router;