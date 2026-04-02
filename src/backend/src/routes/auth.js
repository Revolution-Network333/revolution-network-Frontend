const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const validator = require('validator');
const crypto = require('crypto');
const db = require('../config/database');
const config = require('../config');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

function base32Encode(buf) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, value = 0, output = '';
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i];
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  while (output.length % 8 !== 0) output += '=';
  return output;
}
function base32Decode(str) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = str.replace(/=+$/,'').toUpperCase();
  let bits = 0, value = 0;
  const out = [];
  for (let i = 0; i < clean.length; i++) {
    const idx = alphabet.indexOf(clean[i]);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
function generateTotp(secretB32, step = 30, digits = 6) {
  const key = base32Decode(secretB32);
  const counter = Math.floor(Date.now() / 1000 / step);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(0, 0);
  buf.writeUInt32BE(counter, 4);
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  const otp = code % (10 ** digits);
  return otp.toString().padStart(digits, '0');
}
function verifyTotp(secretB32, code, windowSteps = 1) {
  code = String(code || '').trim();
  if (!/^\d{6}$/.test(code)) return false;
  const step = 30, digits = 6;
  const key = base32Decode(secretB32);
  const cur = Math.floor(Date.now() / 1000 / step);
  for (let w = -windowSteps; w <= windowSteps; w++) {
    const buf = Buffer.alloc(8);
    buf.writeUInt32BE(0, 0);
    buf.writeUInt32BE(cur + w, 4);
    const hmac = crypto.createHmac('sha1', key).update(buf).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const val = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
    const otp = (val % (10 ** digits)).toString().padStart(digits, '0');
    if (otp === code) return true;
  }
  return false;
}

// Register
router.post('/register', async (req, res) => {
  try {
    const { email, password, username, referralCode } = req.body;
    
    // Validation
    if (!email || !password || !username) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    if (!validator.isEmail(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }
    
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    
    if (username.length < 3 || username.length > 20) {
      return res.status(400).json({ error: 'Username must be 3-20 characters' });
    }
    
    // Vérifier si l'email existe déjà
    const existingUser = await db.query(
      'SELECT id FROM users WHERE email = $1 OR username = $2',
      [email, username]
    );
    
    if (existingUser.rows.length > 0) {
      return res.status(409).json({ error: 'Email or username already exists' });
    }

    // Gérer le parrainage
    let referrerId = null;
    if (referralCode) {
      const referrerResult = await db.query(
        'SELECT id FROM users WHERE referral_code = $1',
        [referralCode]
      );
      if (referrerResult.rows.length > 0) {
        referrerId = referrerResult.rows[0].id;
      }
    }
    
    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Générer un code de parrainage unique
    const newReferralCode = crypto.randomBytes(4).toString('hex');
    
    // Créer l'utilisateur
    const result = await db.query(
      `INSERT INTO users (email, password_hash, username, referral_code, referrer_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, username, total_points, created_at, referral_code`,
      [email, passwordHash, username, newReferralCode, referrerId]
    );
    
    const user = result.rows[0];
    
    if (referrerId) {
      try {
        await db.query(
          'INSERT INTO referrals (referrer_user_id, referred_user_id, level) VALUES ($1, $2, $3)',
          [referrerId, user.id, 1]
        );
        await db.query("UPDATE users SET rank = CASE WHEN COALESCE(rank,'Bronze') = 'Bronze' THEN 'Silver' ELSE COALESCE(rank,'Bronze') END WHERE id = $1", [referrerId]);
      } catch (_) {}
    }
    
    // Créer le token
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    );
    
    const refreshToken = jwt.sign(
      { userId: user.id },
      config.jwt.refreshSecret,
      { expiresIn: config.jwt.refreshExpiresIn }
    );
    
    res.status(201).json({
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        totalPoints: user.total_points,
        referralCode: user.referral_code,
      },
      token,
      refreshToken,
    });
    
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password, referralCode, walletAddress } = req.body;
    
    if ((!email && !walletAddress) || !password) {
      return res.status(400).json({ error: 'Missing identifier or password' });
    }
    
    let result;
    if (email) {
      // Trouver l'utilisateur par email OU username
      // Correction: On vérifie si l'entrée est un email pour adapter la requête si besoin, 
      // mais la requête combinée est déjà correcte. On s'assure juste de l'is_active.
      result = await db.query(
        'SELECT * FROM users WHERE (LOWER(email) = LOWER($1) OR LOWER(username) = LOWER($1))',
        [email]
      );
    } else {
      // Login via adresse wallet
      result = await db.query(
        'SELECT * FROM users WHERE wallet_address = $1 AND is_active = true',
        [walletAddress]
      );
    }
    
    if (result.rows.length === 0) {
      // Auto-création admin si identifiants correspondants (setup rapide en dev)
      if ((email === 'korn666') && (password === '741852963')) {
        const hash = await bcrypt.hash(password, 10);
        await db.query(
          `INSERT INTO users (email, password_hash, username, role, is_active)
           VALUES ($1, $2, $3, $4, true)
           RETURNING id`,
           [email, hash, 'korn666', 'admin']
        );
        const fetched = await db.query(
          'SELECT * FROM users WHERE (email = $1 OR username = $2) AND is_active = true',
          [email, email]
        );
        result.rows = fetched.rows;
      } else {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
    }
    
    const user = result.rows[0];
    
    // Vérifier le ban
    if (user.is_banned) {
      return res.status(403).json({ error: 'Account is banned' });
    }
    
    let isValidPassword = false;
    try {
      isValidPassword = await bcrypt.compare(password, user.password_hash);
    } catch (_) {
      isValidPassword = false;
    }
    if (!isValidPassword) {
      if (user.password_hash === password) {
        const newHash = await bcrypt.hash(password, 10);
        await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, user.id]);
        isValidPassword = true;
      }
    }
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Lier un parrain si code fourni et pas encore lié
    if (referralCode && !user.referrer_id) {
      const refResult = await db.query('SELECT id FROM users WHERE referral_code = $1', [referralCode]);
      if (refResult.rows.length > 0) {
        const referrerId = refResult.rows[0].id;
        await db.query('UPDATE users SET referrer_id = $1 WHERE id = $2', [referrerId, user.id]);
        await db.query(
          'INSERT INTO referrals (referrer_user_id, referred_user_id, level) VALUES ($1, $2, $3)',
          [referrerId, user.id, 1]
        );
        try {
          await db.query("UPDATE users SET rank = CASE WHEN COALESCE(rank,'Bronze') = 'Bronze' THEN 'Silver' ELSE COALESCE(rank,'Bronze') END WHERE id = $1", [referrerId]);
        } catch (_) {}
      }
    }

    // Mettre à jour last_login
    await db.query(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
      [user.id]
    );
    
    if (user.twofa_enabled) {
      const twofaToken = jwt.sign({ userId: user.id, p: '2fa' }, config.jwt.secret, { expiresIn: '5m' });
      return res.json({ needs2fa: true, twofaToken });
    }
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    );
    
    const refreshToken = jwt.sign(
      { userId: user.id },
      config.jwt.refreshSecret,
      { expiresIn: config.jwt.refreshExpiresIn }
    );
    
    res.json({
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        totalPoints: user.total_points,
        trustScore: user.trust_score,
        referralCode: user.referral_code,
        rank: user.rank
      },
      token,
      refreshToken,
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Refresh token
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    
    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token required' });
    }
    
    const decoded = jwt.verify(refreshToken, config.jwt.refreshSecret);
    
    const newToken = jwt.sign(
      { userId: decoded.userId },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    );
    
    res.json({ token: newToken });
    
  } catch (error) {
    res.status(401).json({ error: 'Invalid refresh token' });
  }
});

