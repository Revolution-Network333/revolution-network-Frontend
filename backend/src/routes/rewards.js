const express = require('express');
const db = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Obtenir l'historique des récompenses
router.get('/history', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    
    const result = await db.query(
      `SELECT id, amount, reason, details, created_at
       FROM rewards_ledger
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
    
    res.json({ rewards: result.rows });
    
  } catch (error) {
    console.error('Get rewards history error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Obtenir le total des points
router.get('/total', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const result = await db.query(
      'SELECT total_points FROM users WHERE id = $1',
      [userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({ totalPoints: result.rows[0].total_points });
    
  } catch (error) {
    console.error('Get total points error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Obtenir les points du jour
router.get('/today', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const result = await db.query(
      `SELECT COALESCE(SUM(amount), 0) as today_points
       FROM rewards_ledger
       WHERE user_id = $1
       AND created_at >= CURRENT_DATE`,
      [userId]
    );
    
    res.json({ todayPoints: parseInt(result.rows[0].today_points) });
    
  } catch (error) {
    console.error('Get today points error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Obtenir les statistiques de récompenses par période
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const period = req.query.period || '7d'; // 7d, 30d, all
    
    let dateFilter = '';
    if (period === '7d') {
      dateFilter = "AND created_at >= CURRENT_DATE - INTERVAL '7 days'";
    } else if (period === '30d') {
      dateFilter = "AND created_at >= CURRENT_DATE - INTERVAL '30 days'";
    }
    
    const result = await db.query(
      `SELECT 
        DATE(created_at) as date,
        SUM(amount) as points,
        COUNT(*) as transactions
       FROM rewards_ledger
       WHERE user_id = $1
       ${dateFilter}
       GROUP BY DATE(created_at)
       ORDER BY date DESC`,
      [userId]
    );
    
    res.json({ stats: result.rows });
    
  } catch (error) {
    console.error('Get rewards stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Calendrier des récompenses et des nœuds
router.get('/calendar', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const granularity = (req.query.granularity || 'daily').toLowerCase();
    let pointsSql = '';
    let sessionsSql = '';
    if (db.isSQLite) {
      if (granularity === 'yearly') {
        pointsSql = `
          SELECT strftime('%Y', created_at) AS period, COALESCE(SUM(amount),0) AS points
          FROM rewards_ledger WHERE user_id = $1
          GROUP BY strftime('%Y', created_at) ORDER BY period DESC LIMIT 10`;
        sessionsSql = `
          SELECT strftime('%Y', start_time) AS period, COUNT(*) AS sessions
          FROM sessions WHERE user_id = $1
          GROUP BY strftime('%Y', start_time) ORDER BY period DESC LIMIT 10`;
      } else if (granularity === 'monthly') {
        pointsSql = `
          SELECT strftime('%Y-%m', created_at) AS period, COALESCE(SUM(amount),0) AS points
          FROM rewards_ledger WHERE user_id = $1
          GROUP BY strftime('%Y-%m', created_at) ORDER BY period DESC LIMIT 24`;
        sessionsSql = `
          SELECT strftime('%Y-%m', start_time) AS period, COUNT(*) AS sessions
          FROM sessions WHERE user_id = $1
          GROUP BY strftime('%Y-%m', start_time) ORDER BY period DESC LIMIT 24`;
      } else if (granularity === 'weekly') {
        pointsSql = `
          SELECT strftime('%Y-W%W', created_at) AS period, COALESCE(SUM(amount),0) AS points
          FROM rewards_ledger WHERE user_id = $1
          GROUP BY strftime('%Y-W%W', created_at) ORDER BY period DESC LIMIT 26`;
        sessionsSql = `
          SELECT strftime('%Y-W%W', start_time) AS period, COUNT(*) AS sessions
          FROM sessions WHERE user_id = $1
          GROUP BY strftime('%Y-W%W', start_time) ORDER BY period DESC LIMIT 26`;
      } else {
        pointsSql = `
          SELECT strftime('%Y-%m-%d', created_at) AS period, COALESCE(SUM(amount),0) AS points
          FROM rewards_ledger WHERE user_id = $1
          GROUP BY strftime('%Y-%m-%d', created_at) ORDER BY period DESC LIMIT 90`;
        sessionsSql = `
          SELECT strftime('%Y-%m-%d', start_time) AS period, COUNT(*) AS sessions
          FROM sessions WHERE user_id = $1
          GROUP BY strftime('%Y-%m-%d', start_time) ORDER BY period DESC LIMIT 90`;
      }
    } else {
      if (granularity === 'yearly') {
        pointsSql = `
          SELECT to_char(date_trunc('year', created_at), 'YYYY') AS period, COALESCE(SUM(amount),0) AS points
          FROM rewards_ledger WHERE user_id = $1
          GROUP BY date_trunc('year', created_at) ORDER BY period DESC LIMIT 10`;
        sessionsSql = `
          SELECT to_char(date_trunc('year', start_time), 'YYYY') AS period, COUNT(*) AS sessions
          FROM sessions WHERE user_id = $1
          GROUP BY date_trunc('year', start_time) ORDER BY period DESC LIMIT 10`;
      } else if (granularity === 'monthly') {
        pointsSql = `
          SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS period, COALESCE(SUM(amount),0) AS points
          FROM rewards_ledger WHERE user_id = $1
          GROUP BY date_trunc('month', created_at) ORDER BY period DESC LIMIT 24`;
        sessionsSql = `
          SELECT to_char(date_trunc('month', start_time), 'YYYY-MM') AS period, COUNT(*) AS sessions
          FROM sessions WHERE user_id = $1
          GROUP BY date_trunc('month', start_time) ORDER BY period DESC LIMIT 24`;
      } else if (granularity === 'weekly') {
        pointsSql = `
          SELECT to_char(date_trunc('week', created_at), 'IYYY-"W"IW') AS period, COALESCE(SUM(amount),0) AS points
          FROM rewards_ledger WHERE user_id = $1
          GROUP BY date_trunc('week', created_at) ORDER BY period DESC LIMIT 26`;
        sessionsSql = `
          SELECT to_char(date_trunc('week', start_time), 'IYYY-"W"IW') AS period, COUNT(*) AS sessions
          FROM sessions WHERE user_id = $1
          GROUP BY date_trunc('week', start_time) ORDER BY period DESC LIMIT 26`;
      } else {
        pointsSql = `
          SELECT to_char(created_at::date, 'YYYY-MM-DD') AS period, COALESCE(SUM(amount),0) AS points
          FROM rewards_ledger WHERE user_id = $1
          GROUP BY created_at::date ORDER BY period DESC LIMIT 90`;
        sessionsSql = `
          SELECT to_char(start_time::date, 'YYYY-MM-DD') AS period, COUNT(*) AS sessions
          FROM sessions WHERE user_id = $1
          GROUP BY start_time::date ORDER BY period DESC LIMIT 90`;
      }
    }
    const pointsRes = await db.query(pointsSql, [userId]);
    const sessionsRes = await db.query(sessionsSql, [userId]);
    res.json({ points: pointsRes.rows, nodes: sessionsRes.rows });
  } catch (e) {
    console.error('Calendar error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});
const crypto = require('crypto');

// ... (le reste du code existant)

// Route pour la preuve de travail
router.post('/proof-of-work', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { challenge, nonce, sessionId } = req.body;

        if (!challenge || nonce === undefined) {
            return res.status(400).json({ error: 'Challenge et nonce requis' });
        }

        // Vérifier la preuve de travail
        const hash = crypto.createHash('sha256').update(`${challenge}:${nonce}`).digest('hex');

        // Difficulté : le hash doit commencer par '0000'
        if (hash.startsWith('0000')) {
            let points = 1; // Attribuer 1 point pour une preuve valide
            try {
              const b = await db.query(
                `SELECT COALESCE(SUM(t.reward_airdrop_bonus_percent),0) AS bonus
                 FROM user_tasks ut JOIN tasks t ON ut.task_id = t.id
                 WHERE ut.user_id = $1 AND ut.status = 'approved'`,
                 [userId]
              );
              const bonus = Number(b.rows[0]?.bonus)||0;
              points = Math.max(1, Math.floor(points * (1 + (bonus/100))));
            } catch (_) {}
            await db.query(
                'INSERT INTO rewards_ledger (user_id, amount, reason, session_id) VALUES ($1, $2, $3, $4)',
                [userId, points, 'proof_of_work', sessionId || null]
            );
            
            // Mettre à jour le total des points de l'utilisateur
            await db.query(
                'UPDATE users SET total_points = total_points + $1 WHERE id = $2',
                [points, userId]
            );

            try {
              const ref = await db.query('SELECT referrer_id FROM users WHERE id = $1', [userId]);
              const referrerId = ref.rows[0]?.referrer_id || null;
              if (referrerId) {
                const bonus = Math.floor(points * 0.05);
                if (bonus > 0) {
                  await db.query(
                    'INSERT INTO rewards_ledger (user_id, amount, reason, details) VALUES ($1, $2, $3, $4)',
                    [referrerId, bonus, 'referral_bonus', JSON.stringify({ from_user_id: userId, source: 'pow' })]
                  );
                  await db.query('UPDATE users SET total_points = total_points + $1 WHERE id = $2', [bonus, referrerId]);
                  if (db.isSQLite) {
                    await db.query("UPDATE users SET rank = CASE WHEN COALESCE(rank,'Bronze') = 'Bronze' THEN 'Silver' ELSE COALESCE(rank,'Bronze') END WHERE id = $1", [referrerId]);
                  } else {
                    await db.query("UPDATE users SET rank = CASE WHEN COALESCE(rank,'Bronze') = 'Bronze' THEN 'Silver' ELSE COALESCE(rank,'Bronze') END WHERE id = $1", [referrerId]);
                  }
                }
              }
            } catch (_) {}

            res.json({ success: true, points_earned: points, hash });
        } else {
            res.status(400).json({ error: 'Preuve de travail invalide' });
        }
    } catch (error) {
        console.error('Proof of work error:', error);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

module.exports = router;
