const express = require('express');
const db = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Admin: réparation de schéma user_tasks (en cas d'ancien déploiement)
router.post('/admin/tasks/fix-schema', authenticateToken, async (req, res) => {
  try {
    // Tentative d'ALTER TABLE compatible PostgreSQL; ignorées pour SQLite
    try {
      await db.query(`ALTER TABLE IF EXISTS user_tasks ADD COLUMN IF NOT EXISTS timestamp_started TIMESTAMP`);
    } catch (_) {}
    try {
      await db.query(`ALTER TABLE IF EXISTS user_tasks ADD COLUMN IF NOT EXISTS timestamp_approved TIMESTAMP`);
    } catch (_) {}
    try {
      await db.query(`ALTER TABLE IF EXISTS user_tasks ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`);
    } catch (_) {}
    try {
      await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_user_tasks_unique ON user_tasks (user_id, task_id)`);
    } catch (_) {}
    res.json({ ok: true, repaired: true });
  } catch (e) {
    console.error('Fix schema error:', e);
    res.status(500).json({ error: 'Erreur lors de la réparation du schéma' });
  }
});

// Public: lister les tasks actives
router.get('/tasks', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, title, description, type, link_url, reward_points, reward_airdrop_bonus_percent
       FROM tasks
       WHERE active = 1 OR active = TRUE OR active = '1'
       ORDER BY created_at DESC`
    );
    res.json({ tasks: result.rows });
  } catch (e) {
    console.error('Public tasks error:', e);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

// Route spéciale pour la task Early Adopter (détection automatique)
router.get('/early-adopter/status', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const eaRes = await db.query('SELECT is_gold FROM early_adopters WHERE user_id = $1', [userId]);
    
    // Compter le nombre total de gold restants
    const countRes = await db.query('SELECT COUNT(*) as count FROM early_adopters WHERE is_gold = true');
    const currentCount = parseInt(countRes.rows[0]?.count || 0);
    
    res.json({
      isEarlyAdopter: eaRes.rows.length > 0,
      isGold: eaRes.rows[0]?.is_gold || false,
      spotsLeft: Math.max(0, 50 - currentCount)
    });
  } catch (e) {
    console.error('Early adopter status error:', e);
    res.status(500).json({ error: 'Erreur interne' });
  }
});

// Utilisateur: déclarer une task à valider (mise en file - usage unique)
router.post('/user/tasks/approve', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { taskId } = req.body || {};
    if (!taskId) return res.status(400).json({ error: 'taskId requis' });

    // Task doit exister et être active
    const activeClause = db.isSQLite ? 'active = 1' : 'active = TRUE';
    const t = await db.query(
      `SELECT id, reward_points, reward_airdrop_bonus_percent 
       FROM tasks WHERE id = $1 AND ${activeClause}`, 
      [parseInt(taskId)]
    );
    if (t.rows.length === 0) return res.status(404).json({ error: 'Task introuvable' });
    const rewardPoints = parseInt(t.rows[0].reward_points || 0);

    // Empêcher multiples enregistrements (usage unique)
    const existingAny = await db.query(
      `SELECT id, status FROM user_tasks WHERE user_id = $1 AND task_id = $2 ORDER BY created_at DESC LIMIT 1`,
      [userId, parseInt(taskId)]
    );
    if (existingAny.rows.length > 0) {
      const st = existingAny.rows[0].status;
      const tag = (st === 'approved') ? 'already_done' : 'already_pending';
      if (st !== 'approved' && rewardPoints > 0) {
        // Sécurise: crédit immédiat si pas encore approuvé
        await db.query('UPDATE user_tasks SET status = $1 WHERE id = $2', ['approved', existingAny.rows[0].id]);
        await db.query(
          `INSERT INTO rewards_ledger (user_id, amount, reason, details) 
           VALUES ($1, $2, $3, $4)`,
           [userId, rewardPoints, 'task', JSON.stringify({ task_id: parseInt(taskId) })]
        );
        await db.query('UPDATE users SET total_points = COALESCE(total_points, 0) + $1 WHERE id = $2', [rewardPoints, userId]);
        return res.json({ success: true, userTaskId: existingAny.rows[0].id, status: 'approved' });
      }
      return res.json({ success: true, userTaskId: existingAny.rows[0].id, status: tag });
    }

    // Insertion et validation immédiate côté utilisateur
    const ins = await db.query(
      `INSERT INTO user_tasks (user_id, task_id, status)
       VALUES ($1, $2, 'approved')
       RETURNING id`,
      [userId, parseInt(taskId)]
    );
    if (rewardPoints > 0) {
      await db.query(
        `INSERT INTO rewards_ledger (user_id, amount, reason, details) 
         VALUES ($1, $2, $3, $4)`,
         [userId, rewardPoints, 'task', JSON.stringify({ task_id: parseInt(taskId) })]
      );
      await db.query('UPDATE users SET total_points = COALESCE(total_points, 0) + $1 WHERE id = $2', [rewardPoints, userId]);
    }
    res.json({ success: true, userTaskId: ins.rows[0].id, status: 'approved' });
  } catch (e) {
    console.error('User task approve error:', e);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

// Utilisateur: récupérer le statut des tasks (pour affichage "Validée")
router.get('/user/tasks/status', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const r = await db.query(
      `SELECT task_id, status
       FROM user_tasks
       WHERE user_id = $1
       ORDER BY id DESC`,
      [userId]
    );
    const map = {};
    for (const row of r.rows) {
      const tid = row.task_id;
      if (!map[tid]) map[tid] = row.status;
    }
    const statuses = Object.entries(map).map(([taskId, status]) => ({
      taskId: parseInt(taskId),
      status
    }));
    res.json({ statuses });
  } catch (e) {
    console.error('User tasks status error:', e);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

// Bonus de minage cumulé via les tasks approuvées
router.get('/user/tasks/bonus', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const r = await db.query(
      `SELECT COALESCE(SUM(t.reward_airdrop_bonus_percent), 0) AS bonus
       FROM user_tasks ut
       JOIN tasks t ON ut.task_id = t.id
       WHERE ut.user_id = $1 AND ut.status = 'approved'`,
      [userId]
    );
    const bonusPercent = Number(r.rows[0]?.bonus) || 0;
    res.json({ bonusPercent });
  } catch (e) {
    console.error('User tasks bonus error:', e);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

module.exports = router;
