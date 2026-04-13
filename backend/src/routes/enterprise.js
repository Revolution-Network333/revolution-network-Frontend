const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const db = require('../config/database');
const config = require('../config');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

const FREE_TIER_WEEKLY_MB = 3 * 1024;
const FREE_TIER_MAX_JOB_MB = Math.floor(0.2 * 1024);

function generateKey() {
  return [
    crypto.randomBytes(3).toString('hex'),
    crypto.randomBytes(3).toString('hex'),
    crypto.randomBytes(3).toString('hex'),
    crypto.randomBytes(3).toString('hex'),
  ].join('-');
}

function maskKey() {
  return '••••-••••-••••-••••';
}

function startOfWeekUTCISO(date) {
  const d = new Date(date);
  const day = d.getUTCDay();
  const diffToMonday = (day + 6) % 7;
  d.setUTCDate(d.getUTCDate() - diffToMonday);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

/* ---------------------------
   USER HELPERS
---------------------------- */

async function ensureFreeTierWeek(userId) {
  const nowWeekStart = startOfWeekUTCISO(new Date());

  const r = await db.query(
    'SELECT free_week_start FROM enterprise_credits WHERE user_id = $1',
    [userId]
  );

  const current = r.rows[0]?.free_week_start;

  if (!current || new Date(current).toISOString() !== nowWeekStart) {
    await db.query(`
      UPDATE enterprise_credits
      SET free_week_start = $1,
          free_credits_balance = $2,
          free_credits_used_week = 0
      WHERE user_id = $3
    `, [nowWeekStart, FREE_TIER_WEEKLY_MB, userId]);
  }
}

async function hasActiveSubscription(userId) {
  try {
    const res = await db.query(`
      SELECT status, current_period_end
      FROM subscriptions
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `, [userId]);

    if (!res.rows.length) return false;

    const sub = res.rows[0];
    if (sub.status === 'active') return true;

    if (sub.current_period_end) {
      return new Date(sub.current_period_end) > new Date();
    }

    return false;
  } catch {
    return false;
  }
}

/* ---------------------------
   /ME (FIX FINAL LOGIQUE GB)
---------------------------- */

router.get('/me', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    // IMPORTANT: include subscription GB
    const u = await db.query(
      'SELECT username, role, free_gb_remaining, subscription_gb FROM users WHERE id = $1',
      [userId]
    );

    const user = u.rows[0];

    const freeGb = Number(user?.free_gb_remaining || 0);
    const subGb = Number(user?.subscription_gb || 0);

    const isAdmin =
      user?.username === 'korn666' ||
      (user?.role || '').toLowerCase() === 'admin';

    await ensureFreeTierWeek(userId);

    const cRes = await db.query(`
      SELECT credits_balance,
             credits_used_month,
             bandwidth_limit_gb,
             priority_level,
             free_credits_used_week,
             free_week_start
      FROM enterprise_credits
      WHERE user_id = $1
    `, [userId]);

    const credits = cRes.rows[0] || {};

    const usedGB = (Number(credits.credits_used_month || 0) / 1024);
    const remainingGB = (Number(credits.credits_balance || 0) / 1024);

    const totalGB = freeGb + subGb;

    const subscribed = await hasActiveSubscription(userId);

    res.json({
      apiKeyMasked: maskKey(),
      subscribed: isAdmin ? true : !!subscribed,

      usage: {
        usedGB: parseFloat(usedGB.toFixed(2)),
        remainingGB: parseFloat(remainingGB.toFixed(2)),
        totalGB: parseFloat(totalGB.toFixed(2))
      },

      freeTier: {
        weekStart: credits.free_week_start || null,
        weeklyLimitGB: 3,
        usedGB: Number(((credits.free_credits_used_week || 0) / 1024).toFixed(2)),
        remainingGB: parseFloat(freeGb.toFixed(2)),
        maxJobGB: 0.2,
        requestsPerMinute: 30,
        videoEnabled: false,
      },

      subscription: {
        gb: subGb
      },

      totalGB: parseFloat(totalGB.toFixed(2)),

      priority: credits.priority_level === 3 ? 'Ultra'
        : credits.priority_level === 2 ? 'Haute'
        : 'Standard',

      requireSubscription: false,
    });

  } catch (e) {
    console.error('Enterprise /me error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/* ---------------------------
   API KEY
---------------------------- */

router.post('/api-key', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    await db.query('UPDATE api_keys SET active = 0 WHERE user_id = $1', [userId]);

    const full = generateKey();
    const hash = crypto.createHash('sha256').update(full).digest('hex');

    await db.query(
      'INSERT INTO api_keys (user_id, api_key_hash, active) VALUES ($1, $2, 1)',
      [userId, hash]
    );

    res.json({
      fullKey: full,
      apiKeyMasked: maskKey()
    });

  } catch (e) {
    console.error('API key error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;