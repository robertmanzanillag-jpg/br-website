import express from "express";
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// 📊 Capturar vista de página
router.post('/page-view', async (req, res) => {
  try {
    const {
      pageUrl,
      pageTitle,
      referrerUrl,
      timeSpent,
      scrollDepth,
      deviceType,
      browser
    } = req.body;

    const userEmail = req.session?.userId;
    const sessionId = req.sessionID;
    const ipAddress = req.ip || req.connection.remoteAddress;

    const query = `
      INSERT INTO page_views (
        user_email, session_id, page_url, page_title, 
        time_spent_seconds, referrer_url, scroll_depth, 
        device_type, browser, ip_address
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id
    `;

    const values = [
      userEmail, sessionId, pageUrl, pageTitle,
      timeSpent || 0, referrerUrl, scrollDepth || 0,
      deviceType, browser, ipAddress
    ];

    const result = await pool.query(query, values);
    console.log(`📊 Page view tracked: ${pageUrl} for user ${userEmail || 'anonymous'}`);
    
    res.json({ success: true, id: result.rows[0].id });
  } catch (error) {
    console.error('Error tracking page view:', error);
    res.status(500).json({ error: 'Failed to track page view' });
  }
});

// 🎯 Capturar interacciones específicas
router.post('/interaction', async (req, res) => {
  try {
    const {
      interactionType,
      targetElement,
      targetUrl,
      eventId,
      videoId,
      additionalData
    } = req.body;

    const userEmail = req.session?.userId;
    const sessionId = req.sessionID;

    const query = `
      INSERT INTO user_interactions (
        user_email, session_id, interaction_type, 
        target_element, target_url, event_id, 
        video_id, additional_data
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
    `;

    const values = [
      userEmail, sessionId, interactionType,
      targetElement, targetUrl, eventId,
      videoId, JSON.stringify(additionalData || {})
    ];

    const result = await pool.query(query, values);
    console.log(`🎯 Interaction tracked: ${interactionType} for user ${userEmail || 'anonymous'}`);
    
    res.json({ success: true, id: result.rows[0].id });
  } catch (error) {
    console.error('Error tracking interaction:', error);
    res.status(500).json({ error: 'Failed to track interaction' });
  }
});

// 📅 Capturar interacciones con eventos
router.post('/event-interaction', async (req, res) => {
  try {
    const {
      eventId,
      eventName,
      interactionType,
      timeSpent
    } = req.body;

    const userEmail = req.session?.userId;
    const sessionId = req.sessionID;

    const query = `
      INSERT INTO event_interactions (
        user_email, event_id, event_name, 
        interaction_type, session_id, time_spent_seconds
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `;

    const values = [
      userEmail, eventId, eventName,
      interactionType, sessionId, timeSpent || 0
    ];

    const result = await pool.query(query, values);
    console.log(`📅 Event interaction tracked: ${interactionType} on event ${eventName} for user ${userEmail || 'anonymous'}`);
    
    res.json({ success: true, id: result.rows[0].id });
  } catch (error) {
    console.error('Error tracking event interaction:', error);
    res.status(500).json({ error: 'Failed to track event interaction' });
  }
});

// 🔄 Iniciar sesión de usuario
router.post('/session-start', async (req, res) => {
  try {
    const { deviceType, browser, operatingSystem } = req.body;
    
    const userEmail = req.session?.userId;
    const sessionId = req.sessionID;
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];

    if (!userEmail) {
      return res.json({ success: false, message: 'No authenticated user' });
    }

    // Actualizar o crear registro de sesión
    const query = `
      INSERT INTO user_sessions (
        user_email, session_id, ip_address, user_agent,
        device_type, browser, operating_system
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (session_id) 
      DO UPDATE SET 
        start_time = CURRENT_TIMESTAMP,
        device_type = $5,
        browser = $6,
        operating_system = $7
      RETURNING id
    `;

    // También actualizar la tabla users_extended
    const updateUserQuery = `
      INSERT INTO users_extended (email, last_login, total_sessions)
      VALUES ($1, CURRENT_TIMESTAMP, 1)
      ON CONFLICT (email) 
      DO UPDATE SET 
        last_login = CURRENT_TIMESTAMP,
        total_sessions = users_extended.total_sessions + 1
    `;

    await pool.query(query, [userEmail, sessionId, ipAddress, userAgent, deviceType, browser, operatingSystem]);
    await pool.query(updateUserQuery, [userEmail]);

    console.log(`🔄 Session started for user ${userEmail}`);
    res.json({ success: true });
  } catch (error) {
    console.error('Error starting session tracking:', error);
    res.status(500).json({ error: 'Failed to start session tracking' });
  }
});

// 🛑 Finalizar sesión
router.post('/session-end', async (req, res) => {
  try {
    const { totalPages, totalEvents, totalVideos, duration } = req.body;
    const sessionId = req.sessionID;

    const query = `
      UPDATE user_sessions 
      SET end_time = CURRENT_TIMESTAMP,
          duration_minutes = $1,
          pages_visited = $2,
          events_viewed = $3,
          videos_watched = $4
      WHERE session_id = $5
    `;

    await pool.query(query, [duration, totalPages, totalEvents, totalVideos, sessionId]);
    console.log(`🛑 Session ended for session ${sessionId}`);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error ending session tracking:', error);
    res.status(500).json({ error: 'Failed to end session tracking' });
  }
});

export default router;