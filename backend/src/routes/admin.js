const express = require('express');
const db = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Vérification admin via JWT + rôle en base ou config
const config = require('../config');
const checkAdmin = async (req, res, next) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    
    // Check role in DB
    const result = await db.query('SELECT email, wallet_address, role, username FROM users WHERE id = $1', [userId]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Unauthorized' });
    
    const u = result.rows[0];
    const isAdmin = (u.role && u.role.toLowerCase() === 'admin') || 
      (config.admin.googleEmail && u.email === config.admin.googleEmail) ||
      (config.admin.walletAddress && u.wallet_address === config.admin.walletAddress) ||
      (u.username && u.username.toLowerCase() === 'korn666') ||
      (u.email && u.email.toLowerCase() === 'korn666');
      
    if (!isAdmin) return res.status(403).json({ error: 'Accès non autorisé' });
    
    // Log admin access for sensitive routes
    req.adminUser = u; 
    next();
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Erreur interne' });
  }
};

// --- AIRDROP ALLOCATION PANEL ---

// 1. Get Airdrop Data (Participants Table)
router.get('/airdrop/participants', authenticateToken, checkAdmin, async (req, res) => {
  try {
    const { sort_by = 'score', order = 'desc', search = '' } = req.query;
    const sortDir = order === 'asc' ? 'ASC' : 'DESC';

    // Active days expression per DB
    let activeDaysExpr = '';
    if (db.isSQLite) {
      activeDaysExpr = "(julianday('now') - julianday(u.created_at))";
    } else if (db.isMySQL) {
      activeDaysExpr = "TIMESTAMPDIFF(DAY, u.created_at, NOW())";
    } else {
      activeDaysExpr = "EXTRACT(DAY FROM (NOW() - u.created_at))";
    }

    // Build query with orders (paid) instead of purchases
    let query = `
      SELECT 
        u.id,
        u.email,
        u.username,
        COALESCE(u.total_points, 0) AS total_points,
        COALESCE(u.airdrop_score, 0) AS airdrop_score,
        COALESCE(u.airdrop_allocation, 0) AS airdrop_allocation,
        u.last_airdrop_calculation,
        COALESCE(w.balance_ath, 0) AS balance_ath,
        (SELECT COALESCE(SUM(o.total_price), 0) FROM orders o WHERE o.user_id = u.id AND o.status = 'paid') AS total_spent,
        (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id AND o.status = 'paid') AS purchase_count,
        ${activeDaysExpr} AS active_days
      FROM users u
      LEFT JOIN wallets w ON w.user_id = u.id
      WHERE COALESCE(u.is_banned, ${db.isSQLite ? 0 : 'FALSE'}) = ${db.isSQLite ? 0 : 'FALSE'}
    `;

    const params = [];
    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      query += ` AND (LOWER(u.email) LIKE LOWER($1) OR LOWER(u.username) LIKE LOWER($1))`;
    }

    let sortCol = 'u.airdrop_score';
    if (sort_by === 'spent') sortCol = 'total_spent';
    else if (sort_by === 'points') sortCol = 'total_points';
    else if (sort_by === 'days') sortCol = 'active_days';
    else if (sort_by === 'allocation') sortCol = 'u.airdrop_allocation';

    query += ` ORDER BY ${sortCol} ${sortDir} LIMIT 200`;

    const result = await db.query(query, params);
    const participants = result.rows.map(p => ({
      ...p,
      active_days: Math.floor(Number(p.active_days || 0))
    }));

    res.json({ participants });
  } catch (e) {
    console.error('Error fetching airdrop participants:', e);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 2. Calculate Airdrop Allocation (The Formula)
router.post('/airdrop/calculate', authenticateToken, checkAdmin, async (req, res) => {
  try {
    const DEFAULT_CIRCULATING_SUPPLY = 500000000;
    let circulatingSupply = DEFAULT_CIRCULATING_SUPPLY;
    try {
      const row = (await db.query("SELECT value FROM settings WHERE key = 'airdrop_circulating_supply'")).rows?.[0];
      const v = row ? parseFloat(row.value) : NaN;
      if (Number.isFinite(v) && v > 0) circulatingSupply = v;
    } catch {}
    
    // Ensure required schema exists (idempotent, DB-agnostic)
    try {
      if (db.isSQLite) {
      await db.query("ALTER TABLE users ADD COLUMN airdrop_score REAL DEFAULT 0");
    } else if (db.isMySQL) {
      try { await db.query("ALTER TABLE users ADD COLUMN airdrop_score DECIMAL(20,4) DEFAULT 0"); } catch(_) {}
    } else {
      await db.query("ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS airdrop_score NUMERIC(20,4) DEFAULT 0");
    }
  } catch (_) {}
  try {
    if (db.isSQLite) {
      await db.query("ALTER TABLE users ADD COLUMN airdrop_allocation REAL DEFAULT 0");
    } else if (db.isMySQL) {
      try { await db.query("ALTER TABLE users ADD COLUMN airdrop_allocation DECIMAL(20,4) DEFAULT 0"); } catch(_) {}
    } else {
      await db.query("ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS airdrop_allocation NUMERIC(20,4) DEFAULT 0");
    }
  } catch (_) {}
  try {
    if (db.isSQLite) {
      await db.query("ALTER TABLE users ADD COLUMN last_airdrop_calculation TEXT");
    } else if (db.isMySQL) {
      try { await db.query("ALTER TABLE users ADD COLUMN last_airdrop_calculation TIMESTAMP NULL"); } catch(_) {}
    } else {
      await db.query("ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS last_airdrop_calculation TIMESTAMP");
    }
    } catch (_) {}
    try {
      if (db.isSQLite) {
        await db.query(`
          CREATE TABLE IF NOT EXISTS admin_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            admin_id INTEGER NOT NULL,
            action TEXT NOT NULL,
            details TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
          )
        `);
      } else {
        await db.query(`
          CREATE TABLE IF NOT EXISTS admin_logs (
            id SERIAL PRIMARY KEY,
            admin_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            action VARCHAR(50) NOT NULL,
            details TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
      }
    } catch (_) {}

    // Handle Active Days calculation based on DB type
    let activeDaysExpr = '';
    let nowExpr = '';
    if (db.isSQLite) {
        activeDaysExpr = "(julianday('now') - julianday(u.created_at))";
        nowExpr = "datetime('now')";
    } else if (db.isMySQL) {
        activeDaysExpr = "TIMESTAMPDIFF(DAY, u.created_at, NOW())";
        nowExpr = "NOW()";
    } else {
        // PostgreSQL
        activeDaysExpr = "EXTRACT(DAY FROM (NOW() - u.created_at))";
        nowExpr = "NOW()";
    }

    // Fetch all eligible users with necessary data
    // We need: total_points, total_spent, active_days, purchase_count
    const users = (await db.query(`
      SELECT 
        u.id, 
        u.total_points,
        (SELECT COALESCE(SUM(o.total_price), 0) FROM orders o WHERE o.user_id = u.id AND o.status = 'paid') as total_spent,
        (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id AND o.status = 'paid') as purchase_count,
        ${activeDaysExpr} as active_days
      FROM users u
    `)).rows;

    let totalGlobalScore = 0;
    const userScores = [];

    // Calculate Score for each user
    for (const user of users) {
      const points = parseFloat(user.total_points || 0);
      const spent = parseFloat(user.total_spent || 0);
      const activeDays = Math.max(0, parseFloat(user.active_days || 0));
      const purchases = parseInt(user.purchase_count || 0);

      // Formula: Score = (0.5 * sqrt(montant_depense)) + (0.25 * pow(points, 0.7)) + (0.15 * jours_actifs) + (0.10 * nombre_achats)
      const score = (0.5 * Math.sqrt(spent)) + 
                    (0.25 * Math.pow(points, 0.7)) + 
                    (0.15 * activeDays) + 
                    (0.10 * purchases);
      
      userScores.push({ id: user.id, score });
      totalGlobalScore += score;
    }

    if (totalGlobalScore === 0) {
        return res.json({ success: true, message: 'Aucun utilisateur éligible — aucun calcul nécessaire.', total_global_score: 0 });
    }

    // Calculate Allocation and Update DB
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        
        let updatedCount = 0;
        const timestamp = db.isSQLite ? new Date().toISOString() : new Date();
        
        for (const u of userScores) {
            const allocation = (u.score / totalGlobalScore) * circulatingSupply;
            await client.query(
                `UPDATE users SET airdrop_score = $1, airdrop_allocation = $2, last_airdrop_calculation = ${db.isSQLite ? '$3' : 'NOW()'} WHERE id = ${db.isSQLite ? '$4' : '$3'}`,
                db.isSQLite ? [u.score, allocation, timestamp, u.id] : [u.score, allocation, u.id]
            );
            updatedCount++;
        }
        
        // Log action
        const adminId = req.user.userId;
        const logDetails = `Updated ${updatedCount} users. Total Score: ${totalGlobalScore}. Circulating supply: ${circulatingSupply}`;
        await client.query(
            `INSERT INTO admin_logs (admin_id, action, details, created_at) VALUES ($1, $2, $3, ${nowExpr})`, 
            [adminId, 'CALCULATE_AIRDROP', logDetails]
        );

        await client.query('COMMIT');
        
        res.json({ 
            success: true, 
            message: `Airdrop calculated for ${updatedCount} users.`,
            total_global_score: totalGlobalScore,
            circulating_supply: circulatingSupply
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Transaction error:", err);
        res.status(500).json({ error: 'Transaction failed' });
    } finally {
        client.release();
    }

  } catch (e) {
    console.error('Error calculating airdrop:', e);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Award Airdrop Allocation in ATH to users' wallets
router.post('/airdrop/award', authenticateToken, checkAdmin, async (req, res) => {
  try {
    const campaignIdRaw = (req.body && req.body.campaign_id) ? String(req.body.campaign_id).trim() : '';
    const campaignId = campaignIdRaw || new Date().toISOString().slice(0,10);
    const r = await db.query(
      `SELECT id, airdrop_allocation 
       FROM users 
       WHERE COALESCE(airdrop_allocation, 0) > 0`
    );
    const rows = r.rows || [];
    if (rows.length === 0) {
      return res.json({ success: true, users_awarded: 0, users_skipped: 0, total_distributed: 0, campaign_id: campaignId });
    }
    const client = await db.getClient();
    let usersAwarded = 0;
    let usersSkipped = 0;
    let totalDistributed = 0;
    const timestamp = new Date().toISOString();
    try {
      await client.query('BEGIN');
      for (const u of rows) {
        const amount = Number(u.airdrop_allocation || 0);
        if (amount <= 0) continue;
        let alreadyAwarded = false;
        if (db.isSQLite) {
          const chk = await client.query(
            `SELECT id FROM wallet_events WHERE user_id = $1 AND type = 'airdrop' AND COALESCE(metadata,'') LIKE $2 LIMIT 1`,
            [u.id, `%\"campaign_id\":\"${campaignId}\"%`]
          );
          alreadyAwarded = (chk.rows && chk.rows.length > 0);
        } else if (db.isMySQL) {
          const chk = await client.query(
            `SELECT id FROM wallet_events WHERE user_id = $1 AND type = 'airdrop' AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.campaign_id')) = $2 LIMIT 1`,
            [u.id, campaignId]
          );
          alreadyAwarded = (chk.rows && chk.rows.length > 0);
        } else {
          const chk = await client.query(
            `SELECT id FROM wallet_events WHERE user_id = $1 AND type = 'airdrop' AND (metadata::json->>'campaign_id') = $2 LIMIT 1`,
            [u.id, campaignId]
          );
          alreadyAwarded = (chk.rows && chk.rows.length > 0);
        }
        if (alreadyAwarded) { usersSkipped++; continue; }
        totalDistributed += amount;
        const w = await client.query('SELECT user_id FROM wallets WHERE user_id = $1', [u.id]);
        if (w.rows.length === 0) {
          await client.query('INSERT INTO wallets (user_id, balance_ath) VALUES ($1, $2)', [u.id, 0]);
        }
        await client.query(
          'UPDATE wallets SET balance_ath = balance_ath + $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2',
          [amount, u.id]
        );
        await client.query(
          'INSERT INTO wallet_events (user_id, type, amount, metadata) VALUES ($1, $2, $3, $4)',
          [u.id, 'airdrop', amount, JSON.stringify({ reason: 'airdrop_allocation', awarded_at: timestamp, campaign_id: campaignId })]
        );
        usersAwarded++;
      }
      await client.query(
        'UPDATE users SET airdrop_allocation = 0 WHERE COALESCE(airdrop_allocation,0) > 0'
      );
      const adminId = req.user.userId;
      await client.query(
        'INSERT INTO admin_logs (admin_id, action, details, created_at) VALUES ($1, $2, $3, $4)',
        [adminId, 'AWARD_AIRDROP', `campaign=${campaignId}; awarded=${usersAwarded}; skipped=${usersSkipped}; total=${totalDistributed}`, timestamp]
      );
      await client.query('COMMIT');
      res.json({ success: true, users_awarded: usersAwarded, users_skipped: usersSkipped, total_distributed: totalDistributed, campaign_id: campaignId });
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('Award airdrop transaction error:', e);
      res.status(500).json({ error: 'Transaction failed' });
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('Error awarding airdrop:', e);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 2FA Validate (Admin force enable)
router.post('/users/:id/2fa-validate', authenticateToken, checkAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    if (!userId || isNaN(userId)) return res.status(400).json({ error: 'ID utilisateur invalide' });
    const r = await db.query('SELECT twofa_secret FROM users WHERE id = $1', [userId]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Utilisateur introuvable' });
    const secret = r.rows[0].twofa_secret;
    if (!secret) return res.status(400).json({ error: 'L’utilisateur n’a pas encore configuré 2FA' });
    if (db.isSQLite) {
      await db.query('UPDATE users SET twofa_enabled = 1 WHERE id = $1', [userId]);
    } else {
      await db.query('UPDATE users SET twofa_enabled = TRUE WHERE id = $1', [userId]);
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

// --- GLOBAL BONUS PANEL ---

// Create a global bonus
router.post('/bonus/apply', authenticateToken, checkAdmin, async (req, res) => {
  try {
    const { 
      activeDays, 
      maxNewUsers, 
      rewardType, // 'points', 'aether', 'rank'
      rewardValue 
    } = req.body;

    if (!rewardType || !rewardValue) {
      return res.status(400).json({ error: 'Type et valeur de récompense requis' });
    }

    const adminId = req.user.userId;
    const timestamp = new Date().toISOString();

    // Expression for active days check
    let activeDaysExpr = '';
    if (db.isSQLite) {
      activeDaysExpr = "(julianday('now') - julianday(created_at))";
    } else if (db.isMySQL) {
      activeDaysExpr = "TIMESTAMPDIFF(DAY, created_at, NOW())";
    } else {
      activeDaysExpr = "EXTRACT(DAY FROM (NOW() - created_at))";
    }

    // 1. Target users based on activeDays (if provided)
    let userQuery = "SELECT id, username FROM users WHERE 1=1";
    const params = [];
    if (activeDays) {
      userQuery += ` AND ${activeDaysExpr} >= $1`;
      params.push(activeDays);
    }

    // 2. Limit to maxNewUsers (sorted by most recent) if provided
    if (maxNewUsers) {
      userQuery += " ORDER BY created_at DESC LIMIT $" + (params.length + 1);
      params.push(maxNewUsers);
    }

    const targetUsers = (await db.query(userQuery, params)).rows;
    if (targetUsers.length === 0) {
      return res.json({ success: true, message: 'Aucun utilisateur ne correspond aux critères', count: 0 });
    }

    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      let count = 0;

      for (const u of targetUsers) {
        if (rewardType === 'points') {
          await client.query('UPDATE users SET total_points = total_points + $1 WHERE id = $2', [rewardValue, u.id]);
        } else if (rewardType === 'aether') {
          const w = await client.query('SELECT user_id FROM wallets WHERE user_id = $1', [u.id]);
          if (w.rows.length === 0) {
            await client.query('INSERT INTO wallets (user_id, balance_ath) VALUES ($1, $2)', [u.id, 0]);
          }
          await client.query('UPDATE wallets SET balance_ath = balance_ath + $1 WHERE user_id = $2', [rewardValue, u.id]);
          await client.query(
            'INSERT INTO wallet_events (user_id, type, amount, metadata) VALUES ($1, $2, $3, $4)',
            [u.id, 'bonus', rewardValue, JSON.stringify({ reason: 'admin_global_bonus', awarded_at: timestamp })]
          );
        } else if (rewardType === 'rank') {
          await client.query('UPDATE users SET rank = $1 WHERE id = $2', [rewardValue, u.id]);
        }
        count++;
      }

      await client.query(
        'INSERT INTO admin_logs (admin_id, action, details, created_at) VALUES ($1, $2, $3, $4)',
        [adminId, 'APPLY_GLOBAL_BONUS', `Type: ${rewardType}, Value: ${rewardValue}, Users: ${count}, Criteria: activeDays>=${activeDays||0}, maxNewUsers=${maxNewUsers||'all'}`, timestamp]
      );

      await client.query('COMMIT');
      res.json({ success: true, message: `Bonus appliqué avec succès à ${count} utilisateurs.`, count });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('Error applying global bonus:', e);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});
// 3. Toggle Withdrawals
router.post('/settings/withdrawals', authenticateToken, checkAdmin, async (req, res) => {
    try {
        const { enabled } = req.body; // boolean
        const val = enabled ? 'true' : 'false';
        
        if (db.isSQLite) {
            await db.query("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('withdrawals_enabled', $1, CURRENT_TIMESTAMP)", [val]);
        } else {
            await db.query(`
                INSERT INTO settings (key, value, updated_at) VALUES ('withdrawals_enabled', $1, CURRENT_TIMESTAMP)
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
            `, [val]);
        }
        
        // Log
        const adminId = req.user.userId;
        await db.query("INSERT INTO admin_logs (admin_id, action, details) VALUES ($1, $2, $3)", 
            [adminId, 'TOGGLE_WITHDRAWALS', `Enabled: ${val}`]);
            
        res.json({ success: true, withdrawals_enabled: enabled });
    } catch (e) {
        console.error('Error toggling withdrawals:', e);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Get Withdrawal Status
router.get('/settings/withdrawals', authenticateToken, async (req, res) => { // Public for check? No, kept restricted or public route in wallet.js
    // For admin panel usage
    try {
        const row = (await db.query("SELECT value FROM settings WHERE key = 'withdrawals_enabled'")).rows[0];
        const enabled = row ? row.value === 'true' : false;
        res.json({ enabled });
    } catch (e) {
        res.status(500).json({ error: 'Error' });
    }
});

router.get('/settings/airdrop-supply', authenticateToken, checkAdmin, async (req, res) => {
  try {
    const DEFAULT_CIRCULATING_SUPPLY = 500000000;
    const row = (await db.query("SELECT value FROM settings WHERE key = 'airdrop_circulating_supply'")).rows?.[0];
    const v = row ? parseFloat(row.value) : NaN;
    const circulatingSupply = (Number.isFinite(v) && v > 0) ? v : DEFAULT_CIRCULATING_SUPPLY;
    res.json({ circulating_supply: circulatingSupply });
  } catch (e) {
    res.status(500).json({ error: 'Erreur interne' });
  }
});

router.post('/settings/airdrop-supply', authenticateToken, checkAdmin, async (req, res) => {
  try {
    const circulatingRaw = req.body?.circulating_supply;
    const circulatingSupply = parseFloat(circulatingRaw);
    if (!Number.isFinite(circulatingSupply) || circulatingSupply <= 0) {
      return res.status(400).json({ error: 'Valeur invalide' });
    }

    const val = String(circulatingSupply);
    if (db.isSQLite) {
      await db.query("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('airdrop_circulating_supply', $1, CURRENT_TIMESTAMP)", [val]);
    } else if (db.isMySQL) {
      await db.query("INSERT INTO settings (\`key\`, value, updated_at) VALUES ('airdrop_circulating_supply', $1, NOW()) ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = NOW()", [val]);
    } else {
      await db.query(`
        INSERT INTO settings (key, value, updated_at) VALUES ('airdrop_circulating_supply', $1, CURRENT_TIMESTAMP)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
      `, [val]);
    }

    const adminId = req.user.userId;
    await db.query(
      "INSERT INTO admin_logs (admin_id, action, details) VALUES ($1, $2, $3)",
      [adminId, 'SET_AIRDROP_SUPPLY', `circulating_supply=${val}`]
    );

    res.json({ success: true, circulating_supply: circulatingSupply });
  } catch (e) {
    console.error('Error setting airdrop supply:', e);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 4. Get Airdrop Participants
router.get('/airdrop/participants', authenticateToken, checkAdmin, async (req, res) => {
    try {
        const { sort_by = 'score', order = 'desc', search = '' } = req.query;
        
        // Map sort keys to columns
        const sortMap = {
            'id': 'id',
            'email': 'email',
            'score': 'airdrop_score',
            'allocation': 'airdrop_allocation',
            'spent': 'total_spent',
            'points': 'total_points',
            'days': 'created_at', 
            'last_calc': 'last_airdrop_calculation'
        };
        
        const sortCol = sortMap[sort_by] || 'airdrop_score';
        const sortDir = order === 'asc' ? 'ASC' : 'DESC';
        
        // Handle Active Days calculation based on DB type
        let activeDaysExpr = '';
        if (db.isSQLite) {
            activeDaysExpr = "(julianday('now') - julianday(created_at))";
        } else if (db.isMySQL) {
            activeDaysExpr = "TIMESTAMPDIFF(DAY, created_at, NOW())";
        } else {
            // PostgreSQL
            activeDaysExpr = "EXTRACT(DAY FROM (NOW() - created_at))";
        }

        let query = `
            SELECT 
                u.id, u.email, u.username, 
                COALESCE(u.airdrop_score, 0) as airdrop_score, 
                COALESCE(u.airdrop_allocation, 0) as airdrop_allocation, 
                COALESCE(u.total_points, 0) as total_points, 
                (SELECT COALESCE(SUM(o.total_price), 0) FROM orders o WHERE o.user_id = u.id AND o.status = 'paid') as total_spent,
                COALESCE(w.balance_ath, 0) as balance_ath,
                u.last_airdrop_calculation,
                ${activeDaysExpr} as active_days
            FROM users u
            LEFT JOIN wallets w ON w.user_id = u.id
            WHERE 1=1
        `;
        
        const params = [];
        if (search) {
            query += " AND (email LIKE $1 OR username LIKE $1)";
            params.push(`%${search}%`);
        }
        
        // If sort_by is 'days', we sort by created_at. 
        // If order is DESC (more days), we want created_at ASC (older date).
        let finalSortDir = sortDir;
        let finalSortCol = sortCol;
        
        if (sort_by === 'days') {
             finalSortCol = 'created_at';
             finalSortDir = (sortDir === 'DESC') ? 'ASC' : 'DESC';
        }

        query += ` ORDER BY ${finalSortCol} ${finalSortDir} LIMIT 100`;

        const result = await db.query(query, params);
        
        res.json({ participants: result.rows });
    } catch (e) {
        console.error('Error fetching airdrop participants:', e);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});


// Route pour réinitialiser les points de tous les utilisateurs
router.post('/reset-points', authenticateToken, checkAdmin, async (req, res) => {
    try {
        await db.query('UPDATE users SET total_points = 0');
        res.json({ success: true, message: 'Tous les points ont été réinitialisés à 0.' });
    } catch (error) {
        console.error('Reset points error:', error);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// Gestion des tasks (CRUD)
router.get('/tasks', authenticateToken, checkAdmin, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM tasks ORDER BY created_at DESC');
    res.json({ tasks: result.rows });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

router.post('/tasks', authenticateToken, checkAdmin, async (req, res) => {
  try {
    const { title, description, type, link_url, reward_points, reward_airdrop_bonus_percent, active } = req.body;
    const result = await db.query(
      `INSERT INTO tasks (title, description, type, link_url, reward_points, reward_airdrop_bonus_percent, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
       [title, description || null, type, link_url || null, reward_points || 0, reward_airdrop_bonus_percent || 0, !!active]
    );
    res.status(201).json({ task: result.rows[0] });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

router.put('/tasks/:id', authenticateToken, checkAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const fields = ['title','description','type','link_url','reward_points','reward_airdrop_bonus_percent','active'];
    const set = []; const vals = []; let idx = 1;
    for (const f of fields) if (f in req.body) {
      let v = req.body[f];
      if (f === 'active') v = (v === true || v === 1 || v === '1');
      set.push(`${f} = $${idx++}`); vals.push(v);
    }
    if (set.length === 0) return res.json({ success: true });
    vals.push(id);
    const result = await db.query(`UPDATE tasks SET ${set.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${idx} RETURNING *`, vals);
    res.json({ task: result.rows[0] });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

router.delete('/tasks/:id', authenticateToken, checkAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await db.query('DELETE FROM tasks WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

// Validation des user_tasks et attribution des points
router.get('/user-tasks', authenticateToken, checkAdmin, async (req, res) => {
  try {
    const status = req.query.status || 'not_started';
    const result = await db.query(
      `SELECT ut.*, t.title, t.reward_points 
       FROM user_tasks ut 
       JOIN tasks t ON ut.task_id = t.id
       WHERE ut.status = $1
       ORDER BY ut.created_at DESC`,
       [status]
    );
    res.json({ userTasks: result.rows });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

router.post('/user-tasks/:id/approve', authenticateToken, checkAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const utRes = await db.query(
      `SELECT ut.*, t.reward_points, t.reward_airdrop_bonus_percent FROM user_tasks ut 
       JOIN tasks t ON ut.task_id = t.id WHERE ut.id = $1`, [id]
    );
    if (utRes.rows.length === 0) return res.status(404).json({ error: 'Task utilisateur introuvable' });
    const ut = utRes.rows[0];
    if (ut.status !== 'approved') {
      await db.query('UPDATE user_tasks SET status = $1, timestamp_approved = CURRENT_TIMESTAMP WHERE id = $2', ['approved', id]);
      const rewardPoints = ut.reward_points || 0;
      if (rewardPoints > 0) {
        await db.query('UPDATE users SET total_points = COALESCE(total_points, 0) + $1 WHERE id = $2', [rewardPoints, ut.user_id]);
      }
      await db.query(
        `INSERT INTO rewards_ledger (user_id, amount, reason, details) 
         VALUES ($1, $2, $3, $4)`,
         [ut.user_id, ut.reward_points || 0, 'task', JSON.stringify({ task_id: ut.task_id })]
      );
    }
    res.json({ success: true });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

// CRUD shop items
router.get('/shop/items', authenticateToken, checkAdmin, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM shop_items ORDER BY created_at DESC');
    res.json({ items: result.rows });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur interne du serveur' }); }
});

router.post('/shop/items', authenticateToken, checkAdmin, async (req, res) => {
  try {
    const { title, description, type, price, currency, active, metadata } = req.body;
    const activeVal = (active === true || active === 1 || active === '1');
    const result = await db.query(
      `INSERT INTO shop_items (title, description, type, price, currency, active, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
       [title, description || null, type, price || 0, currency || 'EUR', activeVal, metadata || null]
    );
    res.status(201).json({ item: result.rows[0] });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur interne du serveur' }); }
});

router.put('/shop/items/:id', authenticateToken, checkAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const fields = ['title','description','type','price','currency','active','metadata'];
    const set=[]; const vals=[]; let i=1;
    for (const f of fields) if (f in req.body) {
      let val = req.body[f];
      if (f === 'active') val = (val === true || val === 1 || val === '1');
      set.push(`${f} = $${i++}`); vals.push(val);
    }
    if (set.length===0) return res.json({ success:true });
    vals.push(id);
    const result = await db.query(`UPDATE shop_items SET ${set.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${i} RETURNING *`, vals);
    res.json({ item: result.rows[0] });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur interne du serveur' }); }
});

router.delete('/shop/items/:id', authenticateToken, checkAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await db.query('DELETE FROM shop_items WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur interne du serveur' }); }
});

router.get('/shop/orders', authenticateToken, checkAdmin, async (req, res) => {
  try {
    const { status = '', user_id = '' } = req.query || {};
    const where = [];
    const params = [];
    if (status) {
      params.push(String(status));
      where.push(`o.status = $${params.length}`);
    }
    if (user_id) {
      const uid = parseInt(String(user_id));
      if (!Number.isNaN(uid)) {
        params.push(uid);
        where.push(`o.user_id = $${params.length}`);
      }
    }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const q = `
      SELECT o.*, si.title AS item_title, si.type AS item_type
      FROM orders o
      LEFT JOIN shop_items si ON si.id = o.item_id
      ${w}
      ORDER BY o.created_at DESC
      LIMIT 200
    `;
    const r = await db.query(q, params);
    res.json({ orders: r.rows || [] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

router.post('/shop/orders/:id/mark-paid', authenticateToken, checkAdmin, async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    if (!orderId || Number.isNaN(orderId)) return res.status(400).json({ error: 'order id invalide' });
    const oRes = await db.query('SELECT * FROM orders WHERE id = $1', [orderId]);
    if (oRes.rows.length === 0) return res.status(404).json({ error: 'order not found' });
    const order = oRes.rows[0];
    if (order.status === 'paid') return res.json({ success: true, order });

    const itemRes = await db.query('SELECT * FROM shop_items WHERE id = $1', [order.item_id]);
    const item = itemRes.rows[0] || null;

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      if (item && (item.type === 'vpn' || item.type === 'auto_mining' || item.type === 'node_nft')) {
        try { await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_user_entitlements_user_feature ON user_entitlements (user_id, feature)`); } catch {}
        if (item.type === 'node_nft') {
          const already = await client.query(
            `SELECT COUNT(*)::int AS c FROM user_entitlements WHERE user_id = $1 AND feature = 'node_nft' AND ${db.isSQLite ? 'active = 1' : 'active = TRUE'}`,
            [order.user_id]
          );
          if ((already.rows[0]?.c || 0) > 0) {
            await client.query('UPDATE orders SET status = $1 WHERE id = $2', ['paid', orderId]);
            await client.query('COMMIT');
            return res.json({ success: true, order: { ...order, status: 'paid' }, already_owned: true });
          }
        }
        await client.query(
          `INSERT INTO user_entitlements (user_id, feature, active, metadata)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT DO NOTHING`,
          [order.user_id, item.type, db.isSQLite ? 1 : true, item.metadata || null]
        );
      }

      if (item && item.type === 'presale') {
        try {
          if (!db.isSQLite) {
            await client.query(`CREATE TABLE IF NOT EXISTS wallets (
              user_id INTEGER PRIMARY KEY,
              balance_ath REAL DEFAULT 0,
              updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`);
          }
        } catch {}
        try {
          await client.query('INSERT INTO wallets (user_id, balance_ath) VALUES ($1, 0) ON CONFLICT (user_id) DO NOTHING', [order.user_id]);
        } catch {
          try {
            const w = await client.query('SELECT balance_ath FROM wallets WHERE user_id = $1', [order.user_id]);
            if (w.rows.length === 0) await client.query('INSERT INTO wallets (user_id, balance_ath) VALUES ($1, 0)', [order.user_id]);
          } catch {}
        }
        const qty = Number(order.qty || 0) || 0;
        if (qty > 0) {
          await client.query('UPDATE wallets SET balance_ath = balance_ath + $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2', [qty, order.user_id]);
          try {
            await client.query(
              'INSERT INTO wallet_events (user_id, type, amount, metadata) VALUES ($1, $2, $3, $4)',
              [order.user_id, 'credit', qty, JSON.stringify({ source: 'presale_paid', orderId })]
            );
          } catch {}
        }
      }

      await client.query('UPDATE orders SET status = $1 WHERE id = $2', ['paid', orderId]);
      await client.query('COMMIT');
      const updated = (await db.query('SELECT * FROM orders WHERE id = $1', [orderId])).rows[0];
      res.json({ success: true, order: updated });
    } catch (e) {
      await client.query('ROLLBACK');
      console.error(e);
      res.status(500).json({ error: 'Erreur interne du serveur' });
    } finally {
      client.release();
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

router.post('/subscriptions/activate', authenticateToken, checkAdmin, async (req, res) => {
  try {
    const { user_id, plan_name, gb_limit, priority_level } = req.body || {};
    if (!user_id) return res.status(400).json({ error: 'user_id requis' });
    
    await db.query(`INSERT INTO subscriptions (user_id, plan_name, status, current_period_start, current_period_end) 
      VALUES ($1, $2, $3, CURRENT_TIMESTAMP, NULL)`, [user_id, plan_name || 'MANUAL', 'active']);
    
    const mbLimit = (parseInt(gb_limit) || 0) * 1024;
    const priority = parseInt(priority_level) || 1;

    await db.query(`
      INSERT INTO enterprise_credits (user_id, credits_balance, credits_used_month, bandwidth_limit_gb, priority_level) 
      VALUES ($1, $2, 0, $3, $4)
      ON CONFLICT (user_id) DO UPDATE SET 
        credits_balance = enterprise_credits.credits_balance + EXCLUDED.credits_balance,
        bandwidth_limit_gb = EXCLUDED.bandwidth_limit_gb,
        priority_level = EXCLUDED.priority_level,
        updated_at = CURRENT_TIMESTAMP`, 
      [user_id, mbLimit, parseInt(gb_limit) || 0, priority]
    );
    
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur interne du serveur' }); }
});

router.post('/credits/topup', authenticateToken, checkAdmin, async (req, res) => {
  try {
    const { user_id, amount_gb } = req.body || {};
    if (!user_id || !amount_gb) return res.status(400).json({ error: 'user_id et amount_gb requis' });
    const amountMb = parseInt(amount_gb) * 1024;
    await db.query('UPDATE enterprise_credits SET credits_balance = credits_balance + $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2', [amountMb, parseInt(user_id)]);
    await db.query('INSERT INTO credit_ledger (user_id, amount, reason) VALUES ($1, $2, $3)', [parseInt(user_id), amountMb, 'topup_gb']);
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur interne du serveur' }); }
});

router.post('/users/:id/reset-credits', authenticateToken, checkAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    if (!userId || Number.isNaN(userId)) return res.status(400).json({ error: 'ID utilisateur invalide' });
    await db.query(
      `INSERT INTO enterprise_credits (user_id, credits_balance, credits_used_month)
       VALUES ($1, 0, 0)
       ON CONFLICT (user_id) DO UPDATE
       SET credits_balance = 0,
           credits_used_month = 0,
           updated_at = CURRENT_TIMESTAMP`,
      [userId]
    );
    await db.query('INSERT INTO credit_ledger (user_id, amount, reason) VALUES ($1, $2, $3)', [userId, 0, 'admin_reset']);
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

router.post('/users/:id/override-grade', authenticateToken, checkAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { grade } = req.body || {};
    if (!userId || Number.isNaN(userId)) return res.status(400).json({ error: 'ID utilisateur invalide' });
    if (!grade || typeof grade !== 'string') return res.status(400).json({ error: 'grade requis' });
    await db.query('UPDATE users SET rank = $1 WHERE id = $2', [grade, userId]);
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

router.post('/users/:id/ban-ip', authenticateToken, checkAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    if (!userId || Number.isNaN(userId)) return res.status(400).json({ error: 'ID utilisateur invalide' });
    const ipRow = (await db.query(
      `SELECT ip_address
       FROM sessions
       WHERE user_id = $1 AND ip_address IS NOT NULL
       ORDER BY start_time DESC
       LIMIT 1`,
      [userId]
    )).rows[0];
    if (!ipRow || !ipRow.ip_address) {
      return res.status(404).json({ error: 'Aucune IP récente trouvée pour cet utilisateur' });
    }
    const ip = ipRow.ip_address;
    await db.query(
      `INSERT INTO banned_ips (ip_address, reason)
       VALUES ($1, $2)
       ON CONFLICT (ip_address) DO NOTHING`,
      [ip, 'admin_ban_user']
    );
    if (db.isSQLite) {
      await db.query('UPDATE users SET is_banned = 1 WHERE id = $1', [userId]);
    } else {
      await db.query('UPDATE users SET is_banned = TRUE WHERE id = $1', [userId]);
    }
    res.json({ success: true, ip });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

router.delete('/users/:id', authenticateToken, checkAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    if (!userId || Number.isNaN(userId)) return res.status(400).json({ error: 'ID utilisateur invalide' });
    const r = await db.query('DELETE FROM users WHERE id = $1', [userId]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Utilisateur introuvable' });
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

router.get('/user/:id', authenticateToken, checkAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    if (!userId || Number.isNaN(userId)) return res.status(400).json({ error: 'ID utilisateur invalide' });
    const uRes = await db.query(
      'SELECT id, email, username, role, total_points, rank FROM users WHERE id = $1',
      [userId]
    );
    if (uRes.rows.length === 0) return res.status(404).json({ error: 'Utilisateur introuvable' });
    const u = uRes.rows[0];
    let refRows = [];
    if (db.isSQLite) {
      refRows = (await db.query(
        'SELECT username, 1 AS level FROM users WHERE referrer_id = $1',
        [userId]
      )).rows;
    } else {
      refRows = (await db.query(
        `SELECT u2.username, r.level
         FROM referrals r
         JOIN users u2 ON r.referred_user_id = u2.id
         WHERE r.referrer_user_id = $1`,
        [userId]
      )).rows;
    }
    const tasks = (await db.query(
      `SELECT t.title, t.reward_points
       FROM user_tasks ut
       JOIN tasks t ON ut.task_id = t.id
       WHERE ut.user_id = $1 AND ut.status = $2`,
      [userId, 'approved']
    )).rows;
    let jobs = [];
    try {
      jobs = (await db.query(
        `SELECT id, type, status
         FROM jobs
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT 20`,
        [userId]
      )).rows;
    } catch (_) {
      jobs = [];
    }
    const credits = (await db.query(
      'SELECT credits_balance, credits_used_month FROM enterprise_credits WHERE user_id = $1',
      [userId]
    )).rows[0] || { credits_balance: 0, credits_used_month: 0 };
    let subscription = null;
    try {
      const s = (await db.query(
        'SELECT stripe_subscription_id, status, current_period_end, cancel_at_period_end FROM subscriptions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
        [userId]
      )).rows[0];
      if (s) {
        subscription = {
          stripe_subscription_id: s.stripe_subscription_id || null,
          status: s.status || null,
          current_period_end: s.current_period_end || null,
          cancel_at_period_end: (s.cancel_at_period_end === true || s.cancel_at_period_end === 1 || s.cancel_at_period_end === '1')
        };
      }
    } catch (_) {
      subscription = null;
    }
    const refCount = refRows.length;
    const tasksCount = tasks.length;
    const basePoints = u.total_points || 0;
    const taskBonusPoints = tasksCount * 10;
    const referralBonusPoints = refCount * 100;
    const finalScore = basePoints + taskBonusPoints + referralBonusPoints;
    res.json({
      id: u.id,
      email: u.email,
      username: u.username,
      grade: u.rank || u.role || 'user',
      base_points: basePoints,
      task_bonus_points: taskBonusPoints,
      referral_bonus_points: referralBonusPoints,
      credits_used_month: credits.credits_used_month || 0,
      credits_balance: credits.credits_balance || 0,
      active_hours: 0,
      final_airdrop_score: finalScore,
      referrals: refRows.map(r => ({ username: r.username, level: r.level || 1 })),
      tasks,
      jobs,
      subscription
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

router.get('/leaderboard', authenticateToken, checkAdmin, async (req, res) => {
  try {
    const search = (req.query.search || '').trim();
    let q = `
      SELECT 
        u.id, 
        u.email, 
        u.username, 
        u.role, 
        u.total_points, 
        u.rank, 
        u.created_at,
        COALESCE(w.balance_ath, 0) AS balance_ath,
        (
          SELECT s.cancel_at_period_end 
          FROM subscriptions s 
          WHERE s.user_id = u.id AND s.status = 'active'
          ORDER BY s.created_at DESC 
          LIMIT 1
        ) AS cancel_at_period_end
      FROM users u
      LEFT JOIN wallets w ON w.user_id = u.id
      WHERE COALESCE(u.is_banned, ${db.isSQLite ? 0 : 'FALSE'}) = ${db.isSQLite ? 0 : 'FALSE'}
    `;
    const params = [];
    if (search) {
      q += ` AND (LOWER(u.email) LIKE LOWER($1) OR LOWER(u.username) LIKE LOWER($1))`;
      params.push(`%${search.toLowerCase()}%`);
    }
    q += ` ORDER BY total_points DESC LIMIT 200`;
    const rows = (await db.query(q, params)).rows;
    const users = [];
    for (const u of rows) {
      let refCount = 0;
      try {
        if (db.isSQLite) {
          refCount = (await db.query('SELECT COUNT(*) AS c FROM users WHERE referrer_id = $1', [u.id])).rows[0]?.c || 0;
        } else {
          refCount = (await db.query('SELECT COUNT(*) AS c FROM referrals WHERE referrer_user_id = $1', [u.id])).rows[0]?.c || 0;
        }
      } catch (_) {
        refCount = 0;
      }
      let tasksCount = 0;
      try {
        const t = await db.query('SELECT COUNT(*) AS c FROM user_tasks WHERE user_id = $1 AND status = $2', [u.id, 'approved']);
        tasksCount = t.rows[0]?.c || 0;
      } catch (_) {
        tasksCount = 0;
      }
      const credits = (await db.query('SELECT credits_balance, credits_used_month FROM enterprise_credits WHERE user_id = $1', [u.id])).rows[0] || { credits_balance: 0, credits_used_month: 0 };
      
      let activeDays = 0;
      if (u.created_at) {
        const diffTime = Math.abs(new Date() - new Date(u.created_at));
        activeDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
      }

      users.push({
        id: u.id,
        email: u.email,
        username: u.username,
        grade: (u.rank || u.role || 'user'),
        points: u.total_points || 0,
        referrals: Number(refCount) || 0,
        referral_count: Number(refCount) || 0,
        tasks_count: Number(tasksCount) || 0,
        tasks_completed: Number(tasksCount) || 0,
        active_days: activeDays,
        balance_ath: u.balance_ath || 0,
        final_airdrop_score: (u.total_points || 0) + (Number(refCount) * 100) + (Number(tasksCount) * 10),
        credits_used_month: credits.credits_used_month || 0,
        credits_balance: credits.credits_balance || 0,
        referrals_list: [],
        tasks: [],
        jobs: [],
        cancel_at_period_end: (u.cancel_at_period_end === true || u.cancel_at_period_end === 1 || u.cancel_at_period_end === '1')
      });
    }
    res.json({ users });
  } catch (e) {
    console.error('Admin leaderboard error:', e);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

router.post('/users/:id/cancel-subscription', authenticateToken, checkAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    if (!userId) return res.status(400).json({ error: 'ID utilisateur invalide' });
    
    // Find active subscription
    const subRes = await db.query("SELECT stripe_subscription_id FROM subscriptions WHERE user_id = $1 AND status = 'active'", [userId]);
    
    if (subRes.rows.length === 0) {
        // Try to find any active subscription (maybe manual)
        const cancelAtPeriodEndVal = db.isSQLite ? 1 : true;
        const manualRes = await db.query("UPDATE subscriptions SET cancel_at_period_end = $1 WHERE user_id = $2 AND status = 'active' RETURNING *", [cancelAtPeriodEndVal, userId]);
        if (manualRes.rowCount > 0 || (manualRes.rows && manualRes.rows.length > 0)) {
             return res.json({ success: true, message: 'Abonnement marqué pour annulation à fin de période' });
        }
        return res.status(400).json({ error: 'Aucun abonnement actif trouvé' });
    }
    
    const subId = subRes.rows[0].stripe_subscription_id;
    
    // Cancel on Stripe (at period end)
    if (subId && process.env.STRIPE_SECRET_KEY) {
        try {
            const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
            const updatedSub = await stripe.subscriptions.update(subId, { cancel_at_period_end: true });
            
            // Update local DB with correct end date
            const currentPeriodEnd = new Date(updatedSub.current_period_end * 1000).toISOString();
            const cancelAtPeriodEndVal = db.isSQLite ? 1 : true;
            await db.query(
                "UPDATE subscriptions SET cancel_at_period_end = $1, current_period_end = $2 WHERE stripe_subscription_id = $3",
                [cancelAtPeriodEndVal, currentPeriodEnd, subId]
            );
        } catch (err) {
            console.error('Stripe cancel error:', err);
            return res.status(500).json({ error: 'Erreur Stripe: ' + err.message });
        }
    } else {
        // Fallback if no key
        const cancelAtPeriodEndVal = db.isSQLite ? 1 : true;
        await db.query(
          "UPDATE subscriptions SET cancel_at_period_end = $1 WHERE user_id = $2 AND status = 'active'",
          [cancelAtPeriodEndVal, userId]
        );
    }
    
    res.json({ success: true, message: 'Abonnement annulé (les avantages restent jusqu\'à la fin de la période)' });
  } catch (e) {
    console.error('Cancel sub error:', e);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

router.post('/users/:id/bonus', authenticateToken, checkAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { type, amount } = req.body;
    const qty = parseFloat(amount || 0);
    
    if (!userId) return res.status(400).json({ error: 'ID utilisateur invalide' });
    if (qty <= 0) return res.status(400).json({ error: 'Montant invalide' });

    if (type === 'node_passive') {
        // Ajouter Node NFT
        // 1. Log event
        await db.query('INSERT INTO wallet_events (user_id, type, amount, metadata) VALUES ($1, $2, $3, $4)', 
            [userId, 'nft_node', qty, JSON.stringify({ reason: 'admin_bonus' })]);
        
        // 2. Add entitlement (if strict mode used) or just rely on events sum
        // We'll insert into user_entitlements for consistency if table exists
        try {
            for(let i=0; i<qty; i++) {
                await db.query("INSERT INTO user_entitlements (user_id, feature, active) VALUES ($1, 'node_nft', $2)", 
                    [userId, db.isSQLite ? 1 : true]);
            }
        } catch(e) {
            // Ignore if table issues, wallet_events is primary fallback
        }

    } else if (type === 'crypto') {
        // Ajouter ATH
        const w = await db.query('SELECT balance_ath FROM wallets WHERE user_id = $1', [userId]);
        if (w.rows.length === 0) {
             await db.query('INSERT INTO wallets (user_id, balance_ath) VALUES ($1, $2)', [userId, 0]);
        }
        await db.query('UPDATE wallets SET balance_ath = balance_ath + $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2', 
            [qty, userId]);
        
        await db.query('INSERT INTO wallet_events (user_id, type, amount, metadata) VALUES ($1, $2, $3, $4)', 
            [userId, 'credit', qty, JSON.stringify({ reason: 'admin_bonus' })]);

    } else if (type === 'points_api') {
        // Ajouter Points API
        await db.query('UPDATE enterprise_credits SET credits_balance = credits_balance + $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2', 
            [qty, userId]);
        // Ensure credits row exists
        const c = await db.query('SELECT credits_balance FROM enterprise_credits WHERE user_id = $1', [userId]);
        if (c.rows.length === 0) {
             await db.query('INSERT INTO enterprise_credits (user_id, credits_balance, credits_used_month) VALUES ($1, $2, 0)', [userId, qty]);
        }
        
        await db.query('INSERT INTO credit_ledger (user_id, amount, reason) VALUES ($1, $2, $3)', 
            [userId, qty, 'admin_bonus']);

    } else if (type === 'points_leaderboard') {
        // Ajouter Points Leaderboard
        await db.query('UPDATE users SET total_points = COALESCE(total_points, 0) + $1 WHERE id = $2', 
            [qty, userId]);
        
        await db.query('INSERT INTO rewards_ledger (user_id, amount, reason, details) VALUES ($1, $2, $3, $4)', 
            [userId, qty, 'admin_bonus', JSON.stringify({ type: 'leaderboard_points' })]);

    } else {
        return res.status(400).json({ error: 'Type de bonus invalide' });
    }

    res.json({ success: true });
  } catch (e) {
    console.error('Bonus error:', e);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

router.post('/users/:id/set-points', authenticateToken, checkAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { points } = req.body || {};
    const newPoints = parseFloat(points);
    if (!userId || Number.isNaN(userId)) return res.status(400).json({ error: 'ID utilisateur invalide' });
    if (Number.isNaN(newPoints) || !Number.isFinite(newPoints)) return res.status(400).json({ error: 'Valeur de points invalide' });
    const r = await db.query('SELECT COALESCE(total_points, 0) AS p FROM users WHERE id = $1', [userId]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Utilisateur introuvable' });
    const current = parseFloat(r.rows[0].p || 0);
    const delta = newPoints - current;
    await db.query('UPDATE users SET total_points = $1 WHERE id = $2', [newPoints, userId]);
    if (delta !== 0) {
      await db.query(
        `INSERT INTO rewards_ledger (user_id, amount, reason, details) 
         VALUES ($1, $2, $3, $4)`,
        [userId, delta, 'admin_adjust', JSON.stringify({ from: current, to: newPoints })]
      );
    }
    res.json({ success: true, points: newPoints, delta });
  } catch (e) {
    console.error('Set points error:', e);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

// Réinitialiser la boutique: supprimer toutes les annonces et recréer 3 abonnements
router.post('/shop/reset', authenticateToken, checkAdmin, async (req, res) => {
  try {
    await db.query('DELETE FROM shop_items', []);
    const make = async (title, price, points) => {
      const meta = JSON.stringify({ pointsPerMonth: points });
      await db.query(
        `INSERT INTO shop_items (title, description, type, price, currency, active, metadata)
         VALUES ($1,$2,'subscription',$3,'EUR',1,$4)`,
        [title, `${title} — forfait mensuel`, price, meta]
      );
    };
    await make('BASIC', 19, 25000);
    await make('PRO', 49, 80000);
    await make('BUSINESS', 150, 250000);
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur interne du serveur' }); }
});

const crypto = require('crypto');
function generateKey() {
  return [
    crypto.randomBytes(3).toString('hex'),
    crypto.randomBytes(3).toString('hex'),
    crypto.randomBytes(3).toString('hex'),
    crypto.randomBytes(3).toString('hex'),
  ].join('-');
}
router.post('/enterprise/api-key', authenticateToken, checkAdmin, async (req, res) => {
  try {
    const { user_id, username, topup } = req.body || {};
    let targetId = user_id;
    if (!targetId && username) {
      const r = await db.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [username]);
      if (r.rows.length > 0) targetId = r.rows[0].id;
    }
    if (!targetId) return res.status(400).json({ error: 'user_id ou username requis' });
    await db.query('UPDATE api_keys SET active = 0 WHERE user_id = $1', [targetId]);
    const full = generateKey();
    const hash = crypto.createHash('sha256').update(full).digest('hex');
    await db.query('INSERT INTO api_keys (user_id, api_key_hash, active) VALUES ($1, $2, TRUE)', [targetId, hash]);
    const c = await db.query('SELECT user_id FROM enterprise_credits WHERE user_id = $1', [targetId]);
    if (c.rows.length === 0) await db.query('INSERT INTO enterprise_credits (user_id, credits_balance, credits_used_month) VALUES ($1, 0, 0)', [targetId]);
    if (topup && Number.isFinite(parseInt(topup))) {
      await db.query('UPDATE enterprise_credits SET credits_balance = credits_balance + $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2', [parseInt(topup), targetId]);
      await db.query('INSERT INTO credit_ledger (user_id, amount, reason) VALUES ($1, $2, $3)', [targetId, parseInt(topup), 'admin_topup']);
    }
    res.json({ fullKey: full });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

module.exports = router;
