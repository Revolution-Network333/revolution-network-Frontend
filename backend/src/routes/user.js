const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Avatar désactivé: suppression de l'upload côté backend

const crypto = require('crypto');

// Obtenir le profil utilisateur
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    let result = await db.query(
      `SELECT id, email, username, role, wallet_address, solana_address, profile_picture_url, total_points, trust_score, 
              created_at, last_login, referral_code, referrer_id, rank
       FROM users
       WHERE id = $1`,
      [userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Si pas de code de parrainage, en générer un maintenant
    if (!result.rows[0].referral_code) {
        const newReferralCode = crypto.randomBytes(4).toString('hex');
        await db.query('UPDATE users SET referral_code = $1 WHERE id = $2', [newReferralCode, userId]);
        result.rows[0].referral_code = newReferralCode;
    }
    
    res.json({ user: result.rows[0] });
    
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Modifier le code de parrainage
router.put('/referral-code', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { referralCode } = req.body;

    if (!referralCode || referralCode.length < 4 || referralCode.length > 20) {
      return res.status(400).json({ error: 'Le code doit faire entre 4 et 20 caractères' });
    }

    // Vérifier l'unicité
    const existing = await db.query('SELECT id FROM users WHERE referral_code = $1 AND id != $2', [referralCode, userId]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Ce code est déjà pris' });
    }

    await db.query('UPDATE users SET referral_code = $1 WHERE id = $2', [referralCode, userId]);
    res.json({ success: true, referralCode });
  } catch (error) {
    console.error('Update referral code error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Mettre à jour le profil utilisateur
router.put('/profile', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { username, solana_address } = req.body;

    // Validation basique
    if (!username) {
      return res.status(400).json({ error: 'Le nom d\'utilisateur est requis' });
    }
    if (solana_address && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(solana_address)) {
        return res.status(400).json({ error: 'Format d\'adresse Solana invalide' });
    }

    const result = await db.query(
      `UPDATE users 
       SET 
         username = $1, 
         solana_address = $2,
         updated_at = CURRENT_TIMESTAMP 
       WHERE id = $3
       RETURNING id, username, solana_address`,
      [username, solana_address, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    res.json({ success: true, user: result.rows[0] });

  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});


// Obtenir les statistiques de l'utilisateur
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    // Stats globales
    const userResult = await db.query('SELECT total_points, rank FROM users WHERE id = $1', [userId]);
    const totalPoints = userResult.rows[0]?.total_points || 0;
    const rank = userResult.rows[0]?.rank || 'Bronze';

    const statsResult = await db.query(
      `SELECT 
        COUNT(DISTINCT s.id) as total_sessions,
        COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(s.end_time, CURRENT_TIMESTAMP) - s.start_time))), 0) as total_time_seconds,
        COALESCE(SUM(bl.bytes_sent), 0) as total_bytes_sent,
        COALESCE(SUM(bl.bytes_received), 0) as total_bytes_received
       FROM sessions s
       LEFT JOIN bandwidth_logs bl ON s.id = bl.session_id
       WHERE s.user_id = $1`,
      [userId]
    );
    
    // Stats du jour
    // Fix: Calculate points separately to avoid session start time constraint
    const todayPointsResult = await db.query(
      `SELECT COALESCE(SUM(rl.amount), 0) as today_points
       FROM rewards_ledger rl
       WHERE rl.user_id = $1 AND rl.created_at::date = CURRENT_DATE`,
       [userId]
    );

    const todayStatsResult = await db.query(
      `SELECT 
        COUNT(DISTINCT s.id) as today_sessions,
        COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(s.end_time, CURRENT_TIMESTAMP) - s.start_time))), 0) as today_time_seconds,
        COALESCE(SUM(bl.bytes_sent), 0) as today_bytes_sent,
        COALESCE(SUM(bl.bytes_received), 0) as today_bytes_received
       FROM sessions s
       LEFT JOIN bandwidth_logs bl ON s.id = bl.session_id
       WHERE s.user_id = $1
       AND s.start_time::date = CURRENT_DATE`,
      [userId]
    );
    
    res.json({
      overall: { ...statsResult.rows[0], total_points: totalPoints, rank },
      today: { ...todayStatsResult.rows[0], today_points: todayPointsResult.rows[0].today_points },
    });
    
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Statistiques de parrainage pour l'utilisateur connecté
router.get('/referrals/stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    let totalReferrals = 0;
    let activeReferrals = 0;
    let referralBonusPoints = 0;

    try {
      const totalRes = await db.query(
        'SELECT COUNT(*) AS c FROM referrals WHERE referrer_user_id = $1',
        [userId]
      );
      totalReferrals = Number(totalRes.rows[0]?.c) || 0;
    } catch (_) {}

    try {
      const activeRes = await db.query(
        `SELECT COUNT(DISTINCT r.referred_user_id) AS c
         FROM referrals r
         JOIN users u ON u.id = r.referred_user_id
         WHERE r.referrer_user_id = $1
           AND COALESCE(u.is_banned, false) = false
           AND COALESCE(u.is_active, true) = true`,
        [userId]
      );
      activeReferrals = Number(activeRes.rows[0]?.c) || 0;
    } catch (_) {}

    try {
      const bonusRes = await db.query(
        "SELECT COALESCE(SUM(amount), 0) AS pts FROM rewards_ledger WHERE user_id = $1 AND reason = 'referral_bonus'",
        [userId]
      );
      referralBonusPoints = Number(bonusRes.rows[0]?.pts) || 0;
    } catch (_) {}

    res.json({
      totalReferrals,
      activeReferrals,
      referralBonusPoints,
    });
  } catch (error) {
    console.error('Get referral stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Obtenir le classement (leaderboard)
router.get('/leaderboard', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    
    const result = await db.query(
      `SELECT id, username, total_points
       FROM users
       WHERE is_banned = false AND is_active = true
       ORDER BY total_points DESC
       LIMIT $1`,
      [limit]
    );
    
    res.json({ leaderboard: result.rows });
    
  } catch (error) {
    console.error('Get leaderboard error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Boutique publique: items actifs
router.get('/shop/items', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, title, description, type, price, currency, metadata FROM shop_items WHERE active = true ORDER BY created_at DESC'
    );
    res.json({ items: result.rows });
  } catch (error) {
    console.error('Get shop items error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Mettre à jour l'adresse wallet (Ethereum ou Solana Phantom)
router.put('/wallet', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { walletAddress } = req.body;
    
    if (!walletAddress) {
      return res.status(400).json({ error: 'Wallet address required' });
    }
    
    // Validation basique: Ethereum (0x...) OU Solana (base58 32-44 chars)
    const isEth = /^0x[a-fA-F0-9]{40}$/.test(walletAddress);
    const isSolana = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(walletAddress);
    if (!isEth && !isSolana) {
      return res.status(400).json({ error: 'Invalid wallet address format (ETH or Solana Phantom)' });
    }
    
    await db.query(
      'UPDATE users SET wallet_address = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [walletAddress, userId]
    );
    
    res.json({ success: true, walletAddress });
    
  } catch (error) {
    console.error('Update wallet error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Obtenir les nœuds actifs (sessions)
router.get('/nodes', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await db.query(
      `SELECT s.id, s.name, s.ip_address, s.start_time, s.status,
              COALESCE(SUM(rl.amount), 0) as session_points
       FROM sessions s
       LEFT JOIN rewards_ledger rl ON s.id = rl.session_id
       WHERE s.user_id = $1 AND s.is_active = true
       GROUP BY s.id`,
      [userId]
    );

    // Format uptime
    const nodes = result.rows.map(node => {
        const startTime = new Date(node.start_time);
        const now = new Date();
        const diffMs = now - startTime;
        const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
        const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        
        return {
            id: node.id,
            name: node.name || 'Unknown Node',
            ip: node.ip_address,
            startTime: node.start_time,
            uptime: `${diffHrs}h ${diffMins}m`,
            points: node.session_points,
            status: node.status,
            location: 'Local' 
        };
    });

    res.json({ nodes });

  } catch (error) {
    console.error('Get nodes error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
