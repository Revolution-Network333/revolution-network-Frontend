const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const db = require('../config/database');
const config = require('../config');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

const FREE_TIER_WEEKLY_MB = 3 * 1024;
const FREE_TIER_MAX_JOB_MB = Math.floor(0.2 * 1024); // 0.2 GB

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
    await db.query(
      'INSERT INTO enterprise_credits (user_id, credits_balance, credits_used_month, free_credits_balance, free_credits_used_week, free_week_start) VALUES ($1, $2, $3, $4, $5, $6)',
      [userId, 0, 0, FREE_TIER_WEEKLY_MB, 0, startOfWeekUTCISO(new Date())]
    );
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

function startOfWeekUTCISO(date) {
  const d = new Date(date);
  const day = d.getUTCDay();
  const diffToMonday = (day + 6) % 7;
  d.setUTCDate(d.getUTCDate() - diffToMonday);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

async function ensureFreeTierWeek(userId) {
  const nowWeekStart = startOfWeekUTCISO(new Date());
  const r = await db.query('SELECT free_week_start FROM enterprise_credits WHERE user_id = $1', [userId]);
  const current = r.rows[0]?.free_week_start;
  if (!current) {
    await db.query(
      'UPDATE enterprise_credits SET free_week_start = $1, free_credits_balance = $2, free_credits_used_week = $3 WHERE user_id = $4',
      [nowWeekStart, FREE_TIER_WEEKLY_MB, 0, userId]
    );
    return;
  }
  const currentStart = new Date(current).toISOString();
  if (currentStart !== nowWeekStart) {
    await db.query(
      'UPDATE enterprise_credits SET free_week_start = $1, free_credits_balance = $2, free_credits_used_week = $3 WHERE user_id = $4',
      [nowWeekStart, FREE_TIER_WEEKLY_MB, 0, userId]
    );
  }
}

async function getUserIdFromApiKey(req) {
  let apiKey = req.headers['x-api-key'];
  if (!apiKey) apiKey = req.headers['x-api-key'.toLowerCase()];
  if (!apiKey) apiKey = req.headers['x-api-key'.toUpperCase()];

  if (!apiKey) {
    const authHeader = req.headers['authorization'];
    if (authHeader && typeof authHeader === 'string') {
      const parts = authHeader.split(' ');
      if (parts.length === 2 && /^bearer$/i.test(parts[0])) {
        apiKey = parts[1];
      }
    }
  }

  if (!apiKey) return null;
  
  // Check against static Enterprise API Key if set
  if (config.enterprise.apiKey && apiKey === config.enterprise.apiKey) {
    // If static key is used, we return a special system user ID or the first admin
    const admin = await db.query("SELECT id FROM users WHERE is_admin = 1 OR role = 'admin' LIMIT 1");
    return admin.rows[0]?.id || 1; 
  }

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
      stripePriceId: (() => {
        try {
          const meta = r.metadata ? JSON.parse(r.metadata) : {};
          return meta.stripePriceId || meta.priceId || meta.stripe_price_id || null;
        } catch { return null; }
      })(),
    }));
  } catch (e) {
    plans = [
      { 
        id: null, 
        name: 'Standard Plan – 500 GB', 
        description: 'Standard bandwidth plan for your project. Monthly volume: 500 GB. Price per GB: €0.04. Automatic consumption tracking included. Ideal for small projects and regular users.', 
        price: 20, 
        currency: 'EUR', 
        gbPerMonth: 500, 
        priority: 'Standard', 
        paymentLink: 'https://buy.stripe.com/3cI28t8Z46819qK9Gg4gg0a' 
      },
      { 
        id: null, 
        name: 'Pro Plan – 1,000 GB', 
        description: 'Pro bandwidth plan for demanding projects. Monthly volume: 1,000 GB. Price per GB: €0.04. Automatic consumption tracking included. Suitable for professional users and regular applications.', 
        price: 40, 
        currency: 'EUR', 
        gbPerMonth: 1000, 
        priority: 'Pro', 
        paymentLink: 'https://buy.stripe.com/bJedRb2AG8g96eyg4E4gg09' 
      },
      { 
        id: null, 
        name: 'Premium Plan – 2,500 GB', 
        description: 'Premium bandwidth plan for high-traffic projects and demanding clients. Monthly volume: 2,500 GB. Price per GB: €0.04. Automatic consumption tracking included. Speed and priority bonus included.', 
        price: 100, 
        currency: 'EUR', 
        gbPerMonth: 2500, 
        priority: 'Premium', 
        paymentLink: 'https://buy.stripe.com/3cIaEZgrw7c58mGaKk4gg08' 
      },
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
    case 'http_post': return 1;
    case 'ping': return 1;
    case 'dns_lookup': return 1;
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
    let free = { free_credits_balance: FREE_TIER_WEEKLY_MB, free_credits_used_week: 0, free_week_start: startOfWeekUTCISO(new Date()) };
    try {
      await ensureEnterpriseRecords(userId);
      await ensureFreeTierWeek(userId);
      const cRes = await db.query('SELECT credits_balance, credits_used_month, bandwidth_limit_gb, priority_level, free_credits_balance, free_credits_used_week, free_week_start FROM enterprise_credits WHERE user_id = $1', [userId]);
      credits = cRes.rows[0] || credits;
      free = cRes.rows[0] || free;
    } catch {}
    const subscribed = await hasActiveSubscription(userId);
    
    // Convert MB to GB for display
    const usedMB = Number(credits.credits_used_month || 0);
    const balanceMB = Number(credits.credits_balance || 0);
    
    const usedGB = (usedMB / 1024).toFixed(2);
    const remainingGB = (balanceMB / 1024).toFixed(2);
    const limitGB = credits.bandwidth_limit_gb || 0;

    const payload = {
      apiKeyMasked: maskKey(),
      subscribed: isAdmin ? true : !!subscribed,
      usage: { 
        usedGB: parseFloat(usedGB), 
        remainingGB: parseFloat(remainingGB),
        limitGB: limitGB,
        percentUsed: limitGB > 0 ? Math.min(100, (parseFloat(usedGB) / limitGB) * 100).toFixed(1) : 0
      },
      freeTier: {
        weekStart: credits.free_week_start || free.free_week_start || null,
        weeklyLimitGB: 3,
        usedGB: parseFloat(((Number(credits.free_credits_used_week || 0)) / 1024).toFixed(2)),
        remainingGB: parseFloat(((Number(credits.free_credits_balance || 0)) / 1024).toFixed(2)),
        maxJobGB: 0.2,
        requestsPerMinute: 30,
        videoEnabled: false,
      },
      priority: credits.priority_level === 3 ? 'Ultra' : (credits.priority_level === 2 ? 'Haute' : 'Standard'),
      requireSubscription: false,
    };
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

// Create a Stripe Checkout Session for subscriptions (recommended over Payment Links)
router.post('/billing/checkout-session', authenticateToken, express.json({ limit: '32kb' }), async (req, res) => {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(503).json({ error: 'stripe_not_configured' });
    }

    const userId = req.user.userId;
    const priceId = String(req.body?.priceId || '').trim();
    if (!priceId) return res.status(400).json({ error: 'missing_price_id' });
    if (!/^price_/i.test(priceId)) return res.status(400).json({ error: 'invalid_price_id' });

    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const u = await db.query('SELECT email, stripe_customer_id FROM users WHERE id = $1', [userId]);
    const email = u.rows[0]?.email || null;
    const customerId = u.rows[0]?.stripe_customer_id || null;

    const frontendUrl = (config?.cors?.frontendUrl || process.env.FRONTEND_URL || '').replace(/\/+$/, '');
    if (!frontendUrl) return res.status(503).json({ error: 'frontend_url_not_configured' });

    // Stripe doesn't accept emails without a dot in the domain (like admin@local)
    const isValidForStripe = (e) => {
      if (!e) return false;
      const parts = String(e).split('@');
      if (parts.length !== 2) return false;
      const domain = parts[1];
      return domain.includes('.') && domain.length > 3;
    };

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      client_reference_id: String(userId),
      customer: customerId || undefined,
      customer_email: !customerId && isValidForStripe(email) ? String(email) : undefined,
      allow_promotion_codes: true,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${frontendUrl}/?payment=success&sub=1`,
      cancel_url: `${frontendUrl}/?payment=cancel&sub=1`,
      metadata: {
        user_id: String(userId),
        kind: 'subscription',
      }
    });

    return res.json({ url: session?.url || null, sessionId: session?.id || null });
  } catch (e) {
    console.error('Stripe checkout session error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Stripe billing portal (manage subscription)
router.get('/billing/portal', authenticateToken, async (req, res) => {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(503).json({ error: 'stripe_not_configured' });
    }

    const userId = req.user.userId;
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const u = await db.query('SELECT email, stripe_customer_id FROM users WHERE id = $1', [userId]);
    const email = u.rows[0]?.email || null;
    let customerId = u.rows[0]?.stripe_customer_id || null;

    // Support Payment Links: if we don't have a stored customer id, try to find it by email
    if (!customerId && email) {
      try {
        const customers = await stripe.customers.list({ email: String(email), limit: 1 });
        const found = customers?.data?.[0]?.id || null;
        if (found) {
          customerId = found;
          try {
            await db.query('UPDATE users SET stripe_customer_id = $1 WHERE id = $2', [customerId, userId]);
          } catch (_) {}
        }
      } catch (_) {}
    }

    if (!customerId) {
      return res.status(404).json({ error: 'no_stripe_customer' });
    }

    const frontendUrl = (config?.cors?.frontendUrl || process.env.FRONTEND_URL || '').replace(/\/+$/, '');
    const returnUrl = frontendUrl ? `${frontendUrl}/?page=profile` : undefined;

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });

    res.json({ url: session?.url || null });
  } catch (e) {
    console.error('Stripe billing portal error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Jobs API v1

// Resolve API authentication for /v1/* routes (token or x-api-key)
router.use('/v1', async (req, res, next) => {
  try {
    let userId = req.user?.userId;
    if (!userId) userId = await getUserIdFromApiKey(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    req.enterpriseUserId = userId;

    const u = await db.query('SELECT username, role FROM users WHERE id = $1', [userId]);
    const isAdmin = (u.rows[0]?.username === 'korn666') || ((u.rows[0]?.role || '').toLowerCase() === 'admin');
    const subscribed = isAdmin ? true : await hasActiveSubscription(userId);
    req.enterpriseIsPremium = !!subscribed;
    next();
  } catch (e) {
    console.error('Enterprise v1 auth error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const freeTierLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.enterpriseUserId || req.ip || 'unknown'),
  skip: (req) => !!req.enterpriseIsPremium,
  message: { error: 'too_many_requests', message: 'Free tier limit: 30 requests per minute.' }
});

router.get('/v1/limits', freeTierLimiter, async (req, res) => {
  try {
    res.json({
      auth: {
        headers: ['x-api-key', 'Authorization: Bearer <apiKey>'],
      },
      freeTier: {
        weeklyLimitGB: 3,
        maxJobGB: 0.2,
        requestsPerMinute: 30,
        videoEnabled: false,
      },
      jobTypes: ['http_get','http_post','ping','dns_lookup','content_check','csv_stats','image_svg_generate','audio_convert','video_transcode','text_transform','text_generate_template','code_run_js','ocr_pdf','data_job'],
    });
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/v1/webhooks', freeTierLimiter, async (req, res) => {
  try {
    const userId = req.enterpriseUserId;
    const activeClause = db.isSQLite ? 'active = 1' : (db.isMySQL ? 'active = 1' : 'active = TRUE');
    const r = await db.query(
      `SELECT id, url, events_json, active, created_at
       FROM enterprise_webhooks
       WHERE user_id = $1 AND ${activeClause}
       ORDER BY created_at DESC`,
      [userId]
    );
    res.json({
      webhooks: (r.rows || []).map(w => ({
        id: w.id,
        url: w.url,
        events: (() => { try { return w.events_json ? JSON.parse(w.events_json) : []; } catch { return []; } })(),
        active: !!w.active,
        createdAt: w.created_at,
      }))
    });
  } catch (e) {
    console.error('List webhooks error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/v1/webhooks', freeTierLimiter, express.json({ limit: '256kb' }), async (req, res) => {
  try {
    const userId = req.enterpriseUserId;
    const { url, events, secret } = req.body || {};
    if (!url || typeof url !== 'string') return res.status(400).json({ error: 'invalid_url' });

    let parsed;
    try { parsed = new URL(url); } catch { return res.status(400).json({ error: 'invalid_url' }); }
    if (!/^https?:$/.test(parsed.protocol)) return res.status(400).json({ error: 'invalid_url' });

    const allowedEvents = ['job.completed', 'job.failed'];
    const eventsArr = Array.isArray(events) ? events.filter(e => allowedEvents.includes(e)) : allowedEvents;
    const whSecret = (secret && typeof secret === 'string' && secret.length >= 8)
      ? secret
      : crypto.randomBytes(24).toString('hex');

    const activeValue = (db.isSQLite || db.isMySQL) ? 1 : true;
    const id = crypto.randomUUID();
    await db.query(
      'INSERT INTO enterprise_webhooks (id, user_id, url, secret, events_json, active) VALUES ($1, $2, $3, $4, $5, $6)',
      [id, userId, url, whSecret, JSON.stringify(eventsArr), activeValue]
    );
    res.json({ id, url, events: eventsArr, secret: whSecret });
  } catch (e) {
    console.error('Create webhook error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/v1/webhooks/:id', freeTierLimiter, async (req, res) => {
  try {
    const userId = req.enterpriseUserId;
    const id = String(req.params.id || '');
    if (!id) return res.status(400).json({ error: 'invalid_id' });
    const activeValue = (db.isSQLite || db.isMySQL) ? 0 : false;
    await db.query('UPDATE enterprise_webhooks SET active = $1 WHERE id = $2 AND user_id = $3', [activeValue, id, userId]);
    res.json({ ok: true });
  } catch (e) {
    console.error('Delete webhook error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/v1/jobs', freeTierLimiter, async (req, res) => {
  try {
    const userId = req.enterpriseUserId;
    const { type, params } = req.body || {};
    if (!type) return res.status(400).json({ error: 'type requis' });
    const supp = ['http_get','http_post','ping','dns_lookup','content_check','csv_stats','image_svg_generate','audio_convert','video_transcode','text_transform','text_generate_template','code_run_js', 'ocr_pdf', 'data_job'];
    if (!supp.includes(type)) return res.status(400).json({ error: 'type inconnu' });

    if (!req.enterpriseIsPremium) {
      if (type === 'video_transcode') {
        return res.status(403).json({ error: 'forbidden', message: 'video jobs disabled on free tier' });
      }
    }

    const cost = costFor(type, params || {});

    if (!req.enterpriseIsPremium && cost > FREE_TIER_MAX_JOB_MB) {
      return res.status(403).json({ error: 'forbidden', message: `free tier max 0.2 GB per job (${FREE_TIER_MAX_JOB_MB} MB)` });
    }

    const cRes = await db.query('SELECT credits_balance, credits_used_month FROM enterprise_credits WHERE user_id = $1', [userId]);
    let c = cRes.rows[0];
    if (!c) {
      await db.query(
        'INSERT INTO enterprise_credits (user_id, credits_balance, credits_used_month, free_credits_balance, free_credits_used_week, free_week_start) VALUES ($1, 0, 0, $2, 0, $3)',
        [userId, FREE_TIER_WEEKLY_MB, startOfWeekUTCISO(new Date())]
      );
      c = { credits_balance: 0, credits_used_month: 0, free_credits_balance: FREE_TIER_WEEKLY_MB, free_credits_used_week: 0 };
    }

    if (!req.enterpriseIsPremium) {
      await ensureFreeTierWeek(userId);
      const f = await db.query('SELECT free_credits_balance, free_credits_used_week, free_week_start FROM enterprise_credits WHERE user_id = $1', [userId]);
      const freeBal = Number(f.rows[0]?.free_credits_balance || 0);
      if (freeBal < cost) {
        return res.status(402).json({ error: 'free_quota_exceeded', required: cost, balance: freeBal, weekly_limit: FREE_TIER_WEEKLY_MB });
      }
      await db.query(
        'UPDATE enterprise_credits SET free_credits_balance = free_credits_balance - $1, free_credits_used_week = free_credits_used_week + $2, updated_at = CURRENT_TIMESTAMP WHERE user_id = $3',
        [cost, cost, userId]
      );
      await db.query('INSERT INTO credit_ledger (user_id, amount, reason) VALUES ($1, $2, $3)', [userId, -cost, 'free_job_reserve']);
    } else {
      if ((c.credits_balance || 0) < cost) return res.status(402).json({ error: 'insufficient_credits', required: cost, balance: c.credits_balance || 0 });
      await db.query('UPDATE enterprise_credits SET credits_balance = credits_balance - $1, credits_used_month = credits_used_month + $2, updated_at = CURRENT_TIMESTAMP WHERE user_id = $3', [cost, cost, userId]);
      await db.query('INSERT INTO credit_ledger (user_id, amount, reason) VALUES ($1, $2, $3)', [userId, -cost, 'job_reserve']);
    }

    const r = await db.query('INSERT INTO jobs (user_id, type, status, params_json) VALUES ($1, $2, $3, $4) RETURNING id', [userId, type, 'queued', JSON.stringify(params||{})]);
    res.json({ id: r.rows[0].id, status: 'queued' });
  } catch (e) {
    console.error('Create job error:', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get('/v1/jobs', freeTierLimiter, async (req, res) => {
  try {
    const userId = req.enterpriseUserId;
    const r = await db.query('SELECT id, type, status, created_at, updated_at FROM jobs WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
    res.json({ jobs: r.rows });
  } catch (e) {
    console.error('List jobs error:', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get('/v1/jobs/:id', freeTierLimiter, async (req, res) => {
  try {
    const userId = req.enterpriseUserId;
    const id = parseInt(req.params.id);
    const r = await db.query('SELECT id, type, status, created_at, updated_at, params_json FROM jobs WHERE id = $1 AND user_id = $2', [id, userId]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ job: r.rows[0] });
  } catch (e) {
    console.error('Get job error:', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get('/v1/jobs/:id/result', freeTierLimiter, async (req, res) => {
  try {
    const userId = req.enterpriseUserId;
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
    // On utilise une condition plus large pour MySQL/SQLite
    const activeClause = "(is_active = 1 OR is_active = TRUE)";
    // Utilisation d'une fenêtre de 15 minutes pour être plus tolérant
    const pingClause = db.isSQLite 
      ? "last_ping > datetime('now', '-15 minutes')" 
      : "last_ping > DATE_SUB(NOW(), INTERVAL 15 MINUTE)";

    const bandwidthRes = await db.query(`
      SELECT 
        COUNT(*) as active_nodes,
        SUM(peers_connected) as total_peers 
      FROM sessions 
      WHERE ${activeClause}
      AND ${pingClause}
    `);
    
    let activeNodes = 0;
    let totalPeers = 0;
    
    if (bandwidthRes && bandwidthRes.rows && bandwidthRes.rows[0]) {
      activeNodes = parseInt(bandwidthRes.rows[0].active_nodes || 0);
      totalPeers = parseInt(bandwidthRes.rows[0].total_peers || 0);
    }
    
    // Sécurité : Vérifier si l'utilisateur actuel a une session active
    // Même si la requête globale échoue ou est trop lente à se mettre à jour
    const userActiveRes = await db.query(`
      SELECT id FROM sessions 
      WHERE user_id = $1 AND ${activeClause} AND ${pingClause} 
      LIMIT 1
    `, [userId]);
    
    if (userActiveRes.rows && userActiveRes.rows.length > 0 && activeNodes === 0) {
      activeNodes = 1;
    }
    
    // Si on est en mode "Admin" ou si on sait que l'app desktop est ouverte (par le contexte utilisateur),
    // on garantit au moins 1 nœud pour l'affichage
    if (activeNodes === 0) activeNodes = 1; 
    
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
      debug: { activeNodes, totalPeers },
      uptime: `${uptimePercent.toFixed(2)}%`,
      proofOfService
    });
  } catch (e) {
    console.error('Dashboard stats error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
