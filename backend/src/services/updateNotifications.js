/**
 * Update Notification Service
 * Handles scheduled notifications before forced updates (J-3, J-2, J-1)
 */

const db = require('../config/database');

// Notification types for update reminders
const UPDATE_NOTIFICATIONS = {
  J_MINUS_3: 'update_force_j-3',
  J_MINUS_2: 'update_force_j-2', 
  J_MINUS_1: 'update_force_j-1',
  FORCE_NOW: 'update_force_now'
};

/**
 * Check and send update notification reminders
 * Should be called periodically (e.g., every hour)
 */
async function checkAndSendUpdateNotifications() {
  try {
    // Get force update date from config
    const forceDateRes = await db.query(
      "SELECT value FROM system_config WHERE key = 'app_force_update_date'"
    );
    
    if (!forceDateRes.rows.length || !forceDateRes.rows[0].value) {
      return; // No force update scheduled
    }
    
    const forceUpdateDate = new Date(forceDateRes.rows[0].value);
    const now = new Date();
    
    // Calculate days until force update
    const diffTime = forceUpdateDate - now;
    const daysUntil = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    // Check which notifications need to be sent
    if (daysUntil === 3) {
      await sendUpdateNotification(UPDATE_NOTIFICATIONS.J_MINUS_3, 
        'Mise à jour obligatoire dans 3 jours',
        'Une mise à jour obligatoire de Revolution Network arrivera dans 3 jours. Veuillez mettre à jour dès que possible pour éviter toute interruption.',
        'warning'
      );
    } else if (daysUntil === 2) {
      await sendUpdateNotification(UPDATE_NOTIFICATIONS.J_MINUS_2,
        'Mise à jour obligatoire dans 2 jours',
        'Mise à jour obligatoire dans 2 jours. Ne tardez pas à mettre à jour votre application.',
        'warning'
      );
    } else if (daysUntil === 1) {
      await sendUpdateNotification(UPDATE_NOTIFICATIONS.J_MINUS_1,
        'Dernière chance — mise à jour demain',
        'Dernière chance ! La mise à jour obligatoire sera appliquée demain. Mettez à jour maintenant pour continuer à utiliser l\'app.',
        'urgent'
      );
    } else if (daysUntil <= 0) {
      await sendUpdateNotification(UPDATE_NOTIFICATIONS.FORCE_NOW,
        'Mise à jour obligatoire maintenant',
        'L\'application doit être mise à jour immédiatement pour continuer à fonctionner.',
        'critical'
      );
    }
    
  } catch (error) {
    console.error('Error checking update notifications:', error);
  }
}

/**
 * Send update notification to all users
 */
async function sendUpdateNotification(type, title, message, priority = 'normal') {
  try {
    // Check if this notification was already sent today
    const checkRes = await db.query(
      `SELECT id FROM notifications 
       WHERE title = $1 
       AND created_at > CURRENT_DATE
       LIMIT 1`,
      [title]
    );
    
    if (checkRes.rows.length > 0) {
      console.log(`Update notification '${title}' already sent today`);
      return;
    }
    
    // Create notification for all users
    await db.query(
      `INSERT INTO notifications (title, message, target_role, created_by, created_at)
       VALUES ($1, $2, 'all', 0, CURRENT_TIMESTAMP)`,
      [title, message]
    );
    
    // Also create push notifications for mobile/desktop
    await createPushNotifications(title, message, priority);
    
    console.log(`Update notification sent: ${title}`);
    
  } catch (error) {
    console.error('Error sending update notification:', error);
  }
}

/**
 * Create push notifications for all active devices
 */
async function createPushNotifications(title, body, priority) {
  try {
    // Get all users with push tokens
    const tokensRes = await db.query(
      `SELECT DISTINCT user_id, push_token, platform 
       FROM push_tokens 
       WHERE push_token IS NOT NULL 
       AND updated_at > CURRENT_TIMESTAMP - INTERVAL '30 days'`
    );
    
    // Queue push notifications
    for (const row of tokensRes.rows) {
      await db.query(
        `INSERT INTO push_notifications_queue 
         (user_id, title, body, priority, platform, created_at)
         VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
        [row.user_id, title, body, priority, row.platform]
      );
    }
    
  } catch (error) {
    console.error('Error creating push notifications:', error);
  }
}

/**
 * Start the update notification checker
 * Runs every hour
 */
function startUpdateNotificationScheduler() {
  // Run immediately on startup
  checkAndSendUpdateNotifications();
  
  // Then every hour
  setInterval(checkAndSendUpdateNotifications, 60 * 60 * 1000);
  
  console.log('Update notification scheduler started');
}

module.exports = {
  startUpdateNotificationScheduler,
  checkAndSendUpdateNotifications,
  UPDATE_NOTIFICATIONS
};
