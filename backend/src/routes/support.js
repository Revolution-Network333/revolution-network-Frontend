const express = require('express');
const router = express.Router();
const db = require('../config/database');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authenticateToken } = require('../middleware/auth');

// Configuration Multer pour l'upload d'images
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '../../uploads/support');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    // Sanitize filename
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, 'ticket-' + uniqueSuffix + ext);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Format de fichier non supporté. Images uniquement.'), false);
    }
  }
});

// Middleware pour servir les fichiers uploadés (si nécessaire, ou via express.static dans server.js)
// Pour l'instant, on retourne l'URL relative.

// --- Routes Utilisateur ---

// Créer un ticket
router.post('/tickets', authenticateToken, upload.single('image'), async (req, res) => {
  try {
    const userId = req.user.userId; // auth middleware sets userId
    const { subject, message, priority } = req.body;
    
    if (!message) return res.status(400).json({ error: 'Message requis' });
    
    const validPriorities = ['low', 'medium', 'high'];
    const ticketPriority = validPriorities.includes(priority) ? priority : 'medium';

    // Créer le ticket
    const ticketResult = await db.query(
      'INSERT INTO support_tickets (user_id, subject, status, priority) VALUES ($1, $2, $3, $4) RETURNING id',
      [userId, subject || 'Support Request', 'open', ticketPriority]
    );
    const ticketId = ticketResult.rows[0].id;

    const attachmentUrl = req.file ? `/uploads/support/${req.file.filename}` : null;

    // Ajouter le premier message
    await db.query(
      'INSERT INTO support_messages (ticket_id, sender_id, sender_role, message, attachment_url) VALUES ($1, $2, $3, $4, $5)',
      [ticketId, userId, 'user', message, attachmentUrl]
    );

    res.status(201).json({ id: ticketId, message: 'Ticket créé avec succès' });
  } catch (error) {
    console.error('Create ticket error:', error);
    res.status(500).json({ error: 'Erreur serveur lors de la création du ticket' });
  }
});

