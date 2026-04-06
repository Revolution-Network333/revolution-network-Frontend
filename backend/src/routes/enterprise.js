const express = require('express');
const crypto = require('crypto');
const db = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

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

async function ensureEnterpriseRecords(userId) {
  // Ensure credits row
  const credits = await db.query('SELECT * FROM enterprise_credits WHERE user_id = $1', [userId]);
  if (credits.rows.length === 0) {
    await db.query('INSERT INTO enterprise_credits (user_id, credits_balance, credits_used_month) VALUES ($1, $2, $3)', [userId, 0, 0]);
  }
  // Ensure api key exists (masked only)
  const keyRes = await db.query('SELECT * FROM api_keys WHERE user_id = $1 AND active = 1', [userId]);
  if (keyRes.rows.length === 0) {
    const full = generateKey();
    const hash = crypto.createHash('sha256').update(full).digest('hex');
    await db.query('INSERT INTO api_keys (user_id, api_key_hash, active) VALUES ($1, $2, 1)', [userId, hash]);
    return { createdNew: true, fullKey: full };
  }
  return { createdNew: false };
}

async function getUserIdFromApiKey(req) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return null;
  const hash = crypto.createHash('sha256').update(String(apiKey)).digest('hex');
  const activeClause = db.isSQLite ? 'active = 1' : 'active = TRUE';
  const res = await db.query(`SELECT user_id FROM api_keys WHERE api_key_hash = $1 AND ${activeClause}`, [hash]);
  return res.rows[0]?.user_id || null;
}

