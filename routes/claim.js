import express from 'express';
import pool from '../database/connection.js';
import { requireAuth, rateLimitClaims } from '../middleware/auth.js';
import { validateTokenCode } from '../utils/tokenGenerator.js';

const router = express.Router();

// Página de claim (GET)
router.get('/', (req, res) => {
  res.sendFile('claim.html', { root: 'public' });
});

// Procesar claim de token
router.post('/', requireAuth, async (req, res) => {
  const { code } = req.body;
  const userId = req.session.user?.id || req.session.userId;
  const userIp = req.ip || req.connection.remoteAddress || 'unknown';

  console.log(`🎫 Claim attempt: code="${code}", user=${userId}, ip=${userIp}`);

  if (!code) {
    return res.status(400).json({
      error: 'Code is required',
      message: 'Please enter the token code'
    });
  }

  if (!userId) {
    return res.status(401).json({
      error: 'You must log in or create an account to claim your item',
      message: 'Authentication required',
      redirect: '/login.html?redirect=/claim'
    });
  }

  // Normalizar y validar el código
  const { normalizeTokenCode, validateTokenCode } = await import('../utils/tokenGenerator.js');
  const normalizedCode = normalizeTokenCode(code);

  if (!normalizedCode || !validateTokenCode(normalizedCode)) {
    console.log(`❌ Invalid code format: "${code}" -> "${normalizedCode}"`);
    await logClaimAttempt(normalizedCode || code, userId, false, 'Invalid code format', userIp, req.get('User-Agent'));
    return res.status(400).json({
      error: 'Invalid code format',
      message: 'Invalid code. Please verify the format and try again.'
    });
  }

  console.log(`✅ Code normalized: "${code}" -> "${normalizedCode}"`);

  try {
    // Usar transacción para evitar condiciones de carrera
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Buscar token con SELECT FOR UPDATE para prevenir concurrencia
      const tokenResult = await client.query(
        'SELECT * FROM tokens WHERE token_code = $1 FOR UPDATE',
        [normalizedCode]
      );

      if (tokenResult.rows.length === 0) {
        await client.query('ROLLBACK');
        await logClaimAttempt(normalizedCode, userId, false, 'Token not found', userIp, req.get('User-Agent'));
        return res.status(404).json({ error: 'Token code not found' });
      }

      const token = tokenResult.rows[0];

      // Verificar si ya está reclamado
      if (token.status === 'claimed') {
        await client.query('ROLLBACK');
        await logClaimAttempt(normalizedCode, userId, false, 'Already claimed', userIp, req.get('User-Agent'));
        return res.status(409).json({ error: 'This code was already claimed' });
      }

      // Reclamar token
      const claimResult = await client.query(
        `UPDATE tokens
         SET status = 'claimed', owner_id = $1, claimed_at = NOW()
         WHERE token_code = $2
         RETURNING *`,
        [userId, normalizedCode]
      );

      await client.query('COMMIT');
      client.release();

      const claimedToken = claimResult.rows[0];

      // Log exitoso
      await logClaimAttempt(normalizedCode, userId, true, null, userIp, req.get('User-Agent'));

      console.log(`✅ Token claimed successfully: ${normalizedCode} by user ${userId}`);

      res.json({
        success: true,
        message: 'Token claimed successfully!',
        token: {
          code: claimedToken.token_code,
          product: claimedToken.product,
          drop_name: claimedToken.drop_name,
          variant: claimedToken.variant,
          serial: claimedToken.serial,
          size: claimedToken.size,
          color: claimedToken.color,
          claimed_at: claimedToken.claimed_at
        }
      });

    } catch (transactionError) {
      await client.query('ROLLBACK');
      client.release();
      throw transactionError;
    }

  } catch (error) {
    console.error('Claim error:', error);
    await logClaimAttempt(normalizedCode || code, userId, false, error.message, userIp, req.get('User-Agent'));
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Función auxiliar para logging
async function logClaimAttempt(tokenCode, userId, success, errorMessage, ipAddress, userAgent = 'unknown') {
  try {
    await pool.query(
      `INSERT INTO token_claims_log (token_code, user_id, success, error_message, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [tokenCode, userId, success, errorMessage, ipAddress, userAgent]
    );
  } catch (logError) {
    console.error('Error logging claim attempt:', logError);
  }
}

export default router;