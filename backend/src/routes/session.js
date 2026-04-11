const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const config = require('../config');
const { ensureEarlyAdopter } = require('../services/early-adopter');

const router = express.Router();

function generateNodeName() {
  const adjectives = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Neon', 'Cyber', 'Quantum', 'Solar', 'Lunar', 'Rapid', 'Swift', 'Secure'];
  const nouns = ['Node', 'Link', 'Gate', 'Core', 'Hub', 'Mesh', 'Net', 'Grid', 'Relay', 'Nexus'];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const num = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `${adj}-${noun}-${num}`;
}

// Créer une nouvelle session P2P
router.post('/create', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    if (!userId) {
        return res.status(401).json({ error: 'User ID missing from token' });
    }

    const ipAddressRaw = (req.headers['x-forwarded-for'] || '').split(',')[0] 
      || req.connection?.remoteAddress 
      || req.socket?.remoteAddress 
      || req.ip;
    const ipAddress = (ipAddressRaw || '').replace('::ffff:', '') || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';

    // Rôle utilisateur
    const roleRes = await db.query('SELECT role FROM users WHERE id = $1', [userId]);
    if (roleRes.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
    }
    const isAdmin = (roleRes.rows[0]?.role === 'admin');

    try {
      const banned = await db.query(
        'SELECT 1 FROM banned_ips WHERE ip_address = $1 LIMIT 1',
        [ipAddress]
      );
      if (banned.rows.length > 0) {
        return res.status(403).json({ error: 'IP bannie' });
      }
    } catch (e) {
        console.error('Banned IP check error:', e);
    }
    
    // Nettoyer les sessions périmées
    try {
        if (db.isSQLite) {
          await db.query(
            `UPDATE sessions
             SET end_time = CURRENT_TIMESTAMP, is_active = 0, status = 'expired'
             WHERE ip_address = $1 
               AND is_active = 1
               AND ((julianday('now') - julianday(COALESCE(last_ping, start_time))) * 86400) > 300`,
            [ipAddress]
          );
        } else if (db.isMySQL) {
          await db.query(
            `UPDATE sessions
             SET end_time = NOW(), is_active = false, status = 'expired'
             WHERE ip_address = $1 
               AND is_active = true
               AND TIMESTAMPDIFF(SECOND, COALESCE(last_ping, start_time), NOW()) > 300`,
            [ipAddress]
          );
        } else {
          // PostgreSQL fallback
          await db.query(
            `UPDATE sessions
             SET end_time = CURRENT_TIMESTAMP, is_active = false, status = 'expired'
             WHERE ip_address = $1 
               AND is_active = true
               AND (EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - COALESCE(last_ping, start_time))) > 300 OR COALESCE(last_ping, start_time) IS NULL)`,
            [ipAddress]
          );
        }
    } catch (cleanupErr) {
        console.error('Session cleanup error (non-fatal):', cleanupErr);
    }
    
    // Vérifier le nombre de sessions actives
    const activeSessionsResult = await db.query(
      `SELECT COUNT(*) as count
       FROM sessions
       WHERE user_id = $1 AND is_active = true`,
      [userId]
    );
    
    const activeSessions = parseInt(activeSessionsResult.rows[0]?.count || 0);
    
    // Créer la session
    const sessionToken = uuidv4();
    const nodeName = generateNodeName();
    
    const result = await db.query(
      `INSERT INTO sessions (user_id, session_token, ip_address, user_agent, name)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, session_token, start_time, name`,
      [userId, sessionToken, ipAddress, userAgent, nodeName]
    );
    
    if (result.rows.length === 0) {
        throw new Error('Failed to insert session');
    }

    const session = result.rows[0];

    try {
      await ensureEarlyAdopter(db, userId);
    } catch (eaErr) {
      console.error('Early Adopter logic error (non-fatal):', eaErr);
    }
    
    res.status(201).json({
      sessionId: session.id,
      sessionToken: session.session_token,
      startTime: session.start_time,
      name: session.name,
      isActive: true
    });
    
  } catch (error) {
    console.error('Full Create session error:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// Terminer une session
router.post('/end/:sessionId', authenticateToken, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user.userId;
    
    // Vérifier que la session appartient à l'utilisateur
    if (db.isMySQL) {
      await db.query(
        `UPDATE sessions
         SET end_time = NOW(), is_active = false
         WHERE id = $1 AND user_id = $2`,
        [sessionId, userId]
      );
    } else {
      await db.query(
        `UPDATE sessions
         SET end_time = CURRENT_TIMESTAMP, is_active = false
         WHERE id = $1 AND user_id = $2`,
        [sessionId, userId]
      );
    }
    
    res.json({ success: true, sessionId });
    
  } catch (error) {
    console.error('End session error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Obtenir les sessions actives de l'utilisateur
router.get('/active', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const result = await db.query(
      `SELECT id, session_token, start_time, last_ping, peers_connected
       FROM sessions
       WHERE user_id = $1 AND is_active = true
       ORDER BY start_time DESC`,
      [userId]
    );
    
    res.json({ sessions: result.rows });
    
  } catch (error) {
    console.error('Get active sessions error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Obtenir l'historique des sessions
router.get('/history', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    
    const result = await db.query(
      `SELECT 
        s.id,
        s.start_time,
        s.end_time,
        s.peers_connected,
        COALESCE(SUM(bl.bytes_sent), 0) as total_bytes_sent,
        COALESCE(SUM(bl.bytes_received), 0) as total_bytes_received,
        ${db.isMySQL ? 'TIMESTAMPDIFF(SECOND, s.start_time, COALESCE(s.end_time, NOW()))' : 'EXTRACT(EPOCH FROM (COALESCE(s.end_time, CURRENT_TIMESTAMP) - s.start_time))'} as duration_seconds
       FROM sessions s
       LEFT JOIN bandwidth_logs bl ON s.id = bl.session_id
       WHERE s.user_id = $1
       GROUP BY s.id
       ORDER BY s.start_time DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
    
    res.json({ sessions: result.rows });
    
  } catch (error) {
    console.error('Get session history error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