// Lister mes tickets
router.get('/tickets', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const result = await db.query(
      'SELECT * FROM support_tickets WHERE user_id = $1 ORDER BY updated_at DESC',
      [userId]
    );
    res.json({ tickets: result.rows });
  } catch (error) {
    console.error('List tickets error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Obtenir un ticket et ses messages
router.get('/tickets/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const ticketId = req.params.id;
    
    // Check role from DB to be safe, or trust token if it has role
    // Token usually has role, but let's check DB for admin access if needed
    // Actually, middleware might not populate isAdmin boolean directly.
    // Let's check user role.
    const userRes = await db.query('SELECT role FROM users WHERE id = $1', [userId]);
    const isAdmin = userRes.rows[0]?.role === 'admin';

    let ticket;
    if (isAdmin) {
         // Admin can see any ticket
         const t = await db.query(`
            SELECT t.*, u.username, u.email, u.rank, u.profile_picture_url 
            FROM support_tickets t 
            JOIN users u ON t.user_id = u.id 
            WHERE t.id = $1`, [ticketId]);
         ticket = t.rows[0];
    } else {
         // User can only see their own
         const t = await db.query('SELECT * FROM support_tickets WHERE id = $1 AND user_id = $2', [ticketId, userId]);
         ticket = t.rows[0];
    }

    if (!ticket) return res.status(404).json({ error: 'Ticket non trouvé' });

    const messages = await db.query(
      `SELECT m.*, u.username, u.profile_picture_url 
       FROM support_messages m 
       LEFT JOIN users u ON m.sender_id = u.id
       WHERE m.ticket_id = $1 
       ORDER BY m.created_at ASC`,
      [ticketId]
    );

    res.json({ ticket, messages: messages.rows, isAdmin });
  } catch (error) {
    console.error('Get ticket error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Ajouter un message à un ticket
router.post('/tickets/:id/messages', authenticateToken, upload.single('image'), async (req, res) => {
  try {
    const userId = req.user.userId;
    const ticketId = req.params.id;
    const { message } = req.body;
    
    const userRes = await db.query('SELECT role FROM users WHERE id = $1', [userId]);
    const isAdmin = userRes.rows[0]?.role === 'admin';
    
    // Vérifier l'accès au ticket
    let ticketCheck;
    if (isAdmin) {
        ticketCheck = await db.query('SELECT id, status FROM support_tickets WHERE id = $1', [ticketId]);
    } else {
        ticketCheck = await db.query('SELECT id, status FROM support_tickets WHERE id = $1 AND user_id = $2', [ticketId, userId]);
    }

    if (ticketCheck.rows.length === 0) return res.status(404).json({ error: 'Ticket non trouvé' });
    const currentStatus = ticketCheck.rows[0].status;

    if (!message && !req.file) return res.status(400).json({ error: 'Message ou image requis' });

    const attachmentUrl = req.file ? `/uploads/support/${req.file.filename}` : null;
    const senderRole = isAdmin ? 'admin' : 'user';

    await db.query(
      'INSERT INTO support_messages (ticket_id, sender_id, sender_role, message, attachment_url) VALUES ($1, $2, $3, $4, $5)',
      [ticketId, userId, senderRole, message || '', attachmentUrl]
    );

    // Mettre à jour le timestamp et le statut du ticket
    let newStatus = currentStatus;
    if (isAdmin) {
        // If admin replies, status could be 'pending_user' or just keep 'open'
        // Let's keep it simple or set to 'open' if it was 'pending_admin'
        if (currentStatus === 'pending_admin') newStatus = 'open';
        // Or maybe 'answered'? Let's stick to 'open' / 'closed' / 'pending_user'
        newStatus = 'pending_user';
    } else {
        // If user replies, status should be 'open' or 'pending_admin'
        newStatus = 'pending_admin';
        if (currentStatus === 'closed') newStatus = 'open'; // Reopen if user replies
    }

    await db.query('UPDATE support_tickets SET updated_at = CURRENT_TIMESTAMP, status = $1 WHERE id = $2', [newStatus, ticketId]);
    
    res.json({ success: true, newStatus });
  } catch (error) {
    console.error('Post message error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Fermer un ticket (User)
router.put('/tickets/:id/close', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const ticketId = req.params.id;
    
    // Check if ticket belongs to user
    const check = await db.query('SELECT id FROM support_tickets WHERE id = $1 AND user_id = $2', [ticketId, userId]);
    if (check.rows.length === 0) {
        // Allow admin to close too via this route? No, admin uses specific route or this one if we check role.
        // But for simplicity, let's keep it user-centric or check admin role too.
        // If admin calls this, check.rows is 0 (unless admin is the user).
        // Let's check admin role to be safe/flexible.
        const userRes = await db.query('SELECT role FROM users WHERE id = $1', [userId]);
        if (userRes.rows[0]?.role === 'admin') {
             // Admin allowed
        } else {
             return res.status(404).json({ error: 'Ticket non trouvé' });
        }
    }

    await db.query("UPDATE support_tickets SET status = 'closed', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [ticketId]);
    res.json({ success: true });
  } catch (error) {
    console.error('Close ticket error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// --- Routes Admin ---

// Obtenir les statistiques des tickets (pour la bulle de notification)
router.get('/admin/stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userRes = await db.query('SELECT role FROM users WHERE id = $1', [userId]);
    if (userRes.rows[0]?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

    const result = await db.query(`
      SELECT 
        SUM(CASE WHEN status = 'pending_admin' THEN 1 ELSE 0 END) as pending_count,
        SUM(CASE WHEN status != 'closed' THEN 1 ELSE 0 END) as open_count,
        COUNT(*) as total_count
      FROM support_tickets
    `);
    
    const pending_count = parseInt(result.rows[0].pending_count || 0);
    const open_count = parseInt(result.rows[0].open_count || 0);
    const total_count = parseInt(result.rows[0].total_count || 0);

    res.json({ pending_count, open_count, total_count });
  } catch (error) {
    console.error('Admin support stats error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Lister tous les tickets
router.get('/admin/tickets', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userRes = await db.query('SELECT role FROM users WHERE id = $1', [userId]);
    if (userRes.rows[0]?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    
    const { status } = req.query;
    let query = `
      SELECT t.*, u.username, u.email, u.rank, u.profile_picture_url,
      (SELECT COUNT(*) FROM support_messages WHERE ticket_id = t.id) as msg_count
      FROM support_tickets t 
      JOIN users u ON t.user_id = u.id 
    `;
    const params = [];
    
    if (status && status !== 'all') {
        query += ` WHERE t.status = $1`;
        params.push(status);
    }
    
    query += ` ORDER BY 
        CASE WHEN t.status = 'pending_admin' THEN 0 
             WHEN t.status = 'open' THEN 1 
             WHEN t.status = 'pending_user' THEN 2
             ELSE 3 END, 
        t.updated_at DESC`;

    const result = await db.query(query, params);
    res.json({ tickets: result.rows });
  } catch (error) {
    console.error('Admin list tickets error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Modifier le statut d'un ticket
router.put('/admin/tickets/:id/status', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const userRes = await db.query('SELECT role FROM users WHERE id = $1', [userId]);
        if (userRes.rows[0]?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
        
        const { status } = req.body;
        const validStatuses = ['open', 'closed', 'pending_user', 'pending_admin'];
        if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Statut invalide' });

        await db.query("UPDATE support_tickets SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2", [status, req.params.id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

module.exports = router;
