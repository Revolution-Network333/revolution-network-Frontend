const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

let tablesEnsured = false;
async function ensureNotificationTables() {
  if (tablesEnsured) return;

  if (db.isSQLite) {
    await db.query(`CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      message TEXT,
      target_user_id INTEGER,
      target_role TEXT,
      created_by INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    )`);
    await db.query(`CREATE TABLE IF NOT EXISTS notification_reads (
      user_id INTEGER NOT NULL,
      notification_id INTEGER NOT NULL,
      read_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, notification_id)
    )`);
  } else {
    await db.query(`CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      title TEXT,
      message TEXT,
      target_user_id INTEGER,
      target_role TEXT,
      created_by INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    await db.query(`CREATE TABLE IF NOT EXISTS notification_reads (
      user_id INTEGER NOT NULL,
      notification_id INTEGER NOT NULL,
      read_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, notification_id)
    )`);
  }

  // Best-effort: if table already existed from older version, add missing columns.
  try { await db.query('ALTER TABLE notifications ADD COLUMN target_user_id INTEGER'); } catch {}
  try { await db.query('ALTER TABLE notifications ADD COLUMN target_role TEXT'); } catch {}

  tablesEnsured = true;
}

async function requireAdmin(req, res, next) {
  try {
    const userId = req.user.userId;
    const u = await db.query('SELECT role FROM users WHERE id = $1', [userId]);
    const role = u.rows[0]?.role;
    if (String(role).toLowerCase() !== 'admin') {
      return res.status(403).json({ error: 'Accès interdit' });
    }
    return next();
  } catch (error) {
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}

// List notifications with read status for current user
router.get('/', authenticateToken, async (req, res) => {
  try {
    await ensureNotificationTables();
    const userId = req.user.userId;
    const roleRes = await db.query('SELECT role FROM users WHERE id = $1', [userId]);
    const role = String(roleRes.rows[0]?.role || '').toLowerCase();
    const limit = Math.min(parseInt(req.query.limit || '20', 10) || 20, 100);

    const result = await db.query(
      `SELECT n.id, n.title, n.message, n.created_at,
        CASE WHEN r.notification_id IS NULL THEN false ELSE true END AS is_read
      FROM notifications n
      LEFT JOIN notification_reads r
        ON r.notification_id = n.id AND r.user_id = $1
      WHERE (n.target_user_id IS NULL OR n.target_user_id = $1)
        AND (n.target_role IS NULL OR n.target_role = $2)
      ORDER BY n.created_at DESC
      LIMIT $3`,
      [userId, role, limit]
    );

    res.json({ notifications: result.rows });
  } catch (error) {
    console.error('List notifications error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get('/unread-count', authenticateToken, async (req, res) => {
  try {
    await ensureNotificationTables();
    const userId = req.user.userId;
    const roleRes = await db.query('SELECT role FROM users WHERE id = $1', [userId]);
    const role = String(roleRes.rows[0]?.role || '').toLowerCase();

    const countSql = db.isSQLite
      ? `SELECT COUNT(*) AS unread_count
        FROM notifications n
        LEFT JOIN notification_reads r
          ON r.notification_id = n.id AND r.user_id = $1
        WHERE r.notification_id IS NULL
          AND (n.target_user_id IS NULL OR n.target_user_id = $1)
          AND (n.target_role IS NULL OR n.target_role = $2)`
      : `SELECT COUNT(*)::int AS unread_count
        FROM notifications n
        LEFT JOIN notification_reads r
          ON r.notification_id = n.id AND r.user_id = $1
        WHERE r.notification_id IS NULL
          AND (n.target_user_id IS NULL OR n.target_user_id = $1)
          AND (n.target_role IS NULL OR n.target_role = $2)`;

    const result = await db.query(countSql, [userId, role]);

    const unread_count = parseInt(result.rows[0]?.unread_count || 0);
    res.json({ unread_count });
  } catch (error) {
    console.error('Unread notifications count error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/:id/read', authenticateToken, async (req, res) => {
  try {
    await ensureNotificationTables();
    const userId = req.user.userId;
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Invalid notification id' });

    if (db.isSQLite) {
      await db.query(
        `INSERT OR IGNORE INTO notification_reads (user_id, notification_id)
         VALUES ($1, $2)`,
        [userId, id]
      );
    } else {
      await db.query(
        `INSERT INTO notification_reads (user_id, notification_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id, notification_id) DO NOTHING`,
        [userId, id]
      );
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Mark notification read error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/mark-all-read', authenticateToken, async (req, res) => {
  try {
    await ensureNotificationTables();
    const userId = req.user.userId;

    // Insert all currently unread notifications into reads
    if (db.isSQLite) {
      await db.query(
        `INSERT OR IGNORE INTO notification_reads (user_id, notification_id)
        SELECT $1, n.id
        FROM notifications n
        LEFT JOIN notification_reads r
          ON r.notification_id = n.id AND r.user_id = $1
        WHERE r.notification_id IS NULL`,
        [userId]
      );
    } else {
      await db.query(
        `INSERT INTO notification_reads (user_id, notification_id)
        SELECT $1, n.id
        FROM notifications n
        LEFT JOIN notification_reads r
          ON r.notification_id = n.id AND r.user_id = $1
        WHERE r.notification_id IS NULL
        ON CONFLICT (user_id, notification_id) DO NOTHING`,
        [userId]
      );
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Mark all notifications read error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Admin: create notification
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    await ensureNotificationTables();
    const userId = req.user.userId;
    const title = (req.body?.title || '').trim();
    const message = (req.body?.message || '').trim();

    if (!title || !message) {
      return res.status(400).json({ error: 'Titre et message requis' });
    }

    const result = await db.query(
      `INSERT INTO notifications (title, message, target_user_id, target_role, created_by)
       VALUES ($1, $2, NULL, NULL, $3)
       RETURNING id, title, message, created_at`,
      [title, message, userId]
    );

    res.json({ notification: result.rows[0] });
  } catch (error) {
    console.error('Create notification error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
