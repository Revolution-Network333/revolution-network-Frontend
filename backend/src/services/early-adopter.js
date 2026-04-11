const crypto = require('crypto');

async function ensureEarlyAdoptersTable(db) {
  if (db.isSQLite) {
    await db.query(`CREATE TABLE IF NOT EXISTS early_adopters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      is_gold INTEGER DEFAULT 0,
      aether_awarded INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id)
    )`);
    return;
  }

  if (db.isMySQL) {
    await db.query(`CREATE TABLE IF NOT EXISTS early_adopters (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id BIGINT UNSIGNED NOT NULL,
      is_gold TINYINT(1) DEFAULT 0,
      aether_awarded INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_early_adopters_user (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    return;
  }

  await db.query(`CREATE TABLE IF NOT EXISTS early_adopters (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    is_gold BOOLEAN DEFAULT false,
    aether_awarded INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id)
  )`);
}

async function insertEarlyAdopterRow(db, userId, isGold, aetherAwarded) {
  if (db.isMySQL) {
    await db.query(
      'INSERT IGNORE INTO early_adopters (user_id, is_gold, aether_awarded) VALUES ($1, $2, $3)',
      [userId, isGold ? 1 : 0, aetherAwarded]
    );
    return;
  }

  if (db.isSQLite) {
    await db.query(
      'INSERT OR IGNORE INTO early_adopters (user_id, is_gold, aether_awarded) VALUES ($1, $2, $3)',
      [userId, isGold ? 1 : 0, aetherAwarded]
    );
    return;
  }

  await db.query(
    'INSERT INTO early_adopters (user_id, is_gold, aether_awarded) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO NOTHING',
    [userId, !!isGold, aetherAwarded]
  );
}

async function ensureEarlyAdopter(db, userId) {
  await ensureEarlyAdoptersTable(db);

  const eaCheck = await db.query('SELECT user_id FROM early_adopters WHERE user_id = $1', [userId]);
  if (eaCheck.rows.length > 0) return { already: true };

  const goldClause = db.isSQLite || db.isMySQL ? 'is_gold = 1' : 'is_gold = true';
  const eaCountRes = await db.query(`SELECT COUNT(*) as count FROM early_adopters WHERE ${goldClause}`);
  const eaCount = parseInt(eaCountRes.rows[0]?.count || 0);

  if (eaCount < 50) {
    await insertEarlyAdopterRow(db, userId, true, 100);

    await db.query("UPDATE users SET rank = 'Gold', is_rank_locked = 1 WHERE id = $1", [userId]);

    const walletCheck = await db.query('SELECT user_id FROM wallets WHERE user_id = $1', [userId]);
    if (walletCheck.rows.length === 0) {
      await db.query('INSERT INTO wallets (user_id, balance_ath) VALUES ($1, 100)', [userId]);
    } else {
      await db.query('UPDATE wallets SET balance_ath = balance_ath + 100 WHERE user_id = $1', [userId]);
    }

    try {
      await db.query(
        'INSERT INTO wallet_events (user_id, type, amount, metadata) VALUES ($1, $2, $3, $4)',
        [userId, 'bonus', 100, JSON.stringify({ reason: 'early_adopter_reward', rank_awarded: 'Gold' })]
      );
    } catch (_) {}

    const activeClause = db.isSQLite ? 'active = 1' : 'active = TRUE';
    const taskRes = await db.query(
      `SELECT id, reward_points FROM tasks WHERE type = 'early_adopter' AND ${activeClause} ORDER BY created_at DESC LIMIT 1`
    );

    if (taskRes.rows.length > 0) {
      const taskId = taskRes.rows[0].id;
      const rewardPoints = parseInt(taskRes.rows[0].reward_points || 0);

      const utCheck = await db.query('SELECT id FROM user_tasks WHERE user_id = $1 AND task_id = $2', [userId, taskId]);
      if (utCheck.rows.length === 0) {
        if (db.isMySQL) {
          await db.query(
            "INSERT IGNORE INTO user_tasks (user_id, task_id, status, timestamp_approved) VALUES ($1, $2, 'approved', NOW())",
            [userId, taskId]
          );
        } else {
          await db.query(
            "INSERT INTO user_tasks (user_id, task_id, status, timestamp_approved) VALUES ($1, $2, 'approved', CURRENT_TIMESTAMP)",
            [userId, taskId]
          );
        }

        if (rewardPoints > 0) {
          await db.query('UPDATE users SET total_points = COALESCE(total_points, 0) + $1 WHERE id = $2', [rewardPoints, userId]);
          try {
            await db.query(
              'INSERT INTO rewards_ledger (user_id, amount, reason, details) VALUES ($1, $2, $3, $4)',
              [userId, rewardPoints, 'task', JSON.stringify({ task_id: taskId, type: 'early_adopter' })]
            );
          } catch (_) {}
        }
      }
    }

    return { awarded: true, isGold: true, aether: 100, index: eaCount + 1 };
  }

  await insertEarlyAdopterRow(db, userId, false, 0);
  return { awarded: false, isGold: false, index: eaCount + 1 };
}

module.exports = { ensureEarlyAdopter };