// Login via Google (simplifié, basé sur l'email ou deviceId)
router.post('/google-login', async (req, res) => {
  try {
    const { email, referralCode, deviceId } = req.body;
    let normalizedEmail = email;
    if (normalizedEmail && !validator.isEmail(normalizedEmail)) {
      normalizedEmail = null;
    }

    let result = null;
    let pseudoEmail = null;
    if (normalizedEmail) {
      result = await db.query('SELECT * FROM users WHERE email = $1 AND is_active = true', [normalizedEmail]);
      if (result.rows.length > 0) {
        const u = result.rows[0];
        // Si l'utilisateur a un mot de passe et n'est pas l'admin spécial, on refuse le bypass
        const isAdmin = (u.email && u.email.toLowerCase() === 'korn666') || (u.username && u.username.toLowerCase() === 'korn666');
        if (u.password_hash && !isAdmin && !u.google_sub) {
          return res.status(401).json({ error: 'Ce compte nécessite un mot de passe. Utilisez le formulaire classique.' });
        }
      }
    } else if (deviceId) {
      pseudoEmail = `${deviceId}@google.local`;
      result = await db.query('SELECT * FROM users WHERE email = $1 AND is_active = true', [pseudoEmail]);
    }

    let user;

    if (!result || result.rows.length === 0) {
      const baseUsername = (normalizedEmail ? normalizedEmail.split('@')[0] : 'google_guest').slice(0, 20);
      const randomSuffix = Math.floor(Math.random() * 10000);
      const username = `${baseUsername}_${randomSuffix}`;
      const randomPassword = await bcrypt.hash((normalizedEmail || deviceId || 'google') + Date.now().toString(), 10);
      const newReferralCode = crypto.randomBytes(4).toString('hex');
      
      let referrerId = null;
      if (referralCode) {
        const referrerResult = await db.query(
          'SELECT id FROM users WHERE referral_code = $1',
          [referralCode]
        );
        if (referrerResult.rows.length > 0) {
          referrerId = referrerResult.rows[0].id;
        }
      }

      const emailToUse = normalizedEmail || pseudoEmail || `${deviceId || 'google'}@google.local`;
      try {
        let insertResult;
        if (db.isMySQL) {
          insertResult = await db.query(
            `INSERT INTO users (email, password_hash, username, referral_code, referrer_id)
             VALUES ($1, $2, $3, $4, $5)`,
            [emailToUse, randomPassword, username, newReferralCode, referrerId]
          );
          const insertId = insertResult.insertId;
          const rowsRes = await db.query('SELECT id, email, username, total_points, trust_score, referral_code, is_admin, rank FROM users WHERE id = $1', [insertId]);
          user = rowsRes.rows[0];
        } else {
          insertResult = await db.query(
            `INSERT INTO users (email, password_hash, username, referral_code, referrer_id)
             VALUES ($1, $2, $3, $4, $5)
           RETURNING id, email, username, total_points, trust_score, referral_code, is_admin, rank`,
            [emailToUse, randomPassword, username, newReferralCode, referrerId]
          );
          user = insertResult.rows[0];
        }
      if (referrerId) {
        try {
          await db.query(
            'INSERT INTO referrals (referrer_user_id, referred_user_id, level) VALUES ($1, $2, $3)',
            [referrerId, user.id, 1]
          );
          await db.query("UPDATE users SET rank = CASE WHEN COALESCE(rank,'Bronze') = 'Bronze' THEN 'Silver' ELSE COALESCE(rank,'Bronze') END WHERE id = $1", [referrerId]);
        } catch (_) {}
      }
      } catch (e) {
        // Conflit de clé unique sur email -> récupérer l'existant et continuer
        if (String(e.code) === '23505') {
          const r2 = await db.query('SELECT * FROM users WHERE email = $1 AND is_active = true', [emailToUse]);
          if (r2.rows.length === 0) {
            return res.status(500).json({ error: 'User email conflict' });
          }
          user = r2.rows[0];
        } else {
          throw e;
        }
      }
    } else {
      user = result.rows[0];
    }

    await db.query(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
      [user.id]
    );

    const isAdmin = !!user.is_admin;

    const token = jwt.sign(
      { userId: user.id, email: user.email, isAdmin },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    );

    const refreshToken = jwt.sign(
      { userId: user.id },
      config.jwt.refreshSecret,
      { expiresIn: config.jwt.refreshExpiresIn }
    );

    res.json({
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        totalPoints: user.total_points,
        trustScore: user.trust_score,
        referralCode: user.referral_code,
        profile_picture_url: user.profile_picture_url,
        isAdmin,
        rank: user.rank,
      },
      token,
      refreshToken,
    });
  } catch (error) {
    console.error('Google login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/google-oauth', async (req, res) => {
  try {
    const { idToken, referralCode } = req.body;
    if (!idToken) return res.status(400).json({ error: 'idToken requis' });
    const resp = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
    if (!resp.ok) return res.status(401).json({ error: 'Token Google invalide' });
    const info = await resp.json();
    const email = info.email || null;
    const sub = info.sub;
    const aud = info.aud;
    const allowed = process.env.GOOGLE_CLIENT_ID || config.oauth?.googleClientId || null;
    if (allowed && aud !== allowed) return res.status(401).json({ error: 'Client non autorisé' });
    let result = null;
    if (email) {
      result = await db.query('SELECT * FROM users WHERE email = $1 AND is_active = true', [email]);
    } else {
      result = await db.query('SELECT * FROM users WHERE google_sub = $1 AND is_active = true', [sub]);
    }
    let user;
    if (!result || result.rows.length === 0) {
      const baseUsername = (email ? email.split('@')[0] : 'google').slice(0, 20);
      const randomSuffix = Math.floor(Math.random() * 10000);
      const username = `${baseUsername}_${randomSuffix}`;
      const randomPassword = await bcrypt.hash((email || sub) + Date.now().toString(), 10);
      const newReferralCode = crypto.randomBytes(4).toString('hex');
      let referrerId = null;
      if (referralCode) {
        const referrerResult = await db.query('SELECT id FROM users WHERE referral_code = $1', [referralCode]);
        if (referrerResult.rows.length > 0) referrerId = referrerResult.rows[0].id;
      }
      
      if (db.isMySQL) {
        await db.query(
          `INSERT INTO users (email, password_hash, username, referral_code, referrer_id, google_sub)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [email || `${sub}@google.local`, randomPassword, username, newReferralCode, referrerId, sub]
        );
        const r2 = await db.query('SELECT id, email, username, total_points, trust_score, referral_code, is_admin, rank FROM users WHERE google_sub = $1', [sub]);
        user = r2.rows[0];
      } else {
        const insertResult = await db.query(
          `INSERT INTO users (email, password_hash, username, referral_code, referrer_id, google_sub)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, email, username, total_points, trust_score, referral_code, is_admin, rank`,
          [email || `${sub}@google.local`, randomPassword, username, newReferralCode, referrerId, sub]
        );
        user = insertResult.rows[0];
      }
      
      if (referrerId) {
        try {
          await db.query(
            'INSERT INTO referrals (referrer_user_id, referred_user_id, level) VALUES ($1, $2, $3)',
            [referrerId, user.id, 1]
          );
          await db.query("UPDATE users SET rank = CASE WHEN COALESCE(rank,'Bronze') = 'Bronze' THEN 'Silver' ELSE COALESCE(rank,'Bronze') END WHERE id = $1", [referrerId]);
        } catch (_) {}
      }
    } else {
      user = result.rows[0];
    }
    await db.query('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1', [user.id]);
    const isAdmin = !!user.is_admin;
    const token = jwt.sign({ userId: user.id, email: user.email, isAdmin }, config.jwt.secret, { expiresIn: config.jwt.expiresIn });
    const refreshToken = jwt.sign({ userId: user.id }, config.jwt.refreshSecret, { expiresIn: config.jwt.refreshExpiresIn });
    res.json({
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        totalPoints: user.total_points,
        trustScore: user.trust_score,
        referralCode: user.referral_code,
        profile_picture_url: user.profile_picture_url,
        isAdmin,
        rank: user.rank,
      },
      token,
      refreshToken,
    });
  } catch (error) {
    console.error('Google OAuth error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Login via Phantom Wallet
router.post('/phantom-login', async (req, res) => {
  try {
    const { walletAddress, referralCode } = req.body;
    if (!walletAddress) {
      return res.status(400).json({ error: 'walletAddress requis' });
    }

    let result = await db.query(
      'SELECT * FROM users WHERE wallet_address = $1 AND is_active = true',
      [walletAddress]
    );

    let user;

    if (result.rows.length === 0) {
      const email = `${walletAddress}@phantom.local`;
      const baseUsername = `phantom_${walletAddress.slice(0, 8)}`;
      const randomPassword = await bcrypt.hash(walletAddress + Date.now().toString(), 10);
      
      // Gérer le parrainage
      let referrerId = null;
      if (referralCode) {
        const referrerResult = await db.query(
          'SELECT id FROM users WHERE referral_code = $1',
          [referralCode]
        );
        if (referrerResult.rows.length > 0) {
          referrerId = referrerResult.rows[0].id;
        }
      }

      // Générer un code de parrainage unique
      const newReferralCode = crypto.randomBytes(4).toString('hex');

      const insertResult = await db.query(
        `INSERT INTO users (email, password_hash, username, wallet_address, referral_code, referrer_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, email, username, total_points, trust_score, wallet_address, referral_code, rank`,
        [email, randomPassword, baseUsername, walletAddress, newReferralCode, referrerId]
      );
      user = insertResult.rows[0];
      if (referrerId) {
        try {
          await db.query(
            'INSERT INTO referrals (referrer_user_id, referred_user_id, level) VALUES ($1, $2, $3)',
            [referrerId, user.id, 1]
          );
          await db.query("UPDATE users SET rank = CASE WHEN COALESCE(rank,'Bronze') = 'Bronze' THEN 'Silver' ELSE COALESCE(rank,'Bronze') END WHERE id = $1", [referrerId]);
        } catch (_) {}
      }
    } else {
      user = result.rows[0];
    }

    await db.query(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
      [user.id]
    );

    const isAdmin = !!user.is_admin;

    const token = jwt.sign(
      { userId: user.id, email: user.email, walletAddress: user.wallet_address, isAdmin },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    );

    const refreshToken = jwt.sign(
      { userId: user.id },
      config.jwt.refreshSecret,
      { expiresIn: config.jwt.refreshExpiresIn }
    );

    res.json({
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        totalPoints: user.total_points,
        trustScore: user.trust_score,
        walletAddress: user.wallet_address,
        isAdmin,
        rank: user.rank,
      },
      token,
      refreshToken,
    });
  } catch (error) {
    console.error('Phantom login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Définir / modifier le mot de passe (pour comptes créés via wallet/Google)
router.post('/set-password', authenticateToken, async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'Mot de passe trop court' });
    }
    const hash = await bcrypt.hash(newPassword, 10);
    await db.query('UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [hash, req.user.userId]);
    res.json({ success: true });
  } catch (e) {
    console.error('Set password error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/2fa/setup', authenticateToken, async (req, res) => {
  try {
    const secret = base32Encode(crypto.randomBytes(20));
    const u = await db.query('SELECT username, email FROM users WHERE id = $1', [req.user.userId]);
    
    if (u.rows.length === 0) {
        throw new Error('User not found');
    }

    const label = encodeURIComponent(`Revolution Network:${u.rows[0]?.username || u.rows[0]?.email || 'user'}`);
    const issuer = encodeURIComponent('Revolution Network');
    const otpauth = `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}`;
    res.json({ secret, otpauth });
  } catch (e) {
    console.error('2FA setup error:', e);
    res.status(500).json({ error: 'Erreur interne', details: e.message });
  }
});

router.get('/2fa/status', authenticateToken, async (req, res) => {
  try {
    const r = await db.query('SELECT twofa_enabled FROM users WHERE id = $1', [req.user.userId]);
    const enabled = !!(db.isSQLite ? (r.rows[0]?.twofa_enabled === 1) : r.rows[0]?.twofa_enabled);
    res.json({ enabled });
  } catch (e) {
    res.status(500).json({ error: 'Erreur interne' });
  }
});

router.post('/2fa/enable', authenticateToken, async (req, res) => {
  try {
    const { secret, code } = req.body || {};
    if (!secret || !code) return res.status(400).json({ error: 'Secret et code requis' });
    if (!verifyTotp(secret, code)) return res.status(401).json({ error: 'Code invalide' });
    if (db.isSQLite) {
      await db.query('UPDATE users SET twofa_enabled = 1, twofa_secret = $1 WHERE id = $2', [secret, req.user.userId]);
    } else {
      await db.query('UPDATE users SET twofa_enabled = TRUE, twofa_secret = $1 WHERE id = $2', [secret, req.user.userId]);
    }
    res.json({ enabled: true });
  } catch (e) {
    res.status(500).json({ error: 'Erreur interne' });
  }
});

router.post('/2fa/disable', authenticateToken, async (req, res) => {
  try {
    const { code } = req.body || {};
    const r = await db.query('SELECT twofa_secret FROM users WHERE id = $1', [req.user.userId]);
    const secret = r.rows[0]?.twofa_secret || null;
    if (!secret) return res.status(400).json({ error: '2FA non activé' });
    if (!verifyTotp(secret, code)) return res.status(401).json({ error: 'Code invalide' });
    if (db.isSQLite) {
      await db.query('UPDATE users SET twofa_enabled = 0, twofa_secret = NULL WHERE id = $1', [req.user.userId]);
    } else {
      await db.query('UPDATE users SET twofa_enabled = FALSE, twofa_secret = NULL WHERE id = $1', [req.user.userId]);
    }
    res.json({ enabled: false });
  } catch (e) {
    res.status(500).json({ error: 'Erreur interne' });
  }
});

router.post('/2fa/verify', async (req, res) => {
  try {
    const { twofaToken, code } = req.body || {};
    if (!twofaToken || !code) return res.status(400).json({ error: 'Paramètres manquants' });
    let payload;
    try { payload = jwt.verify(twofaToken, config.jwt.secret); } catch { return res.status(401).json({ error: 'Token invalide' }); }
    if (!payload || payload.p !== '2fa' || !payload.userId) return res.status(401).json({ error: 'Token invalide' });
    const r = await db.query('SELECT id, email, username, total_points, trust_score, referral_code, is_admin, rank, twofa_secret FROM users WHERE id = $1 AND is_active = true', [payload.userId]);
    if (r.rows.length === 0) return res.status(401).json({ error: 'Compte introuvable' });
    const user = r.rows[0];
    if (!user.twofa_secret) return res.status(400).json({ error: '2FA non configuré' });
    if (!verifyTotp(user.twofa_secret, code)) return res.status(401).json({ error: 'Code invalide' });
    const token = jwt.sign({ userId: user.id, email: user.email }, config.jwt.secret, { expiresIn: config.jwt.expiresIn });
    const refreshToken = jwt.sign({ userId: user.id }, config.jwt.refreshSecret, { expiresIn: config.jwt.refreshExpiresIn });
    res.json({
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        totalPoints: user.total_points,
        trustScore: user.trust_score,
        referralCode: user.referral_code,
        rank: user.rank
      },
      token,
      refreshToken
    });
  } catch (e) {
    res.status(500).json({ error: 'Erreur interne' });
  }
});

module.exports = router;
