const express = require('express');
const db = require('../config/database');
const config = require('../config');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Récupérer tous les articles actifs de la boutique
router.get('/items', async (req, res) => {
    try {
        const whereActive = db.isSQLite ? 'active = 1' : 'active = TRUE';
        const result = await db.query(`SELECT * FROM shop_items WHERE ${whereActive} ORDER BY created_at DESC`);
        res.json({ items: result.rows });
    } catch (error) {
        console.error('Fetch shop items error:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération des articles' });
    }
});

// Acheter un article: active feature (vpn/auto_mining) ou crée une commande (presale)
router.post('/buy/:id', authenticateToken, async (req, res) => {
    try {
        const itemId = parseInt(req.params.id);
        const userId = req.user.userId;
        const { qty } = req.body || {};
        // Tables de support (sécuriser en production Postgres)
        if (!db.isSQLite) {
            try {
                await db.query(`CREATE TABLE IF NOT EXISTS wallets (
                    user_id INTEGER PRIMARY KEY,
                    balance_ath REAL DEFAULT 0,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )`);
                await db.query(`CREATE TABLE IF NOT EXISTS orders (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    item_id INTEGER NOT NULL,
                    qty INTEGER DEFAULT 1,
                    unit_price REAL NOT NULL,
                    total_price REAL NOT NULL,
                    status VARCHAR(50) DEFAULT 'created',
                    metadata TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )`);
                await db.query(`CREATE TABLE IF NOT EXISTS user_entitlements (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    feature VARCHAR(100) NOT NULL,
                    active BOOLEAN DEFAULT TRUE,
                    metadata TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )`);
                await db.query(`CREATE TABLE IF NOT EXISTS wallet_events (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    type TEXT NOT NULL,
                    amount REAL NOT NULL,
                    metadata TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )`);
            } catch (e) {
                console.warn('Ensure tables error:', e?.message || e);
            }
        }
        const whereActive = db.isSQLite ? 'active = 1' : 'active = TRUE';
        const itemRes = await db.query(`SELECT * FROM shop_items WHERE id = $1 AND ${whereActive}`, [itemId]);
        if (itemRes.rows.length === 0) return res.status(404).json({ error: 'Article introuvable' });
        const item = itemRes.rows[0];
        let meta = {};
        try { meta = JSON.parse(item.metadata || '{}'); } catch {}
        const u = await db.query('SELECT username, role, email FROM users WHERE id = $1', [userId]);
        const isKornAdmin = (u.rows[0]?.username === 'korn666') || ((u.rows[0]?.role || '').toLowerCase() === 'admin');
        if (meta && meta.adminOnly && !isKornAdmin) {
            return res.status(403).json({ error: 'admin_only' });
        }
        const userEmail = u.rows[0]?.email || null;

        const createStripeCheckout = async (orderRow, totalAmount, currency) => {
            if (!process.env.STRIPE_SECRET_KEY) return null;
            const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
            const frontendUrl = (config?.cors?.frontendUrl || process.env.FRONTEND_URL || '').replace(/\/+$/, '');
            if (!frontendUrl) return null;
            const amountCents = Math.round((parseFloat(totalAmount) || 0) * 100);
            if (!Number.isFinite(amountCents) || amountCents <= 0) return null;
            const cur = String(currency || 'EUR').toLowerCase();
            
            // Stripe doesn't accept emails without a dot in the domain (like admin@local)
            const isValidForStripe = (email) => {
                if (!email) return false;
                const parts = email.split('@');
                if (parts.length !== 2) return false;
                const domain = parts[1];
                return domain.includes('.') && domain.length > 3;
            };

            const session = await stripe.checkout.sessions.create({
                mode: 'payment',
                client_reference_id: String(orderRow.id),
                customer_email: isValidForStripe(userEmail) ? userEmail : undefined,
                metadata: {
                    order_id: String(orderRow.id),
                    user_id: String(userId),
                    item_id: String(itemId),
                    item_type: String(item.type || '')
                },
                line_items: [
                    {
                        price_data: {
                            currency: cur,
                            product_data: { name: String(item.title || 'Shop item') },
                            unit_amount: amountCents
                        },
                        quantity: 1
                    }
                ],
                success_url: `${frontendUrl}/?payment=success&order=${orderRow.id}`,
                cancel_url: `${frontendUrl}/?payment=cancel&order=${orderRow.id}`
            });
            return session;
        };

        if (item.type === 'vpn' || item.type === 'auto_mining' || item.type === 'node_nft') {
            const feature = item.type;
            if (feature === 'node_nft') {
                const already = await db.query(
                    `SELECT COUNT(*)::int AS c FROM user_entitlements WHERE user_id = $1 AND feature = 'node_nft' AND ${db.isSQLite ? 'active = 1' : 'active = TRUE'}`,
                    [userId]
                );
                if ((already.rows[0]?.c || 0) > 0) return res.status(409).json({ error: 'already_owned' });
            }
            if (!db.isSQLite) {
                try { await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_user_entitlements_user_feature ON user_entitlements (user_id, feature)`); } catch {}
            } else {
                try { await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_user_entitlements_user_feature ON user_entitlements (user_id, feature)`); } catch {}
            }
            const unitPrice = item.price || 0;
            const quantity = 1;
            const total = unitPrice * quantity;
            const orderMeta = JSON.stringify({ itemType: item.type, title: item.title });
            const orderRes = await db.query(
                `INSERT INTO orders (user_id, item_id, qty, unit_price, total_price, status, metadata)
                 VALUES ($1, $2, $3, $4, $5, 'pending_payment', $6) RETURNING *`,
                 [userId, itemId, quantity, unitPrice, total, orderMeta]
            );
            let checkoutUrl = null;
            try {
                const session = await createStripeCheckout(orderRes.rows[0], total, item.currency || 'EUR');
                checkoutUrl = session?.url || null;
                if (session?.id) {
                    const m = JSON.stringify({ ...(JSON.parse(orderMeta || '{}') || {}), stripe: { checkout_session_id: session.id } });
                    try { await db.query('UPDATE orders SET metadata = $1 WHERE id = $2', [m, orderRes.rows[0].id]); } catch {}
                }
            } catch (e) {
                console.error('Stripe checkout creation error:', e?.message || e);
            }
            return res.json({ success: true, requiresPayment: true, order: orderRes.rows[0], checkoutUrl });
        }
        if (item.type === 'presale') {
            const minQty = Number.isFinite(parseFloat(meta.minQty)) ? parseFloat(meta.minQty) : 50;
            const parsedQty = Number.isFinite(parseFloat(qty)) ? parseFloat(qty) : minQty;
            const rounded = Math.round(parsedQty / 50) * 50;
            const quantity = Math.max(minQty, rounded);
            const unitPrice = meta.unitPrice || item.price;
            const total = unitPrice * quantity;
            const orderRes = await db.query(
                `INSERT INTO orders (user_id, item_id, qty, unit_price, total_price, status, metadata)
                 VALUES ($1, $2, $3, $4, $5, 'pending_payment', $6) RETURNING *`,
                 [userId, itemId, quantity, unitPrice, total, item.metadata || null]
            );
            let checkoutUrl = null;
            try {
                const session = await createStripeCheckout(orderRes.rows[0], total, item.currency || 'EUR');
                checkoutUrl = session?.url || null;
                if (session?.id) {
                    let existing = {};
                    try { existing = JSON.parse(orderRes.rows[0].metadata || '{}'); } catch {}
                    const m = JSON.stringify({ ...(existing || {}), stripe: { checkout_session_id: session.id } });
                    try { await db.query('UPDATE orders SET metadata = $1 WHERE id = $2', [m, orderRes.rows[0].id]); } catch {}
                }
            } catch (e) {
                console.error('Stripe checkout creation error:', e?.message || e);
            }
            return res.json({ success: true, requiresPayment: true, order: orderRes.rows[0], checkoutUrl });
        }
        return res.json({ success: true });
    } catch (error) {
        console.error('Buy item error:', error);
        res.status(500).json({ error: 'Erreur lors de l\'achat' });
    }
});

// VPN config pour extension
router.get('/vpn/config', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const e = await db.query(
            `SELECT metadata FROM user_entitlements WHERE user_id = $1 AND feature = 'vpn' AND ${db.isSQLite ? 'active = 1' : 'active = TRUE'}`,
            [userId]
        );
        if (e.rows.length === 0) return res.status(403).json({ error: 'VPN non activé' });
        let meta = {};
        try { meta = JSON.parse(e.rows[0].metadata || '{}'); } catch {}
        const host = meta.proxyHost || process.env.VPN_PROXY_HOST || 'proxy.example.com';
        const port = meta.proxyPort || parseInt(process.env.VPN_PROXY_PORT) || 8080;
        const protocol = meta.proxyProtocol || 'http';
        return res.json({ host, port, protocol });
    } catch (error) {
        console.error('VPN config error:', error);
        res.status(500).json({ error: 'Erreur lors de la configuration VPN' });
    }
});

module.exports = router;
