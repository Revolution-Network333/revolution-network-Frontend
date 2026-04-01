const express = require('express');
const db = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const router = express.Router();

function accrue(principal, apy, startTime) {
  const safe = typeof startTime === 'string' ? startTime.replace(' ', 'T') + 'Z' : startTime;
  const start = new Date(safe).getTime();
  const now = Date.now();
  const days = Math.max(0, (now - start) / (1000 * 60 * 60 * 24));
  return principal * apy * (days / 365);
}

router.get('/balance', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    let w = await db.query('SELECT balance_ath FROM wallets WHERE user_id = $1', [userId]);
    if (w.rows.length === 0) {
      await db.query('INSERT INTO wallets (user_id, balance_ath) VALUES ($1, 0)', [userId]);
      w = await db.query('SELECT balance_ath FROM wallets WHERE user_id = $1', [userId]);
    }
    const s = await db.query(
        `SELECT * FROM stakes WHERE user_id = $1 AND ${db.isSQLite ? 'active = 1' : 'active = TRUE'}`,
        [userId]
    );
    let stake = null;
    if (s.rows.length > 0) {
      const st = s.rows[0];
      const reward = accrue(st.principal, st.apy, st.start_time);
      stake = { principal: st.principal, apy: st.apy, start_time: st.start_time, reward };
    }
    res.json({ balanceAth: w.rows[0].balance_ath, stake });
  } catch (e) {
    res.status(500).json({ error: 'wallet_error' });
  }
});

router.post('/stake', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const amount = Math.max(0, parseFloat(req.body.amount || 0));
    if (amount <= 0) return res.status(400).json({ error: 'amount_invalid' });
    const w = await db.query('SELECT balance_ath FROM wallets WHERE user_id = $1', [userId]);
    const bal = w.rows[0]?.balance_ath || 0;
    if (bal < amount) return res.status(400).json({ error: 'insufficient_balance' });
    
    // Empêcher d'écraser un stake existant
    const existing = await db.query(`SELECT id FROM stakes WHERE user_id = $1 AND ${db.isSQLite ? 'active = 1' : 'active = TRUE'}`, [userId]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Vous avez déjà un staking en cours. Veuillez unstake avant d\'en créer un nouveau.' });
    }

    await db.query('UPDATE wallets SET balance_ath = balance_ath - $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2', [amount, userId]);
    await db.query('UPDATE stakes SET active = $1 WHERE user_id = $2', [db.isSQLite ? 0 : false, userId]);
    // Passage à 36.5% APY (1000 tokens => 1 token / jour)
    await db.query('INSERT INTO stakes (user_id, principal, apy, active) VALUES ($1, $2, $3, $4)', [userId, amount, 0.365, db.isSQLite ? 1 : true]);
    await db.query('INSERT INTO wallet_events (user_id, type, amount, metadata) VALUES ($1, $2, $3, $4)', [userId, 'stake_start', amount, JSON.stringify({ apy: 0.365 })]);
    res.json({ success: true });
  } catch (e) {
    console.error('Stake error:', e);
    res.status(500).json({ error: 'stake_error' });
  }
});

router.post('/unstake', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const s = await db.query(
        `SELECT * FROM stakes WHERE user_id = $1 AND ${db.isSQLite ? 'active = 1' : 'active = TRUE'}`,
        [userId]
    );
    if (s.rows.length === 0) return res.status(404).json({ error: 'no_active_stake' });
    const st = s.rows[0];
    const reward = accrue(st.principal, st.apy, st.start_time);
    const total = st.principal + reward;
    await db.query('UPDATE stakes SET active = $1 WHERE id = $2', [db.isSQLite ? 0 : false, st.id]);
    await db.query('UPDATE wallets SET balance_ath = balance_ath + $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2', [total, userId]);
    await db.query('INSERT INTO wallet_events (user_id, type, amount, metadata) VALUES ($1, $2, $3, $4)', [userId, 'stake_end', total, JSON.stringify({ principal: st.principal, reward })]);
    res.json({ success: true, credited: total });
  } catch (e) {
    console.error('Unstake error:', e);
    res.status(500).json({ error: 'unstake_error' });
  }
});

router.post('/withdraw', authenticateToken, async (req, res) => {
  try {
    // Check if withdrawals are enabled globally
    const settingsRes = await db.query("SELECT value FROM settings WHERE key = 'withdrawals_enabled'");
    const isEnabled = settingsRes.rows.length > 0 && (settingsRes.rows[0].value === 'true' || settingsRes.rows[0].value === '1');
    
    if (!isEnabled) {
        return res.status(403).json({ error: 'Les retraits sont temporairement désactivés.' });
    }

    const userId = req.user.userId;
    const amount = Math.max(0, parseFloat(req.body.amount || 0));
    const address = req.body.address; // Solana address

    if (amount <= 0) return res.status(400).json({ error: 'Montant invalide' });
    if (!address) return res.status(400).json({ error: 'Adresse de retrait requise' });

    const w = await db.query('SELECT balance_ath FROM wallets WHERE user_id = $1', [userId]);
    const bal = w.rows[0]?.balance_ath || 0;

    if (bal < amount) return res.status(400).json({ error: 'Solde insuffisant' });

    // Deduct balance
    await db.query('UPDATE wallets SET balance_ath = balance_ath - $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2', [amount, userId]);
    
    // Log withdrawal event (pending processing)
    // We store the address in metadata
    await db.query('INSERT INTO wallet_events (user_id, type, amount, metadata) VALUES ($1, $2, $3, $4)', 
        [userId, 'withdraw', amount, JSON.stringify({ address, status: 'pending' })]
    );

    res.json({ success: true, withdrawn: amount, message: 'Retrait demandé avec succès' });
  } catch (e) {
    console.error('Withdraw error:', e);
    res.status(500).json({ error: 'Erreur lors du retrait' });
  }
});

router.get('/history', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const ev = await db.query('SELECT id, type, amount, metadata, created_at FROM wallet_events WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100', [userId]);
    res.json({ events: ev.rows || [] });
  } catch (e) {
    res.status(500).json({ error: 'history_error' });
  }
});

router.get('/nfts', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const countRes = await db.query(
      `SELECT COUNT(*)::int AS c
       FROM user_entitlements
       WHERE user_id = $1 AND feature = 'node_nft' AND ${db.isSQLite ? 'active = 1' : 'active = TRUE'}`,
      [userId]
    );
    let count = countRes.rows[0]?.c || 0;
    if (count === 0) {
      // Fallback: calculer via l’historique si l’entitlement n’a pas été créé
      const sumRes = await db.query(
        `SELECT COALESCE(SUM(amount),0)::int AS s
         FROM wallet_events
         WHERE user_id = $1 AND type = 'nft_node'`,
        [userId]
      );
      count = sumRes.rows[0]?.s || 0;
    }
    const hist = await db.query(
      `SELECT id, amount, metadata, created_at
       FROM wallet_events
       WHERE user_id = $1 AND type = 'nft_node'
       ORDER BY created_at DESC`,
      [userId]
    );
    res.json({
      nfts: [{
        type: 'node_nft',
        title: 'Node (Passif)',
        count,
        bonus: { label: '+30% taux de base (auto‑minage)', factor: 0.3 }
      }],
      history: hist.rows || []
    });
  } catch (e) {
    res.status(500).json({ error: 'nfts_error' });
  }
});

module.exports = router;
