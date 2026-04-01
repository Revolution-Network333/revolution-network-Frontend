const db = require('../config/database');
const config = require('../config');

class RewardsService {
  constructor() {
    this.calculationInterval = null;
  }

  startPeriodicCalculation() {
    // Calculer les récompenses toutes les 5 minutes
    this.calculationInterval = setInterval(() => {
      this.calculatePendingRewards();
    }, 5 * 60 * 1000);
    
    console.log('💰 Rewards calculation service started');
  }

  stop() {
    if (this.calculationInterval) {
      clearInterval(this.calculationInterval);
    }
  }

  async calculatePendingRewards() {
    try {
      console.log('💰 Calculating pending rewards...');
      
      // Récupérer les logs de bande passante non vérifiés
      const result = await db.query(
        `SELECT bl.*, s.user_id, u.trust_score
         FROM bandwidth_logs bl
         JOIN sessions s ON bl.session_id = s.id
         JOIN users u ON s.user_id = u.id
         WHERE bl.verified = false
         AND u.is_banned = false
         ORDER BY bl.timestamp ASC`
      );
      
      for (const log of result.rows) {
        await this.processRewardForLog(log);
      }
      
      console.log(`✅ Processed ${result.rows.length} bandwidth logs`);
      
    } catch (error) {
      console.error('Error calculating rewards:', error);
    }
  }

  async processRewardForLog(log) {
    const client = await db.getClient();
    
    try {
      await client.query('BEGIN');
      
      // Vérifier les points du jour
      const dailyResult = await client.query(
        `SELECT COALESCE(SUM(amount), 0) as today_points
         FROM rewards_ledger
         WHERE user_id = $1
         AND created_at >= CURRENT_DATE`,
        [log.user_id]
      );
      
      const todayPoints = parseInt(dailyResult.rows[0].today_points);
      
      if (todayPoints >= config.rewards.maxDailyPoints) {
        // Limite journalière atteinte
        await client.query(
          'UPDATE bandwidth_logs SET verified = true WHERE id = $1',
          [log.id]
        );
        await client.query('COMMIT');
        return;
      }
      
      // Calculer les points
      let points = 0;
      
      // Points pour le temps connecté
      const minutesConnected = log.duration_seconds / 60;
      points += Math.floor(minutesConnected * config.rewards.pointsPerMinuteConnected);
      
      // Points pour l'upload
      const mbSent = log.bytes_sent / (1024 * 1024);
      points += Math.floor(mbSent / 50) * config.rewards.pointsPer50MBUpload;
      
      // Points pour le download
      const mbReceived = log.bytes_received / (1024 * 1024);
      points += Math.floor(mbReceived / 200) * config.rewards.pointsPer200MBDownload;
      
      // Appliquer le trust score
      const trustMultiplier = log.trust_score / 100;
      points = Math.floor(points * trustMultiplier);
      
      // Limiter par le max journalier
      const availablePoints = config.rewards.maxDailyPoints - todayPoints;
      points = Math.min(points, availablePoints);
      
      if (points > 0) {
        // Ajouter dans le ledger
        await client.query(
          `INSERT INTO rewards_ledger (user_id, session_id, amount, reason, details)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            log.user_id,
            log.session_id,
            points,
            'bandwidth_sharing',
            JSON.stringify({
              bytes_sent: log.bytes_sent,
              bytes_received: log.bytes_received,
              duration_seconds: log.duration_seconds,
            }),
          ]
        );
        
        console.log(`💎 User ${log.user_id} earned ${points} points`);
      }
      
      // Marquer comme vérifié
      await client.query(
        'UPDATE bandwidth_logs SET verified = true WHERE id = $1',
        [log.id]
      );
      
      await client.query('COMMIT');
      
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error processing reward:', error);
    } finally {
      client.release();
    }
  }

  async getUserDailyPoints(userId) {
    const result = await db.query(
      `SELECT COALESCE(SUM(amount), 0) as points
       FROM rewards_ledger
       WHERE user_id = $1
       AND created_at >= CURRENT_DATE`,
      [userId]
    );
    
    return parseInt(result.rows[0].points);
  }

  async getUserTotalPoints(userId) {
    const result = await db.query(
      'SELECT total_points FROM users WHERE id = $1',
      [userId]
    );
    
    return result.rows[0]?.total_points || 0;
  }

  async getLeaderboard(limit = 100) {
    const result = await db.query(
      `SELECT id, username, total_points
       FROM users
       WHERE is_banned = false
       ORDER BY total_points DESC
       LIMIT $1`,
      [limit]
    );
    
    return result.rows;
  }
}

module.exports = RewardsService;
