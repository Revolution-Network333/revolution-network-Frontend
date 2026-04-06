const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const db = require('./config/database');
const crypto = require('crypto');

// Routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const sessionRoutes = require('./routes/session');
const rewardsRoutes = require('./routes/rewards');
const adminRoutes = require('./routes/admin');
const enterpriseRoutes = require('./routes/enterprise');
const shopRoutes = require('./routes/shop');
const walletRoutes = require('./routes/wallet');
const tasksRoutes = require('./routes/tasks');
const supportRoutes = require('./routes/support');

// Services
const SignalingService = require('./services/signaling');
const RewardsService = require('./services/rewards');

const app = express();
const httpServer = createServer(app);

// Behind Render's proxy: trust first proxy to read correct client IP
app.set('trust proxy', 1);

app.get('/api/version', (req, res) => {
  res.json({
    version: 'backend-src',
    ts: new Date().toISOString()
  });
});
const stripeWebhookPath = '/api/stripe/webhook';
app.post(stripeWebhookPath, express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const signature = req.headers['stripe-signature'];
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret || !signature) return res.status(400).send('bad_request');
    const parts = String(signature).split(',').reduce((acc, kv) => {
      const [k, v] = kv.split('=');
      if (k && v) acc[k.trim()] = v.trim();
      return acc;
    }, {});
    const t = parts.t;
    const v1 = parts.v1;
    if (!t || !v1) return res.status(400).send('invalid_signature');
    const payload = `${t}.${req.body.toString('utf8')}`;
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    const ok = expected.length === v1.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
    if (!ok) return res.status(400).send('signature_mismatch');
    const event = JSON.parse(req.body.toString('utf8'));

    // Handle Subscription Lifecycle
    if (['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted'].includes(event.type)) {
      const sub = event.data.object;
      const stripeSubId = sub.id;
      const status = sub.status; // active, past_due, canceled, etc.
      const customerId = sub.customer;
      const currentPeriodStart = sub.current_period_start ? new Date(sub.current_period_start * 1000).toISOString() : null;
      const currentPeriodEnd = sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null;
      const cancelAtPeriodEndVal = sub.cancel_at_period_end ? true : false;
      const cancelAtPeriodEnd = db.isSQLite ? (cancelAtPeriodEndVal ? 1 : 0) : cancelAtPeriodEndVal;

      // Check if subscription exists
      const existing = await db.query('SELECT id FROM subscriptions WHERE stripe_subscription_id = $1', [stripeSubId]);
      
      if (existing.rows.length > 0) {
        await db.query(
          `UPDATE subscriptions SET status = $1, current_period_start = $2, current_period_end = $3, cancel_at_period_end = $4 WHERE stripe_subscription_id = $5`,
          [status, currentPeriodStart, currentPeriodEnd, cancelAtPeriodEnd, stripeSubId]
        );
      } else if (customerId) {
        // Try to find user by stripe_customer_id to create it
        const userRes = await db.query('SELECT id FROM users WHERE stripe_customer_id = $1', [customerId]);
        if (userRes.rows.length > 0) {
          const userId = userRes.rows[0].id;
          let planName = 'premium';
          if (sub.metadata && sub.metadata.plan_name) planName = sub.metadata.plan_name;
          
          await db.query(
            `INSERT INTO subscriptions (user_id, stripe_subscription_id, plan_name, status, current_period_start, current_period_end, cancel_at_period_end) 
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [userId, stripeSubId, planName, status, currentPeriodStart, currentPeriodEnd, cancelAtPeriodEnd]
          );
        }
      }
    }

    if (event.type === 'checkout.session.completed') {
      const obj = event.data?.object || {};
      const clientReferenceId = obj.client_reference_id;
      const email = obj.customer_details?.email || obj.customer_email || null;
      const amountTotal = obj.amount_total || 0;
      const currency = (obj.currency || 'eur').toUpperCase();
      const mode = obj.mode;

      // Handle Subscription Checkout
      if (mode === 'subscription' && clientReferenceId && obj.subscription) {
         const userId = parseInt(clientReferenceId);
         if (!isNaN(userId)) {
             // Save Stripe Customer ID
             if (obj.customer) {
                 await db.query('UPDATE users SET stripe_customer_id = $1 WHERE id = $2', [obj.customer, userId]);
             }
             // Ensure subscription is created
             const subId = obj.subscription;
             const existing = await db.query('SELECT id FROM subscriptions WHERE stripe_subscription_id = $1', [subId]);
             if (existing.rows.length === 0) {
                 let planName = 'premium';
                 if (obj.metadata && obj.metadata.plan_name) planName = obj.metadata.plan_name;
                 await db.query(
                     `INSERT INTO subscriptions (user_id, stripe_subscription_id, plan_name, status, created_at) 
                      VALUES ($1, $2, $3, 'active', CURRENT_TIMESTAMP)`,
                     [userId, subId, planName]
                 );
             }
         }
      }
      
      // Handle One-Time Payments (Shop Orders via Checkout Session)
      if (mode !== 'subscription' && amountTotal > 0 && (obj.metadata?.order_id || clientReferenceId)) {
        const rawOrderId = obj.metadata?.order_id || clientReferenceId;
        const orderId = parseInt(String(rawOrderId));
        if (!Number.isNaN(orderId) && orderId > 0) {
          const orderRes = await db.query(
            `SELECT o.*, si.type AS item_type, si.title AS item_title, si.metadata AS item_metadata, si.currency AS item_currency
             FROM orders o
             LEFT JOIN shop_items si ON si.id = o.item_id
             WHERE o.id = $1`,
            [orderId]
          );
          const order = orderRes.rows[0] || null;
          if (order && order.user_id) {
            if (String(order.status || '').toLowerCase() !== 'paid') {
              const paymentStatus = String(obj.payment_status || '').toLowerCase();
              if (paymentStatus && paymentStatus !== 'paid') {
                res.json({ received: true });
                return;
              }
              const expectedCents = Math.round((parseFloat(order.total_price) || 0) * 100);
              const paidCents = parseInt(String(amountTotal), 10) || 0;
              if (expectedCents > 0 && paidCents > 0 && Math.abs(expectedCents - paidCents) > 2) {
                try {
                  await db.query('UPDATE orders SET status = $1 WHERE id = $2 AND status = $3', ['payment_mismatch', orderId, 'pending_payment']);
                } catch {}
                res.json({ received: true });
                return;
              }

              const client = await db.getClient();
              try {
                await client.query('BEGIN');
                if (!db.isSQLite) {
                  try { await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_user_entitlements_user_feature ON user_entitlements (user_id, feature)`); } catch {}
                } else {
                  try { await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_user_entitlements_user_feature ON user_entitlements (user_id, feature)`); } catch {}
                }

                const itemType = String(order.item_type || '');
                if (itemType === 'vpn' || itemType === 'auto_mining' || itemType === 'node_nft') {
                  if (itemType === 'node_nft') {
                    const already = await client.query(
                      `SELECT COUNT(*)::int AS c FROM user_entitlements WHERE user_id = $1 AND feature = 'node_nft' AND ${db.isSQLite ? 'active = 1' : 'active = TRUE'}`,
                      [order.user_id]
                    );
                    if ((already.rows[0]?.c || 0) === 0) {
                      await client.query(
                        `INSERT INTO user_entitlements (user_id, feature, active, metadata)
                         VALUES ($1, $2, $3, $4)
                         ON CONFLICT DO NOTHING`,
                        [order.user_id, itemType, db.isSQLite ? 1 : true, order.item_metadata || null]
                      );
                    }
                  } else {
                    await client.query(
                      `INSERT INTO user_entitlements (user_id, feature, active, metadata)
                       VALUES ($1, $2, $3, $4)
                       ON CONFLICT DO NOTHING`,
                      [order.user_id, itemType, db.isSQLite ? 1 : true, order.item_metadata || null]
                    );
                  }
                }

                if (itemType === 'presale') {
                  try {
                    await client.query('INSERT INTO wallets (user_id, balance_ath) VALUES ($1, 0) ON CONFLICT (user_id) DO NOTHING', [order.user_id]);
                  } catch {
                    try {
                      const w = await client.query('SELECT balance_ath FROM wallets WHERE user_id = $1', [order.user_id]);
                      if (w.rows.length === 0) await client.query('INSERT INTO wallets (user_id, balance_ath) VALUES ($1, 0)', [order.user_id]);
                    } catch {}
                  }
                  const q = Number(order.qty || 0) || 0;
                  if (q > 0) {
                    await client.query('UPDATE wallets SET balance_ath = balance_ath + $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2', [q, order.user_id]);
                    try {
                      await client.query(
                        'INSERT INTO wallet_events (user_id, type, amount, metadata) VALUES ($1, $2, $3, $4)',
                        [order.user_id, 'credit', q, JSON.stringify({ source: 'stripe_checkout', orderId, currency, amount_total: amountTotal })]
                      );
                    } catch {}
                  }
                }

                let existingMeta = {};
                try { existingMeta = JSON.parse(order.metadata || '{}'); } catch {}
                const newMeta = {
                  ...(existingMeta || {}),
                  stripe: {
                    ...(existingMeta?.stripe || {}),
                    checkout_session_id: obj.id || null,
                    payment_intent: obj.payment_intent || null,
                    amount_total: amountTotal,
                    currency
                  }
                };
                await client.query('UPDATE orders SET status = $1, metadata = $2 WHERE id = $3', ['paid', JSON.stringify(newMeta), orderId]);
                await client.query('COMMIT');
              } catch (e) {
                await client.query('ROLLBACK');
                console.error(e);
              } finally {
                client.release();
              }
            }
            res.json({ received: true });
            return;
          }
        }
      }

      // Handle One-Time Payments (Legacy / Payment Links)
      if (mode !== 'subscription' && (clientReferenceId || email) && amountTotal > 0) {
        let u = { rows: [] };
        if (clientReferenceId) {
            u = await db.query('SELECT id FROM users WHERE id = $1', [clientReferenceId]);
        }
        if (u.rows.length === 0 && email) {
            u = await db.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email]);
        }

        if (u.rows.length > 0) {
          const userId = u.rows[0].id;
          const whereActive = db.isSQLite ? 'active = 1' : 'active = TRUE';
          const itemsRes = await db.query(`SELECT id, price, currency, metadata FROM shop_items WHERE type = 'presale' AND ${whereActive}`);
          
          let matchedItem = null;
          let qty = 0;
          let unitPrice = 0;

          for (const item of itemsRes.rows) {
            let meta = {};
            try { meta = JSON.parse(item.metadata || '{}'); } catch {}
            const priceCents = Math.round((parseFloat(item.price) || 0) * 100);
            
            // 1. Pack Match (Exact Price)
            if (meta.isPack && Math.abs(priceCents - amountTotal) < 10) {
                matchedItem = item;
                qty = parseInt(meta.packAmount) || parseInt(meta.minQty) || 0;
                unitPrice = qty > 0 ? (parseFloat(item.price) / qty) : 0;
                break;
            }
            
            // 2. Unit Match (Multiple of Price)
            if (!matchedItem && !meta.isPack && priceCents > 0 && amountTotal >= priceCents && (amountTotal % priceCents) < 10) {
                matchedItem = item;
                const count = Math.round(amountTotal / priceCents);
                unitPrice = parseFloat(item.price);
                qty = count;
                // Enforce block size if needed
                let blockSize = 50;
                if (meta && Number.isFinite(parseFloat(meta.minQty)) && parseFloat(meta.minQty) >= 1) blockSize = parseFloat(meta.minQty);
                // For unit buys, we often round to block size, but if payment is exact, maybe we shouldn't?
                // Let's stick to simple division for now.
            }
          }

          if (matchedItem && qty > 0) {
            const order = (await db.query(`SELECT id FROM orders WHERE user_id = $1 AND item_id = $2 AND status = 'pending_payment' ORDER BY created_at DESC LIMIT 1`, [userId, matchedItem.id])).rows[0];
            if (order) {
              await db.query(`UPDATE orders SET status = 'paid', total_price = $1, qty = $2 WHERE id = $3`, [amountTotal / 100, qty, order.id]);
            } else {
              await db.query(`INSERT INTO orders (user_id, item_id, qty, unit_price, total_price, status, metadata) VALUES ($1, $2, $3, $4, $5, 'paid', $6)`, [userId, matchedItem.id, qty, unitPrice, amountTotal / 100, matchedItem.metadata || null]);
            }
            if (!db.isSQLite) {
              try {
                await db.query(`INSERT INTO wallets (user_id, balance_ath) VALUES ($1, 0) ON CONFLICT (user_id) DO NOTHING`, [userId]);
              } catch {}
            }
            await db.query('UPDATE wallets SET balance_ath = balance_ath + $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2', [qty, userId]);
            await db.query('INSERT INTO wallet_events (user_id, type, amount, metadata) VALUES ($1, $2, $3, $4)', [userId, 'credit', qty, JSON.stringify({ source: 'stripe', currency, amount_total: amountTotal, is_pack: !!JSON.parse(matchedItem.metadata||'{}').isPack })]);
          }
        }
      }
    }
    res.json({ received: true });
  } catch (e) {
    res.status(400).send('webhook_error');
  }
});

// Seed admin account on startup
const bcrypt = require('bcryptjs');
async function ensureSqliteMigrations() {
  try {
    const info = await db.query("PRAGMA table_info('users')");
    const cols = (info.rows || []).map(r => r.name);
    const run = async (sql) => { try { await db.query(sql); } catch (e) { /* ignore if already exists */ } };
    if (!cols.includes('role')) await run("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'");
    if (!cols.includes('referral_code')) await run("ALTER TABLE users ADD COLUMN referral_code TEXT");
    if (!cols.includes('referrer_id')) await run("ALTER TABLE users ADD COLUMN referrer_id INTEGER");
    if (!cols.includes('rank')) await run("ALTER TABLE users ADD COLUMN rank TEXT DEFAULT 'Bronze'");
    if (!cols.includes('solana_address')) await run("ALTER TABLE users ADD COLUMN solana_address TEXT");
    if (!cols.includes('profile_picture_url')) await run("ALTER TABLE users ADD COLUMN profile_picture_url TEXT");
    if (!cols.includes('google_sub')) await run("ALTER TABLE users ADD COLUMN google_sub TEXT");
    if (!cols.includes('stripe_customer_id')) await run("ALTER TABLE users ADD COLUMN stripe_customer_id TEXT");
    if (!cols.includes('is_admin')) await run("ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0");
    if (!cols.includes('twofa_enabled')) await run("ALTER TABLE users ADD COLUMN twofa_enabled INTEGER DEFAULT 0");
    if (!cols.includes('twofa_secret')) await run("ALTER TABLE users ADD COLUMN twofa_secret TEXT");
    await run(`CREATE TABLE IF NOT EXISTS api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      api_key_hash TEXT NOT NULL,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    await run(`CREATE TABLE IF NOT EXISTS enterprise_credits (
      user_id INTEGER PRIMARY KEY,
      credits_balance INTEGER DEFAULT 0,
      credits_used_month INTEGER DEFAULT 0,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    await run(`CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      params_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    await run(`CREATE TABLE IF NOT EXISTS job_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER UNIQUE NOT NULL,
      result_json TEXT,
      error_text TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    await run(`CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      stripe_subscription_id TEXT,
      plan_name TEXT,
      status TEXT NOT NULL,
      current_period_start TEXT,
      current_period_end TEXT,
      cancel_at_period_end INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    // Ensure column exists in existing table
    const subInfo = await db.query("PRAGMA table_info('subscriptions')");
    const subCols = (subInfo.rows || []).map(r => r.name);
    if (!subCols.includes('cancel_at_period_end')) await run("ALTER TABLE subscriptions ADD COLUMN cancel_at_period_end INTEGER DEFAULT 0");
    await run(`CREATE TABLE IF NOT EXISTS shop_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      type TEXT NOT NULL,
      price REAL NOT NULL,
      currency TEXT DEFAULT 'EUR',
      active INTEGER DEFAULT 1,
      metadata TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    await run(`CREATE TABLE IF NOT EXISTS user_entitlements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      feature VARCHAR(100) NOT NULL,
      active INTEGER DEFAULT 1,
      metadata TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    await run(`CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      item_id INTEGER NOT NULL,
      qty INTEGER DEFAULT 1,
      unit_price REAL NOT NULL,
      total_price REAL NOT NULL,
      status TEXT DEFAULT 'created',
      metadata TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    await run(`CREATE TABLE IF NOT EXISTS wallets (
      user_id INTEGER PRIMARY KEY,
      balance_ath REAL DEFAULT 0,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    await run(`CREATE TABLE IF NOT EXISTS stakes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      principal REAL NOT NULL,
      apy REAL NOT NULL,
      start_time TEXT DEFAULT CURRENT_TIMESTAMP,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    await run(`CREATE TABLE IF NOT EXISTS wallet_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      metadata TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    await run(`CREATE TABLE IF NOT EXISTS banned_ips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip_address TEXT UNIQUE NOT NULL,
      reason TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    await run(`CREATE TABLE IF NOT EXISTS credit_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      reason TEXT,
      job_id INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    await run(`CREATE TABLE IF NOT EXISTS rewards_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      session_id INTEGER,
      amount INTEGER NOT NULL,
      reason TEXT,
      details TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    await run(`CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      type TEXT,
      link_url TEXT,
      reward_points INTEGER DEFAULT 0,
      reward_airdrop_bonus_percent INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    await run(`CREATE TABLE IF NOT EXISTS user_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      task_id INTEGER NOT NULL,
      status TEXT DEFAULT 'not_started',
      timestamp_started TEXT,
      timestamp_approved TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    await run(`CREATE TABLE IF NOT EXISTS support_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      subject TEXT,
      status TEXT DEFAULT 'open',
      priority TEXT DEFAULT 'medium',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    await run(`CREATE TABLE IF NOT EXISTS support_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL,
      sender_id INTEGER NOT NULL,
      sender_role TEXT NOT NULL,
      message TEXT,
      attachment_url TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    await run(`CREATE INDEX IF NOT EXISTS idx_tasks_active_created ON tasks (active, created_at)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_user_tasks_user_status ON user_tasks (user_id, status)`);
    await run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_user_tasks_unique ON user_tasks (user_id, task_id)`);
    await run(`CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    await run(`CREATE TABLE IF NOT EXISTS admin_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id INTEGER,
      action TEXT,
      details TEXT,
      ip_address TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    try {
      const wInfo = await db.query("PRAGMA table_info('wallets')");
      const wCols = (wInfo.rows || []).map(r => r.name);
      if (wCols.includes('balance_zeta') && !wCols.includes('balance_ath')) {
        await run("ALTER TABLE wallets RENAME COLUMN balance_zeta TO balance_ath");
      }
    } catch {}
    try {
      const sInfo = await db.query("PRAGMA table_info('sessions')");
      const sCols = (sInfo.rows || []).map(r => r.name);
      if (!sCols.includes('name')) await run("ALTER TABLE sessions ADD COLUMN name TEXT");
    } catch {}
    console.log('✅ SQLite migrations ensured for users table');
  } catch (e) {
    console.error('SQLite migration error:', e);
  }
}

async function ensurePostgresSchema() {
  try {
    const client = await db.getClient();
    try {
      const exists = await client.query("SELECT to_regclass('public.users') AS reg");
      if (!exists.rows[0] || !exists.rows[0].reg) {
        const fs = require('fs');
        const path = require('path');
        const schemaPath = path.join(__dirname, '../database/schema.sql');
        const sql = fs.readFileSync(schemaPath, 'utf8');
        await client.query(sql);
        console.log('✅ PostgreSQL schema initialized');
      }
      try { await client.query("ALTER TABLE users ADD COLUMN role VARCHAR(20) DEFAULT 'user'"); } catch (e) { if (e.code !== '42701') throw e; }
      try { await client.query("ALTER TABLE users ADD COLUMN stripe_customer_id VARCHAR(255)"); } catch (e) { if (e.code !== '42701') throw e; }
      try { await client.query("ALTER TABLE users ADD COLUMN referral_code TEXT"); } catch (e) { if (e.code !== '42701') throw e; }
      try { await client.query("ALTER TABLE users ADD COLUMN referrer_id INTEGER"); } catch (e) { if (e.code !== '42701') throw e; }
      try { await client.query("ALTER TABLE users ADD COLUMN rank TEXT DEFAULT 'Bronze'"); } catch (e) { if (e.code !== '42701') throw e; }
      try { await client.query("ALTER TABLE users ADD COLUMN google_sub TEXT"); } catch (e) { if (e.code !== '42701') throw e; }
      try { await client.query("ALTER TABLE users ADD COLUMN is_admin BOOLEAN DEFAULT false"); } catch (e) { if (e.code !== '42701') throw e; }
      try { await client.query("ALTER TABLE users ADD COLUMN twofa_enabled BOOLEAN DEFAULT false"); } catch (e) { if (e.code !== '42701') throw e; }
      try { await client.query("ALTER TABLE users ADD COLUMN twofa_secret TEXT"); } catch (e) { if (e.code !== '42701') throw e; }
      console.log('✅ PostgreSQL users columns ensured');

      // Harmoniser la table sessions (champ name utilisé par l'app)
      try { await client.query("ALTER TABLE sessions ADD COLUMN name TEXT"); } catch (e) { if (e.code !== '42701') throw e; }

      // Ensure shop and orders related tables exist (idempotent)
      await client.query(`
        CREATE TABLE IF NOT EXISTS shop_items (
          id SERIAL PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT,
          type TEXT NOT NULL,
          price REAL NOT NULL,
          currency TEXT DEFAULT 'EUR',
          active BOOLEAN DEFAULT TRUE,
          metadata TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS user_entitlements (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          feature VARCHAR(100) NOT NULL,
          active BOOLEAN DEFAULT TRUE,
          metadata TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS api_keys (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          api_key_hash TEXT NOT NULL,
          active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS enterprise_credits (
          user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          credits_balance INTEGER DEFAULT 0,
          credits_used_month INTEGER DEFAULT 0,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
      // Ensure missing columns on existing installations
      try { await client.query(`ALTER TABLE enterprise_credits ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`); } catch (e) { if (e.code !== '42701') throw e; }
      await client.query(`
        CREATE TABLE IF NOT EXISTS orders (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          item_id INTEGER NOT NULL REFERENCES shop_items(id) ON DELETE CASCADE,
          qty INTEGER DEFAULT 1,
          unit_price REAL NOT NULL,
          total_price REAL NOT NULL,
          status VARCHAR(50) DEFAULT 'created',
          metadata TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS jobs (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          type TEXT NOT NULL,
          status VARCHAR(50) NOT NULL DEFAULT 'queued',
          params_json TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
      try { await client.query(`CREATE INDEX idx_jobs_status_created_at ON jobs (status, created_at)`); } catch (e) { if (e.code !== '42P07' && e.code !== '42710') throw e; }
      // Ensure missing columns for legacy installations
      try { await client.query(`ALTER TABLE jobs ADD COLUMN params_json TEXT`); } catch (e) { if (e.code !== '42701') throw e; }
      try { await client.query(`ALTER TABLE jobs ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`); } catch (e) { if (e.code !== '42701') throw e; }
      try { await client.query(`ALTER TABLE jobs ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`); } catch (e) { if (e.code !== '42701') throw e; }
      await client.query(`
        CREATE TABLE IF NOT EXISTS job_results (
          id SERIAL PRIMARY KEY,
          job_id INTEGER UNIQUE NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
          result_json TEXT,
          error_text TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
      try { await client.query(`CREATE INDEX idx_job_results_job_id ON job_results (job_id)`); } catch (e) { if (e.code !== '42P07' && e.code !== '42710') throw e; }
      try { await client.query(`ALTER TABLE job_results ADD COLUMN result_json TEXT`); } catch (e) { if (e.code !== '42701') throw e; }
      try { await client.query(`ALTER TABLE job_results ADD COLUMN error_text TEXT`); } catch (e) { if (e.code !== '42701') throw e; }
      try { await client.query(`ALTER TABLE job_results ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`); } catch (e) { if (e.code !== '42701') throw e; }
      await client.query(`
        CREATE TABLE IF NOT EXISTS subscriptions (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          stripe_subscription_id TEXT,
          plan_name TEXT,
          status TEXT NOT NULL,
          current_period_start TIMESTAMP,
          current_period_end TIMESTAMP,
          cancel_at_period_end BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
      // Ensure column exists
      try { await client.query("ALTER TABLE subscriptions ADD COLUMN cancel_at_period_end BOOLEAN DEFAULT FALSE"); } catch (e) { if (e.code !== '42701') throw e; }
      await client.query(`
        CREATE TABLE IF NOT EXISTS credit_ledger (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          amount INTEGER NOT NULL,
          reason TEXT,
          job_id INTEGER,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS wallets (
          user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          balance_ath REAL DEFAULT 0,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
      try {
        const hasOld = await client.query("SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='wallets' AND column_name='balance_zeta'");
        const hasNew = await client.query("SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='wallets' AND column_name='balance_ath'");
        if (hasOld.rows.length && !hasNew.rows.length) {
          await client.query('ALTER TABLE wallets RENAME COLUMN balance_zeta TO balance_ath');
        }
      } catch (_) {}
      await client.query(`
        CREATE TABLE IF NOT EXISTS wallet_events (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          type TEXT NOT NULL,
          amount REAL NOT NULL,
          metadata TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS banned_ips (
          id SERIAL PRIMARY KEY,
          ip_address TEXT UNIQUE NOT NULL,
          reason TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS rewards_ledger (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          session_id INTEGER,
          amount INTEGER NOT NULL,
          reason TEXT,
          details TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS referrals (
          id SERIAL PRIMARY KEY,
          referrer_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          referred_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          level INTEGER NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
      try { await client.query(`CREATE INDEX idx_referrals_referrer ON referrals (referrer_user_id)`); } catch (e) { if (e.code !== '42P07' && e.code !== '42710') throw e; }
      try { await client.query(`CREATE INDEX idx_referrals_referred ON referrals (referred_user_id)`); } catch (e) { if (e.code !== '42P07' && e.code !== '42710') throw e; }
      try {
        await client.query(`
          INSERT INTO referrals (referrer_user_id, referred_user_id, level)
          SELECT u.referrer_id, u.id, 1
          FROM users u
          WHERE u.referrer_id IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM referrals r WHERE r.referred_user_id = u.id
            )
        `);
      } catch (_) {}
      await client.query(`
        CREATE TABLE IF NOT EXISTS stakes (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          principal REAL NOT NULL,
          apy REAL NOT NULL,
          start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS tasks (
          id SERIAL PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT,
          type TEXT,
          link_url TEXT,
          reward_points INTEGER DEFAULT 0,
          reward_airdrop_bonus_percent INTEGER DEFAULT 0,
          active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS user_tasks (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          status VARCHAR(50) DEFAULT 'not_started',
          timestamp_started TIMESTAMP,
          timestamp_approved TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
      
      // Support System Tables
      await client.query(`
        CREATE TABLE IF NOT EXISTS support_tickets (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          subject TEXT,
          status VARCHAR(50) DEFAULT 'open',
          priority VARCHAR(50) DEFAULT 'medium',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS support_messages (
          id SERIAL PRIMARY KEY,
          ticket_id INTEGER NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
          sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          sender_role TEXT NOT NULL,
          message TEXT,
          attachment_url TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

      try { await client.query(`CREATE INDEX idx_tasks_active_created ON tasks (active, created_at)`); } catch (e) { if (e.code !== '42P07' && e.code !== '42710') throw e; }
      try {
        await client.query(`ALTER TABLE tasks ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);
      } catch (e) {
        if (e.code !== '42701') throw e;
      }
      try { await client.query(`CREATE INDEX idx_user_tasks_user_status ON user_tasks (user_id, status)`); } catch (e) { if (e.code !== '42P07' && e.code !== '42710') throw e; }
      try { await client.query(`ALTER TABLE user_tasks ADD COLUMN timestamp_started TIMESTAMP`); } catch (e) { if (e.code !== '42701') throw e; }
      try { await client.query(`ALTER TABLE user_tasks ADD COLUMN timestamp_approved TIMESTAMP`); } catch (e) { if (e.code !== '42701') throw e; }
      try { await client.query(`ALTER TABLE user_tasks ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`); } catch (e) { if (e.code !== '42701') throw e; }
      try { await client.query(`CREATE UNIQUE INDEX idx_user_tasks_unique ON user_tasks (user_id, task_id)`); } catch (e) { if (e.code !== '42P07' && e.code !== '42710') throw e; }
      
      // Settings & Admin Logs
      await client.query(`
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS admin_logs (
          id SERIAL PRIMARY KEY,
          admin_id INTEGER,
          action TEXT,
          details TEXT,
          ip_address TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

      // Normalize rewards trigger: ensure single trigger and consistent function
      try { await client.query(`DROP TRIGGER trg_rewards_ledger_add_points ON rewards_ledger`); } catch (e) { if (e.code !== '42704') throw e; }
      try { await client.query(`DROP TRIGGER trigger_update_user_points ON rewards_ledger`); } catch (e) { if (e.code !== '42704') throw e; }
      await client.query(`
        CREATE OR REPLACE FUNCTION add_points_on_rewards_ledger() RETURNS trigger AS $$
        BEGIN
          UPDATE users
          SET total_points = COALESCE(total_points,0) + NEW.amount
          WHERE id = NEW.user_id;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
      `);
      await client.query(`
        CREATE TRIGGER trigger_update_user_points
        AFTER INSERT ON rewards_ledger
        FOR EACH ROW EXECUTE FUNCTION add_points_on_rewards_ledger()
      `);
      console.log('✅ PostgreSQL shop/orders tables ensured');
      const checkTable = async (name) => {
        const r = await client.query(`SELECT to_regclass('public.${name}') AS reg`);
        console.log(`${r.rows[0]?.reg ? '✅' : '❌'} Table ${name} ${r.rows[0]?.reg ? 'présente' : 'absente'}`);
      };
      await checkTable('shop_items');
      await checkTable('user_entitlements');
      await checkTable('orders');
      await checkTable('wallets');
      await checkTable('wallet_events');
      const c = await client.query("SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='sessions' AND column_name='name'");
      console.log(`${c.rows.length ? '✅' : '❌'} Colonne sessions.name ${c.rows.length ? 'présente' : 'absente'}`);
      if (!c.rows.length) {
        await client.query("ALTER TABLE sessions ADD COLUMN name TEXT");
        console.log('✅ Colonne sessions.name ajoutée');
      }
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('PostgreSQL schema init error:', e);
  }
}

async function ensureMySqlSchema() {
  try {
    const client = await db.getClient();
    try {
      await client.query(`CREATE TABLE IF NOT EXISTS users (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        email VARCHAR(255) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        username VARCHAR(100) NOT NULL,
        wallet_address VARCHAR(255),
        solana_address VARCHAR(255),
        profile_picture_url VARCHAR(255),
        total_points INT DEFAULT 0,
        trust_score INT DEFAULT 100,
        is_active BOOLEAN DEFAULT TRUE,
        is_banned BOOLEAN DEFAULT FALSE,
        role VARCHAR(20) DEFAULT 'user',
        referral_code VARCHAR(64),
        referrer_id BIGINT UNSIGNED,
        \`rank\` VARCHAR(50) DEFAULT 'Bronze',
        google_sub VARCHAR(255),
        stripe_customer_id VARCHAR(255),
        is_admin BOOLEAN DEFAULT FALSE,
        airdrop_score DOUBLE DEFAULT 0,
        airdrop_allocation DOUBLE DEFAULT 0,
        last_airdrop_calculation TIMESTAMP NULL,
        twofa_enabled BOOLEAN DEFAULT FALSE,
        twofa_secret VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        last_login TIMESTAMP NULL,
        PRIMARY KEY (id),
        UNIQUE INDEX uq_users_email (email),
        UNIQUE INDEX uq_users_username (username),
        UNIQUE INDEX uq_users_referral_code (referral_code),
        INDEX idx_users_referrer (referrer_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

      await client.query(`CREATE TABLE IF NOT EXISTS sessions (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id BIGINT UNSIGNED NOT NULL,
        name VARCHAR(255),
        session_token VARCHAR(255) UNIQUE,
        ip_address VARCHAR(45),
        user_agent TEXT,
        start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        end_time TIMESTAMP NULL,
        last_ping TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        is_active BOOLEAN DEFAULT TRUE,
        peers_connected INT DEFAULT 0,
        status VARCHAR(50) DEFAULT 'active',
        PRIMARY KEY (id),
        INDEX idx_sessions_user_id (user_id),
        INDEX idx_sessions_active (is_active),
        CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

      try {
        await client.query("ALTER TABLE sessions ADD COLUMN name VARCHAR(255) AFTER user_id");
        console.log('✅ MySQL sessions.name column added');
      } catch (_) {
        // Column likely already exists
      }

      await client.query(`CREATE TABLE IF NOT EXISTS bandwidth_logs (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        session_id BIGINT UNSIGNED NOT NULL,
        user_id BIGINT UNSIGNED NOT NULL,
        bytes_sent BIGINT DEFAULT 0,
        bytes_received BIGINT DEFAULT 0,
        duration_seconds INT DEFAULT 0,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        verified BOOLEAN DEFAULT FALSE,
        PRIMARY KEY (id),
        INDEX idx_bandwidth_logs_session (session_id),
        INDEX idx_bandwidth_logs_user (user_id),
        INDEX idx_bandwidth_logs_timestamp (timestamp),
        CONSTRAINT fk_bandwidth_logs_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
        CONSTRAINT fk_bandwidth_logs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

      await client.query(`CREATE TABLE IF NOT EXISTS daily_stats (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id BIGINT UNSIGNED NOT NULL,
        date DATE NOT NULL,
        total_time_seconds INT DEFAULT 0,
        total_bytes_sent BIGINT DEFAULT 0,
        total_bytes_received BIGINT DEFAULT 0,
        total_points_earned INT DEFAULT 0,
        sessions_count INT DEFAULT 0,
        PRIMARY KEY (id),
        UNIQUE INDEX uq_daily_stats_user_date (user_id, date),
        INDEX idx_daily_stats_user (user_id),
        INDEX idx_daily_stats_date (date),
        CONSTRAINT fk_daily_stats_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

      await client.query(`CREATE TABLE IF NOT EXISTS fraud_logs (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id BIGINT UNSIGNED,
        session_id BIGINT UNSIGNED,
        fraud_type VARCHAR(100) NOT NULL,
        description TEXT,
        severity VARCHAR(20) DEFAULT 'low',
        ip_address VARCHAR(45),
        detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        INDEX idx_fraud_logs_user (user_id),
        INDEX idx_fraud_logs_session (session_id),
        INDEX idx_fraud_logs_detected (detected_at),
        CONSTRAINT fk_fraud_logs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_fraud_logs_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

      await client.query(`CREATE TABLE IF NOT EXISTS peer_connections (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        session_id BIGINT UNSIGNED NOT NULL,
        peer_user_id BIGINT UNSIGNED,
        peer_session_id BIGINT UNSIGNED,
        connected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        disconnected_at TIMESTAMP NULL,
        bytes_exchanged BIGINT DEFAULT 0,
        PRIMARY KEY (id),
        INDEX idx_peer_connections_session (session_id),
        INDEX idx_peer_connections_peer_user (peer_user_id),
        CONSTRAINT fk_peer_connections_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

      await client.query(`CREATE TABLE IF NOT EXISTS referrals (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        referrer_user_id BIGINT UNSIGNED NOT NULL,
        referred_user_id BIGINT UNSIGNED NOT NULL,
        level INT DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE INDEX uq_referrals_pair (referrer_user_id, referred_user_id),
        INDEX idx_referrals_referrer (referrer_user_id),
        INDEX idx_referrals_referred (referred_user_id),
        CONSTRAINT fk_referrals_referrer FOREIGN KEY (referrer_user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_referrals_referred FOREIGN KEY (referred_user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

      await client.query(`CREATE TABLE IF NOT EXISTS api_keys (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id BIGINT UNSIGNED NOT NULL,
        api_key_hash TEXT NOT NULL,
        active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_used TIMESTAMP NULL,
        PRIMARY KEY (id),
        INDEX idx_api_keys_user (user_id),
        INDEX idx_api_keys_active (active),
        CONSTRAINT fk_api_keys_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

      await client.query(`CREATE TABLE IF NOT EXISTS enterprise_credits (
        user_id BIGINT UNSIGNED NOT NULL,
        credits_balance BIGINT DEFAULT 0,
        credits_used_month BIGINT DEFAULT 0,
        reset_date TIMESTAMP NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id),
        CONSTRAINT fk_enterprise_credits_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

      await client.query(`CREATE TABLE IF NOT EXISTS jobs (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id BIGINT UNSIGNED NOT NULL,
        type VARCHAR(50) NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'queued',
        params_json TEXT,
        payload JSON,
        result JSON,
        credits_cost BIGINT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        INDEX idx_jobs_user (user_id),
        INDEX idx_jobs_status_created_at (status, created_at),
        CONSTRAINT fk_jobs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

      await client.query(`CREATE TABLE IF NOT EXISTS job_results (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        job_id BIGINT UNSIGNED NOT NULL,
        result_json TEXT,
        error_text TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE INDEX uq_job_results_job_id (job_id),
        INDEX idx_job_results_job_id (job_id),
        CONSTRAINT fk_job_results_job FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

      await client.query(`CREATE TABLE IF NOT EXISTS subscriptions (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id BIGINT UNSIGNED NOT NULL,
        stripe_subscription_id TEXT,
        plan_name TEXT,
        status VARCHAR(50) NOT NULL,
        current_period_start TIMESTAMP NULL,
        current_period_end TIMESTAMP NULL,
        cancel_at_period_end BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        INDEX idx_subscriptions_user (user_id),
        INDEX idx_subscriptions_status (status),
        CONSTRAINT fk_subscriptions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

      await client.query(`CREATE TABLE IF NOT EXISTS shop_items (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        type VARCHAR(50) NOT NULL,
        price DOUBLE NOT NULL,
        currency VARCHAR(10) DEFAULT 'EUR',
        active BOOLEAN DEFAULT TRUE,
        metadata TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        INDEX idx_shop_items_active (active)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

      await client.query(`CREATE TABLE IF NOT EXISTS user_entitlements (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id BIGINT UNSIGNED NOT NULL,
        feature VARCHAR(100) NOT NULL,
        active BOOLEAN DEFAULT TRUE,
        metadata TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE INDEX uq_user_entitlements_user_feature (user_id, feature),
        INDEX idx_user_entitlements_user (user_id),
        CONSTRAINT fk_user_entitlements_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

      await client.query(`CREATE TABLE IF NOT EXISTS orders (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id BIGINT UNSIGNED NOT NULL,
        item_id BIGINT UNSIGNED NOT NULL,
        qty INT DEFAULT 1,
        unit_price DOUBLE NOT NULL,
        total_price DOUBLE NOT NULL,
        status VARCHAR(50) DEFAULT 'created',
        metadata TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        INDEX idx_orders_user (user_id),
        INDEX idx_orders_status (status),
        CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_orders_item FOREIGN KEY (item_id) REFERENCES shop_items(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

      await client.query(`CREATE TABLE IF NOT EXISTS wallets (
        user_id BIGINT UNSIGNED NOT NULL,
        balance_ath DOUBLE DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id),
        CONSTRAINT fk_wallets_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

      await client.query(`CREATE TABLE IF NOT EXISTS stakes (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id BIGINT UNSIGNED NOT NULL,
        principal DOUBLE NOT NULL,
        apy DOUBLE NOT NULL,
        start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        INDEX idx_stakes_user (user_id),
        CONSTRAINT fk_stakes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

      await client.query(`CREATE TABLE IF NOT EXISTS wallet_events (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id BIGINT UNSIGNED NOT NULL,
        type TEXT NOT NULL,
        amount DOUBLE NOT NULL,
        metadata TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        INDEX idx_wallet_events_user (user_id),
        CONSTRAINT fk_wallet_events_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

      await client.query(`CREATE TABLE IF NOT EXISTS banned_ips (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        ip_address VARCHAR(45) NOT NULL,
        reason TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE INDEX uq_banned_ips_ip (ip_address)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

      await client.query(`CREATE TABLE IF NOT EXISTS credit_ledger (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id BIGINT UNSIGNED NOT NULL,
        amount BIGINT NOT NULL,
        reason TEXT,
        job_id BIGINT UNSIGNED NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        INDEX idx_credit_ledger_user (user_id),
        INDEX idx_credit_ledger_created (created_at),
        INDEX idx_credit_ledger_job (job_id),
        CONSTRAINT fk_credit_ledger_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

      await client.query(`CREATE TABLE IF NOT EXISTS rewards_ledger (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id BIGINT UNSIGNED NOT NULL,
        session_id BIGINT UNSIGNED NULL,
        amount INT NOT NULL,
        reason VARCHAR(100),
        details JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        INDEX idx_rewards_ledger_user (user_id),
        INDEX idx_rewards_ledger_created (created_at),
        CONSTRAINT fk_rewards_ledger_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

      await client.query(`CREATE TABLE IF NOT EXISTS tasks (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        type VARCHAR(50),
        link_url VARCHAR(500),
        reward_points INT DEFAULT 0,
        reward_airdrop_bonus_percent INT DEFAULT 0,
        active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        INDEX idx_tasks_active_created (active, created_at),
        INDEX idx_tasks_type (type)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

      await client.query(`CREATE TABLE IF NOT EXISTS user_tasks (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id BIGINT UNSIGNED NOT NULL,
        task_id BIGINT UNSIGNED NOT NULL,
        status VARCHAR(20) DEFAULT 'not_started',
        timestamp_started TIMESTAMP NULL,
        timestamp_approved TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE INDEX uq_user_tasks_user_task (user_id, task_id),
        INDEX idx_user_tasks_user_status (user_id, status),
        CONSTRAINT fk_user_tasks_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_user_tasks_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

      await client.query(`CREATE TABLE IF NOT EXISTS support_tickets (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id BIGINT UNSIGNED NOT NULL,
        subject TEXT,
        status VARCHAR(20) DEFAULT 'open',
        priority VARCHAR(20) DEFAULT 'medium',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        INDEX idx_support_tickets_user (user_id),
        CONSTRAINT fk_support_tickets_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

      await client.query(`CREATE TABLE IF NOT EXISTS support_messages (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        ticket_id BIGINT UNSIGNED NOT NULL,
        sender_id BIGINT UNSIGNED NOT NULL,
        sender_role VARCHAR(20) NOT NULL,
        message TEXT,
        attachment_url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        INDEX idx_support_messages_ticket (ticket_id),
        CONSTRAINT fk_support_messages_ticket FOREIGN KEY (ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

      await client.query(`CREATE TABLE IF NOT EXISTS settings (
        \`key\` VARCHAR(50) NOT NULL,
        value TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`key\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

      await client.query(`CREATE TABLE IF NOT EXISTS admin_logs (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        admin_id BIGINT UNSIGNED NOT NULL,
        action VARCHAR(50) NOT NULL,
        details TEXT,
        ip_address VARCHAR(45),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        INDEX idx_admin_logs_admin (admin_id),
        CONSTRAINT fk_admin_logs_admin FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

      await client.query(`CREATE TABLE IF NOT EXISTS early_adopters (
        user_id BIGINT UNSIGNED NOT NULL,
        first_ping_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        is_gold BOOLEAN DEFAULT FALSE,
        aether_awarded DOUBLE DEFAULT 0,
        PRIMARY KEY (user_id),
        CONSTRAINT fk_early_adopters_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

      await client.query(`INSERT IGNORE INTO settings (\`key\`, value) VALUES ('withdrawals_enabled', 'false')`);
      console.log('✅ MySQL schema initialized / ensured');
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('MySQL schema init error:', e);
  }
}

async function ensureAdminSeed() {
  try {
    const existing = await db.query('SELECT * FROM users WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($2)', ['korn666', 'korn666']);
    if (existing.rows.length === 0) {
      const hash = await bcrypt.hash('741852963', 10);
      await db.query(
        `INSERT INTO users (email, password_hash, username, role, is_active, created_at)
         VALUES ($1, $2, $3, $4, true, CURRENT_TIMESTAMP)`,
        ['korn666', hash, 'korn666', 'admin']
      );
      console.log('✅ Admin seed created: korn666');
    } else {
      const u = existing.rows[0];
      await db.query('UPDATE users SET role = $1, is_active = true WHERE id = $2', ['admin', u.id]);
      console.log('✅ Admin role ensured for user:', u.username);
    }
  } catch (e) {
    console.error('Admin seed error:', e);
  }
}
const initRun = db.isSQLite ? ensureSqliteMigrations() : (db.isMySQL ? ensureMySqlSchema() : ensurePostgresSchema());

async function ensureAdminApiKeyAndTopup() {
  try {
    if ((config.nodeEnv || 'development') !== 'development') return;
    const u = await db.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', ['korn666']);
    if (u.rows.length === 0) return;
    const userId = u.rows[0].id;
    await db.query('UPDATE api_keys SET active = FALSE WHERE user_id = $1', [userId]);
    const crypto = require('crypto');
    const full = [crypto.randomBytes(3).toString('hex'), crypto.randomBytes(3).toString('hex'), crypto.randomBytes(3).toString('hex'), crypto.randomBytes(3).toString('hex')].join('-');
    const hash = crypto.createHash('sha256').update(full).digest('hex');
    await db.query('INSERT INTO api_keys (user_id, api_key_hash, active) VALUES ($1, $2, TRUE)', [userId, hash]);
    const c = await db.query('SELECT user_id FROM enterprise_credits WHERE user_id = $1', [userId]);
    if (c.rows.length === 0) await db.query('INSERT INTO enterprise_credits (user_id, credits_balance, credits_used_month) VALUES ($1, 0, 0)', [userId]);
    await db.query('UPDATE enterprise_credits SET credits_balance = credits_balance + $1 WHERE user_id = $2', [250000, userId]);
    await db.query('INSERT INTO credit_ledger (user_id, amount, reason) VALUES ($1, $2, $3)', [userId, 250000, 'dev_seed_topup']);
    console.log(`🔑 Dev API Key for korn666: ${full}`);
  } catch (e) {
    console.error('Dev admin API key seed error:', e);
  }
}
// Defer server start until migrations complete to avoid race conditions

// Socket.IO pour signaling WebRTC
const hardcodedAllowedOrigins = [
  'https://azurus333.github.io',
  'http://127.0.0.1:8080',
  'https://revolution-network.fr',
  'https://www.revolution-network.fr',
  'http://revolution-network.fr',
  'http://www.revolution-network.fr',
];

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (origin === config.cors.frontendUrl) return true;
  if (hardcodedAllowedOrigins.includes(origin)) return true;
  if (origin.startsWith('http://localhost')) return true;
  if (origin.startsWith('http://127.0.0.1')) return true;
  if (origin.startsWith('chrome-extension://')) return true;
  if (origin.endsWith('.revolution-network.fr')) return true;
  return false;
}

const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin)) return callback(null, true);
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  },
});

// Middleware
app.use(helmet());
app.use(helmet.hsts({ maxAge: 15552000, includeSubDomains: true, preload: false }));
app.use(helmet.contentSecurityPolicy({
  useDefaults: true,
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: [
      "'self'",
      "https://accounts.google.com",
      "https://js.stripe.com"
    ],
    styleSrc: [
      "'self'",
      "'unsafe-inline'",
      "https://fonts.googleapis.com"
    ],
    fontSrc: [
      "'self'",
      "data:",
      "https://fonts.gstatic.com"
    ],
    imgSrc: [
      "'self'",
      "data:",
      "https://revolution-network.fr",
      "https://www.revolution-network.fr"
    ],
    connectSrc: [
      "'self'",
      "https://revolution-backend-sal2.onrender.com",
      "https://revolution-network.fr",
      "https://www.revolution-network.fr",
      "wss:",
      "https:"
    ],
    frameSrc: [
      "'self'",
      "https://js.stripe.com",
      "https://accounts.google.com"
    ],
    frameAncestors: ["'none'"],
    upgradeInsecureRequests: []
  }
}));
app.use(cors({
  origin: (origin, callback) => {
    if (isAllowedOrigin(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  allowedHeaders: ['Authorization', 'Content-Type', 'x-api-key', 'X-API-KEY'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
}));
app.options('*', cors());
app.use((req, res, next) => {
  req.requestId = crypto.randomUUID();
  next();
});
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const path = require('path');
app.use('/public', express.static(path.join(__dirname, '../public')));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Rate limiting (renvoie du JSON pour éviter les erreurs de parsing côté frontend)
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  validate: {
    xForwardedForHeader: false
  },
  message: { error: 'too_many_requests', message: 'Too many requests from this IP, please try again later.' },
});
// Skip limiting for auth, admin and health endpoints to avoid blocking login/refresh and admin actions
app.use('/api/', (req, res, next) => {
  if (req.path.startsWith('/auth') || req.path.startsWith('/admin') || req.path === '/health') return next();
  return apiLimiter(req, res, next);
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
// Auto-minage planifié pour utilisateurs éligibles
setInterval(async () => {
  try {
    // Pre-calc mining bonus per user (sum of approved tasks' reward_airdrop_bonus_percent)
    let bonusMap = new Map();
    try {
      const b = await db.query(`
        SELECT ut.user_id, COALESCE(SUM(t.reward_airdrop_bonus_percent),0) AS bonus
        FROM user_tasks ut
        JOIN tasks t ON ut.task_id = t.id
        WHERE ut.status = 'approved'
        GROUP BY ut.user_id`);
      for (const r of b.rows) bonusMap.set(r.user_id, Number(r.bonus)||0);
    } catch (_) {}
    const eligible = (await db.query(`SELECT user_id, metadata FROM user_entitlements WHERE feature = 'auto_mining' AND ${db.isSQLite ? 'active = 1' : 'active = TRUE'}`)).rows;
    for (const e of eligible) {
      let rate = 10; // points/10min par défaut
      try { const m = JSON.parse(e.metadata || '{}'); if (m.pointsPerHour) rate = Math.max(1, Math.floor(m.pointsPerHour / 6)); } catch {}
      const bonus = Number(bonusMap.get(e.user_id)) || 0;
      const final = Math.max(1, Math.floor(rate * (1 + (bonus/100))));
      await db.query(`INSERT INTO rewards_ledger (user_id, amount, reason, details) VALUES ($1, $2, $3, $4)`, [e.user_id, final, 'auto_mining', JSON.stringify({ interval: '10min', bonus_percent: bonus })]);
      await db.query(`UPDATE users SET total_points = COALESCE(total_points,0) + $1 WHERE id = $2`, [final, e.user_id]);
      try {
        const tp = await db.query('SELECT total_points, role, username, COALESCE(is_rank_locked, 0) as is_rank_locked FROM users WHERE id = $1', [e.user_id]);
        const u = tp.rows[0] || {};
        const pts = Number(u.total_points)||0;
        const isAdminUser = (u.role && u.role.toLowerCase() === 'admin') || (u.username && u.username.toLowerCase() === 'korn666');
        if (isAdminUser || u.is_rank_locked) continue;
        let rc = 0;
        try {
          if (db.isSQLite) {
            rc = Number((await db.query('SELECT COUNT(*) AS c FROM users WHERE referrer_id = $1', [e.user_id])).rows[0]?.c)||0;
          } else {
            rc = Number((await db.query('SELECT COUNT(*) AS c FROM referrals WHERE referrer_user_id = $1', [e.user_id])).rows[0]?.c)||0;
          }
        } catch {}
        let rank = 'Bronze';
        if (pts >= 10000000 || rc >= 100) rank = 'Diamond';
        else if (pts >= 1500000 || rc >= 25) rank = 'Platinum';
        else if (pts >= 25000) rank = 'Gold';
        else if (pts >= 5000 || rc >= 1) rank = 'Silver';
        await db.query('UPDATE users SET rank = $1 WHERE id = $2', [rank, e.user_id]);
      } catch {}
      try {
        const rr = await db.query('SELECT referrer_id FROM users WHERE id = $1', [e.user_id]);
        const referrerId = rr.rows[0]?.referrer_id || null;
        if (referrerId) {
          const refBonus = Math.floor(final * 0.05);
          if (refBonus > 0) {
            await db.query(`INSERT INTO rewards_ledger (user_id, amount, reason, details) VALUES ($1,$2,$3,$4)`, [referrerId, refBonus, 'referral_bonus', JSON.stringify({ from_user_id: e.user_id, source: 'auto_mining' })]);
            await db.query(`UPDATE users SET total_points = COALESCE(total_points,0) + $1 WHERE id = $2`, [refBonus, referrerId]);
            await db.query("UPDATE users SET rank = CASE WHEN COALESCE(is_rank_locked, 0) = 1 THEN rank WHEN COALESCE(rank,'Bronze') = 'Bronze' THEN 'Silver' ELSE rank END WHERE id = $1", [referrerId]);
            try {
              const tp2 = await db.query('SELECT total_points, COALESCE(is_rank_locked, 0) as is_rank_locked FROM users WHERE id = $1', [referrerId]);
              const u2 = tp2.rows[0] || {};
              if (u2.is_rank_locked) {
                // Rang verrouillé, on ne touche pas au calcul auto
              } else {
                const pts2 = Number(u2.total_points)||0;
                let rc2 = 0;
                try {
                  if (db.isSQLite) {
                    rc2 = Number((await db.query('SELECT COUNT(*) AS c FROM users WHERE referrer_id = $1', [referrerId])).rows[0]?.c)||0;
                  } else {
                    rc2 = Number((await db.query('SELECT COUNT(*) AS c FROM referrals WHERE referrer_user_id = $1', [referrerId])).rows[0]?.c)||0;
                  }
                } catch {}
                let rank2 = 'Bronze';
                if (pts2 >= 10000000 || rc2 >= 100) rank2 = 'Diamond';
                else if (pts2 >= 1500000 || rc2 >= 25) rank2 = 'Platinum';
                else if (pts2 >= 25000) rank2 = 'Gold';
                else if (pts2 >= 5000 || rc2 >= 1) rank2 = 'Silver';
                await db.query('UPDATE users SET rank = $1 WHERE id = $2', [rank2, referrerId]);
              }
            } catch {}
          }
        }
      } catch {}
    }
    // S'assurer que les acheteurs historiques de Node (Passif) ont un entitlement actif
    try {
      const missingNodes = (await db.query(
        `SELECT we.user_id, COALESCE(SUM(we.amount),0) AS qty
         FROM wallet_events we
         WHERE we.type = 'nft_node'
           AND NOT EXISTS (
             SELECT 1 FROM user_entitlements ue
             WHERE ue.user_id = we.user_id
               AND ue.feature = 'node_nft'
               AND ${db.isSQLite ? 'ue.active = 1' : 'ue.active = TRUE'}
           )
         GROUP BY we.user_id`
      )).rows;
      const activeVal = db.isSQLite ? 1 : true;
      for (const m of missingNodes) {
        await db.query(
          `INSERT INTO user_entitlements (user_id, feature, active, metadata)
           VALUES ($1, 'node_nft', $2, $3)`,
          [m.user_id, activeVal, null]
        );
      }
    } catch (e) {
      console.error('Node NFT entitlement sync error:', e);
    }
    const nodeEligible = (await db.query(`SELECT user_id, metadata FROM user_entitlements WHERE feature = 'node_nft' AND ${db.isSQLite ? 'active = 1' : 'active = TRUE'}`)).rows;
    for (const e of nodeEligible) {
      let base = 10;
      try { const m = JSON.parse(e.metadata || '{}'); if (m.pointsPerHour) base = Math.max(1, Math.floor(m.pointsPerHour / 6)); } catch {}
      const rate = Math.max(1, Math.floor(base * 15));
      const bonus = Number(bonusMap.get(e.user_id)) || 0;
      const final = Math.max(1, Math.floor(rate * (1 + (bonus/100))));
      await db.query(`INSERT INTO rewards_ledger (user_id, amount, reason, details) VALUES ($1, $2, $3, $4)`, [e.user_id, final, 'node_nft', JSON.stringify({ interval: '10min', factor: 15, bonus_percent: bonus })]);
      await db.query(`UPDATE users SET total_points = COALESCE(total_points,0) + $1 WHERE id = $2`, [final, e.user_id]);
      try {
        const tp = await db.query('SELECT total_points, role, username, COALESCE(is_rank_locked, 0) as is_rank_locked FROM users WHERE id = $1', [e.user_id]);
        const u = tp.rows[0] || {};
        const pts = Number(u.total_points)||0;
        const isAdminUser = (u.role && u.role.toLowerCase() === 'admin') || (u.username && u.username.toLowerCase() === 'korn666');
        if (isAdminUser || u.is_rank_locked) {
          // Si admin ou rang verrouillé, on saute la mise à jour auto du rang
        } else {
          let rc = 0;
          try {
            if (db.isSQLite) {
              rc = Number((await db.query('SELECT COUNT(*) AS c FROM users WHERE referrer_id = $1', [e.user_id])).rows[0]?.c)||0;
            } else {
              rc = Number((await db.query('SELECT COUNT(*) AS c FROM referrals WHERE referrer_user_id = $1', [e.user_id])).rows[0]?.c)||0;
            }
          } catch {}
          let rank = 'Bronze';
          if (pts >= 10000000 || rc >= 100) rank = 'Diamond';
          else if (pts >= 1500000 || rc >= 25) rank = 'Platinum';
          else if (pts >= 25000) rank = 'Gold';
          else if (pts >= 5000 || rc >= 1) rank = 'Silver';
          await db.query('UPDATE users SET rank = $1 WHERE id = $2', [rank, e.user_id]);
        }
      } catch {}
      try {
        const rr = await db.query('SELECT referrer_id FROM users WHERE id = $1', [e.user_id]);
        const referrerId = rr.rows[0]?.referrer_id || null;
        if (referrerId) {
          const refBonus = Math.floor(final * 0.05);
          if (refBonus > 0) {
            await db.query(`INSERT INTO rewards_ledger (user_id, amount, reason, details) VALUES ($1,$2,$3,$4)`, [referrerId, refBonus, 'referral_bonus', JSON.stringify({ from_user_id: e.user_id, source: 'node_nft' })]);
            await db.query(`UPDATE users SET total_points = COALESCE(total_points,0) + $1 WHERE id = $2`, [refBonus, referrerId]);
            await db.query("UPDATE users SET rank = CASE WHEN COALESCE(is_rank_locked, 0) = 1 THEN rank WHEN COALESCE(rank,'Bronze') = 'Bronze' THEN 'Silver' ELSE rank END WHERE id = $1", [referrerId]);
            try {
              const tp2 = await db.query('SELECT total_points, COALESCE(is_rank_locked, 0) as is_rank_locked FROM users WHERE id = $1', [referrerId]);
              const u2 = tp2.rows[0] || {};
              if (u2.is_rank_locked) {
                // Rang verrouillé
              } else {
                const pts2 = Number(u2.total_points)||0;
                let rc2 = 0;
                try {
                  if (db.isSQLite) {
                    rc2 = Number((await db.query('SELECT COUNT(*) AS c FROM users WHERE referrer_id = $1', [referrerId])).rows[0]?.c)||0;
                  } else {
                    rc2 = Number((await db.query('SELECT COUNT(*) AS c FROM referrals WHERE referrer_user_id = $1', [referrerId])).rows[0]?.c)||0;
                  }
                } catch {}
                let rank2 = 'Bronze';
                if (pts2 >= 10000000 || rc2 >= 100) rank2 = 'Diamond';
                else if (pts2 >= 1500000 || rc2 >= 25) rank2 = 'Platinum';
                else if (pts2 >= 25000) rank2 = 'Gold';
                else if (pts2 >= 5000 || rc2 >= 1) rank2 = 'Silver';
                await db.query('UPDATE users SET rank = $1 WHERE id = $2', [rank2, referrerId]);
              }
            } catch {}
          }
        }
      } catch {}
    }
  } catch (err) {
    console.error('Auto-mining scheduler error:', err);
  }
}, 10 * 60 * 1000);
app.get('/metrics', async (req, res) => {
  try {
    const q = async (sql, params=[]) => (await db.query(sql, params)).rows[0]?.count || 0;
    const queued = await q("SELECT COUNT(*) as count FROM jobs WHERE status = 'queued'");
    const running = await q("SELECT COUNT(*) as count FROM jobs WHERE status = 'running'");
    const completed = await q("SELECT COUNT(*) as count FROM jobs WHERE status = 'completed'");
    const failed = await q("SELECT COUNT(*) as count FROM jobs WHERE status = 'failed'");
    res.json({ jobs: { queued, running, completed, failed } });
  } catch (e) {
    res.status(500).json({ error: 'metrics_error' });
  }
});
app.get('/api/leaderboard', async (req, res) => {
  try {
    const rows = (await db.query(
      `SELECT id, username, total_points, \`rank\`
       FROM users
       WHERE COALESCE(is_banned, false) = false
       ORDER BY total_points DESC
       LIMIT 100`
    )).rows;
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
      users.push({
        username: u.username,
        grade: u.rank || null,
        points: u.total_points || 0,
        referrals: Number(refCount) || 0,
        final_airdrop_score: (u.total_points || 0) + (Number(refCount) * 100),
      });
    }
    res.json({ users });
  } catch (e) {
    console.error('Public leaderboard error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/session', sessionRoutes);
app.use('/api/rewards', rewardsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/enterprise', enterpriseRoutes);
app.use('/api/shop', shopRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api', tasksRoutes);
app.use('/api/support', supportRoutes);
app.get('/api/public/config', (req, res) => {
  res.json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || null
  });
});

// Téléchargement direct de l'extension Chrome sous forme ZIP
app.get('/api/download/extension', async (req, res) => {
  try {
    const path = require('path');
    const fs = require('fs');
    const os = require('os');
    const { exec } = require('child_process');
    const rootDir = path.join(__dirname, '..', '..');
    const srcDir = path.join(rootDir, 'chrome-extension');
    const remoteZip = process.env.EXTENSION_ZIP_URL || 'https://azurus333.github.io/Revolution-Network/chrome-extension.zip';
    if (req.query && (req.query.check === '1' || req.query.check === 'true')) {
      if (fs.existsSync(srcDir) || remoteZip) return res.status(204).end();
      return res.status(404).json({ error: 'chrome-extension introuvable' });
    }
    if (!fs.existsSync(srcDir)) {
      if (remoteZip) {
        return res.redirect(302, remoteZip);
      }
      return res.status(404).json({ error: 'chrome-extension introuvable' });
    }
    const tmpZip = path.join(os.tmpdir(), `revolution-chrome-extension-${Date.now()}.zip`);
    const isWin = process.platform === 'win32';
    const makeZip = () => new Promise((resolve, reject) => {
      if (isWin) {
        const cmd = `powershell -NoProfile -Command "Compress-Archive -Path '${srcDir}${path.sep}*' -DestinationPath '${tmpZip}' -Force"`;
        exec(cmd, { windowsHide: true }, (err) => err ? reject(err) : resolve(tmpZip));
      } else {
        const cmd = `cd "${srcDir}" && zip -r "${tmpZip}" .`;
        exec(cmd, (err) => err ? reject(err) : resolve(tmpZip));
      }
    });
    const zipPath = await makeZip();
    res.download(zipPath, 'revolution-chrome-extension.zip', (err) => {
      try { fs.unlinkSync(zipPath); } catch {}
      if (err) console.error('Download error:', err);
    });
  } catch (e) {
    console.error('Extension download error:', e);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

// WebRTC Signaling avec Socket.IO
const signalingService = new SignalingService(io);
signalingService.initialize();

// Rewards Service (calcul périodique)
const rewardsService = new RewardsService();
rewardsService.startPeriodicCalculation();

// Enterprise Jobs Service
const EnterpriseJobsService = require('./services/enterprise-jobs');
const jobsService = new EnterpriseJobsService(db);
jobsService.start();

// Error handling
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server...');
  httpServer.close(() => {
    console.log('Server closed');
    if (db.pool && db.pool.end) {
      db.pool.end(() => {
        console.log('Database pool closed');
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  });
});

const PORT = config.port;
(async () => {
  try {
    await initRun;
    await ensureAdminSeed();
    await ensureAdminApiKeyAndTopup();
  } catch (e) {
    console.error('Init error:', e);
  }
  httpServer.listen(PORT, () => {
    console.log(`
🚀 Révolution Network Backend Started!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📡 Server:      http://localhost:${PORT}
🌐 Environment: ${config.nodeEnv}
🔗 WebSocket:   ws://localhost:${PORT}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    `);
  });
})();

module.exports = { app, io };