async function hasActiveSubscription(userId) {
  try {
    const activeClause = db.isSQLite ? "status IN ('active', 'cancelled')" : "status IN ('active', 'cancelled')";
    const res = await db.query(`
      SELECT id, status, current_period_end 
      FROM subscriptions 
      WHERE user_id = $1 AND ${activeClause}
      ORDER BY created_at DESC LIMIT 1`, 
      [userId]
    );
    if (res.rows.length === 0) return false;
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

async function getSubscriptionPlans() {
  let plans = [];
  try {
    const activeClause = db.isSQLite ? 'active = 1' : 'active = TRUE';
    const res = await db.query(`SELECT id, title, description, price, currency, metadata 
      FROM shop_items WHERE type = 'subscription' AND ${activeClause} ORDER BY price ASC`);
    plans = res.rows.map(r => ({
      id: r.id,
      name: r.title,
      description: r.description || '',
      price: r.price || 0,
      currency: r.currency || 'EUR',
      gbPerMonth: (() => {
        try { const meta = r.metadata ? JSON.parse(r.metadata) : {}; return meta.gbPerMonth || null; } catch { return null; }
      })(),
      priority: (() => {
        try { const meta = r.metadata ? JSON.parse(r.metadata) : {}; return meta.priority || 'Standard'; } catch { return 'Standard'; }
      })(),
      paymentLink: (() => {
        try { const meta = r.metadata ? JSON.parse(r.metadata) : {}; return meta.paymentLink || null; } catch { return null; }
      })(),
    }));
  } catch (e) {
    plans = [
      { id: null, name: 'Standard', description: '500 GB / mois, Support standard, Priorité normale', price: 20, currency: 'EUR', gbPerMonth: 500, priority: 'Standard', paymentLink: 'https://buy.stripe.com/5kA28p3EK2RPe76008' },
      { id: null, name: 'Pro', description: '1 000 GB / mois, Support rapide, Priorité haute', price: 40, currency: 'EUR', gbPerMonth: 1000, priority: 'Pro', paymentLink: 'https://buy.stripe.com/bJedRb2AG8g96eyg4E4gg09' },
      { id: null, name: 'Premium', description: '2 500 GB / mois, Support VIP, Priorité Ultra', price: 100, currency: 'EUR', gbPerMonth: 2500, priority: 'Premium', paymentLink: 'https://buy.stripe.com/00gbIX3EKbsh2YieV8' },
    ];
  }
  // Ajouter option Entreprise Illimité sur devis
  plans.push({
    id: null,
    name: 'Sur Mesure',
    description: 'Volume illimité ou spécifique, SLA personnalisé, Priorité dédiée',
    price: null,
    currency: 'EUR',
    gbPerMonth: null,
    priority: 'Dédiée',
    paymentLink: 'mailto:contact@revolution-network.com?subject=Custom%20-%20Abonnement',
  });
  return plans;
}

function costFor(type, params) {
  // Coût fixe par job en MB (0.04€ / GB = 0.00004€ / MB)
  // On estime la consommation moyenne par type de job
  switch (type) {
    case 'http_get': return 1; // 1 MB
    case 'content_check': return 5; // 5 MB
    case 'csv_stats': return 10; // 10 MB
    case 'image_svg_generate': return 2; // 2 MB
    case 'audio_convert': return 50; // 50 MB
    case 'video_transcode': return 500; // 500 MB
    case 'ocr_pdf': return 20; // 20 MB
    case 'data_job': return 100; // 100 MB
    case 'text_transform': return 1;
    case 'text_generate_template': return 1;
    case 'code_run_js': return 5;
    default: return 1;
  }
}

// Infos API (clé masquée + crédits)
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const u = await db.query('SELECT username, role FROM users WHERE id = $1', [userId]);
    const isAdmin = (u.rows[0]?.username === 'korn666') || ((u.rows[0]?.role || '').toLowerCase() === 'admin');

    let credits = { credits_balance: 0, credits_used_month: 0, bandwidth_limit_gb: 0, priority_level: 1 };
    try {
      await ensureEnterpriseRecords(userId);
      const cRes = await db.query('SELECT credits_balance, credits_used_month, bandwidth_limit_gb, priority_level FROM enterprise_credits WHERE user_id = $1', [userId]);
      credits = cRes.rows[0] || credits;
    } catch {}
    const subscribed = await hasActiveSubscription(userId);
    
    // Convert MB to GB for display
    const usedGB = (credits.credits_used_month / 1024).toFixed(2);
    const remainingGB = (credits.credits_balance / 1024).toFixed(2);
    const limitGB = credits.bandwidth_limit_gb || 0;

    const payload = {
      apiKeyMasked: maskKey(),
      usage: { 
        usedGB: parseFloat(usedGB), 
        remainingGB: parseFloat(remainingGB),
        limitGB: limitGB,
        percentUsed: limitGB > 0 ? Math.min(100, (parseFloat(usedGB) / limitGB) * 100).toFixed(1) : 0
      },
      priority: credits.priority_level === 3 ? 'Ultra' : (credits.priority_level === 2 ? 'Haute' : 'Standard'),
      requireSubscription: !subscribed && !isAdmin, // Admins don't need sub for /me view
    };
    if (!subscribed && !isAdmin) payload.plans = await getSubscriptionPlans();
    res.json(payload);
  } catch (e) {
    console.error('Enterprise /me error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Régénérer et révéler la clé (renvoie la clé complète pour copie)
router.post('/api-key', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const u = await db.query('SELECT username, role FROM users WHERE id = $1', [userId]);
    const isAdmin = (u.rows[0]?.username === 'korn666') || ((u.rows[0]?.role || '').toLowerCase() === 'admin');
    
    const subscribed = await hasActiveSubscription(userId);
    if (!subscribed && !isAdmin) {
      return res.status(402).json({ error: 'subscription_required', plans: await getSubscriptionPlans() });
    }
    // deactivate previous keys
    await db.query('UPDATE api_keys SET active = 0 WHERE user_id = $1', [userId]);
    // create new
    const full = generateKey();
    const hash = crypto.createHash('sha256').update(full).digest('hex');
    await db.query('INSERT INTO api_keys (user_id, api_key_hash, active) VALUES ($1, $2, 1)', [userId, hash]);
    res.json({ fullKey: full, apiKeyMasked: maskKey() });
  } catch (e) {
    console.error('Enterprise regen error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/plans', authenticateToken, async (req, res) => {
  try {
    const plans = await getSubscriptionPlans();
    res.json({ plans });
  } catch (e) {
    console.error('Plans error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Jobs API v1
router.post('/v1/jobs', async (req, res) => {
  try {
    let userId = req.user?.userId;
    if (!userId) userId = await getUserIdFromApiKey(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const { type, params } = req.body || {};
    if (!type) return res.status(400).json({ error: 'type requis' });
    const supp = ['http_get','content_check','csv_stats','image_svg_generate','audio_convert','video_transcode','text_transform','text_generate_template','code_run_js', 'ocr_pdf', 'data_job'];
    if (!supp.includes(type)) return res.status(400).json({ error: 'type inconnu' });
    const cost = costFor(type, params || {});
    const cRes = await db.query('SELECT credits_balance, credits_used_month FROM enterprise_credits WHERE user_id = $1', [userId]);
    let c = cRes.rows[0];
    if (!c) {
      await db.query('INSERT INTO enterprise_credits (user_id, credits_balance, credits_used_month) VALUES ($1, 0, 0)', [userId]);
      c = { credits_balance: 0, credits_used_month: 0 };
    }
    if ((c.credits_balance || 0) < cost) return res.status(402).json({ error: 'insufficient_credits', required: cost, balance: c.credits_balance || 0 });
    await db.query('UPDATE enterprise_credits SET credits_balance = credits_balance - $1, credits_used_month = credits_used_month + $2, updated_at = CURRENT_TIMESTAMP WHERE user_id = $3', [cost, cost, userId]);
    await db.query('INSERT INTO credit_ledger (user_id, amount, reason) VALUES ($1, $2, $3)', [userId, -cost, 'job_reserve']);
    const r = await db.query('INSERT INTO jobs (user_id, type, status, params_json) VALUES ($1, $2, $3, $4) RETURNING id', [userId, type, 'queued', JSON.stringify(params||{})]);
    res.json({ id: r.rows[0].id, status: 'queued' });
  } catch (e) {
    console.error('Create job error:', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get('/v1/jobs', async (req, res) => {
  try {
    let userId = req.user?.userId;
    if (!userId) userId = await getUserIdFromApiKey(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const r = await db.query('SELECT id, type, status, created_at, updated_at FROM jobs WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
    res.json({ jobs: r.rows });
  } catch (e) {
    console.error('List jobs error:', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get('/v1/jobs/:id', async (req, res) => {
  try {
    let userId = req.user?.userId;
    if (!userId) userId = await getUserIdFromApiKey(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const id = parseInt(req.params.id);
    const r = await db.query('SELECT id, type, status, created_at, updated_at, params_json FROM jobs WHERE id = $1 AND user_id = $2', [id, userId]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ job: r.rows[0] });
  } catch (e) {
    console.error('Get job error:', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get('/v1/jobs/:id/result', async (req, res) => {
  try {
    let userId = req.user?.userId;
    if (!userId) userId = await getUserIdFromApiKey(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const id = parseInt(req.params.id);
    const owner = await db.query('SELECT user_id FROM jobs WHERE id = $1', [id]);
    if (owner.rows[0]?.user_id !== userId) return res.status(403).json({ error: 'Forbidden' });
    const r = await db.query('SELECT result_json, error_text FROM job_results WHERE job_id = $1', [id]);
    if (r.rows.length === 0) return res.json({ result: null, error: null });
    res.json({ result: r.rows[0].result_json ? JSON.parse(r.rows[0].result_json) : null, error: r.rows[0].error_text || null });
  } catch (e) {
    console.error('Get job result error:', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Stats pour le dashboard client
router.get('/dashboard-stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    // 1. Bande passante disponible
    // Calculé sur le nombre de sessions actives (nœuds) ayant pingué récemment
    const activeClause = db.isSQLite ? 'is_active = 1' : 'is_active = TRUE';
    // Utilisation d'une fenêtre de 10 minutes pour être plus tolérant sur la détection
    const pingClause = db.isSQLite 
      ? "last_ping > datetime('now', '-10 minutes')" 
      : "last_ping > DATE_SUB(NOW(), INTERVAL 10 MINUTE)";

    const bandwidthRes = await db.query(`
      SELECT 
        COUNT(*) as active_nodes,
        SUM(peers_connected) as total_peers 
      FROM sessions 
      WHERE ${activeClause}
      AND ${pingClause}
    `);
    
    const activeNodes = parseInt(bandwidthRes.rows[0]?.active_nodes || 0);
    const totalPeers = parseInt(bandwidthRes.rows[0]?.total_peers || 0);
    
    // Logique : 50 Mbps par nœud actif + 10 Mbps par pair
    const availableBandwidthMbps = (activeNodes * 50) + (totalPeers * 10);

    // 2. Uptime (Ratio de succès des jobs de l'utilisateur sur les 30 derniers jours)
    const uptimeDateClause = db.isSQLite 
      ? "datetime('now', '-30 days')" 
      : "DATE_SUB(NOW(), INTERVAL 30 DAY)";

    const uptimeRes = await db.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as success
      FROM jobs 
      WHERE user_id = $1 
      AND created_at > ${uptimeDateClause}
    `, [userId]);
    
    const totalJobs = parseInt(uptimeRes.rows[0]?.total || 0);
    const successJobs = parseInt(uptimeRes.rows[0]?.success || 0);
    const uptimePercent = totalJobs > 0 ? (successJobs / totalJobs) * 100 : 100;

    // 3. Preuve de service (Derniers jobs avec leurs résultats)
    const proofRes = await db.query(`
      SELECT j.id, j.type, j.status, j.created_at, jr.result_json
      FROM jobs j
      LEFT JOIN job_results jr ON j.id = jr.job_id
      WHERE j.user_id = $1
      ORDER BY j.created_at DESC
      LIMIT 5
    `, [userId]);

    const proofOfService = proofRes.rows.map(r => ({
      id: r.id,
      type: r.type,
      status: r.status,
      timestamp: r.created_at,
      hasResult: !!r.result_json
    }));

    res.json({
      availableBandwidth: `${availableBandwidthMbps} Mbps`,
      uptime: `${uptimePercent.toFixed(2)}%`,
      proofOfService
    });
  } catch (e) {
    console.error('Dashboard stats error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
