const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../config/database');

class SignalingService {
  constructor(io) {
    this.io = io;
    this.connectedPeers = new Map(); // sessionId -> socket
    this.userSessions = new Map(); // userId -> Set of sessionIds
  }

  initialize() {
    this.io.on('connection', (socket) => {
      console.log(`🔌 New connection: ${socket.id}`);
      
      // Authentification requise
      socket.on('authenticate', async (data) => {
        try {
          const { token } = data;
          const decoded = jwt.verify(token, config.jwt.secret);
          
          socket.userId = decoded.userId;
          socket.sessionId = data.sessionId;
          
          // Enregistrer le peer
          this.connectedPeers.set(socket.sessionId, socket);
          
          if (!this.userSessions.has(socket.userId)) {
            this.userSessions.set(socket.userId, new Set());
          }
          this.userSessions.get(socket.userId).add(socket.sessionId);
          
          socket.emit('authenticated', { success: true, userId: socket.userId });
          console.log(`✅ User ${socket.userId} authenticated`);
          
          // Envoyer la liste des peers disponibles
          await this.sendAvailablePeers(socket);
          
        } catch (error) {
          console.error('Authentication error:', error);
          socket.emit('authentication-error', { error: 'Invalid token' });
          socket.disconnect();
        }
      });

      // Demande de peers disponibles
      socket.on('get-peers', async () => {
        await this.sendAvailablePeers(socket);
      });

      // Signaling pour WebRTC
      socket.on('offer', (data) => {
        const { targetSessionId, offer } = data;
        const targetSocket = this.connectedPeers.get(targetSessionId);
        
        if (targetSocket) {
          targetSocket.emit('offer', {
            fromSessionId: socket.sessionId,
            offer,
          });
        }
      });

      socket.on('answer', (data) => {
        const { targetSessionId, answer } = data;
        const targetSocket = this.connectedPeers.get(targetSessionId);
        
        if (targetSocket) {
          targetSocket.emit('answer', {
            fromSessionId: socket.sessionId,
            answer,
          });
        }
      });

      socket.on('ice-candidate', (data) => {
        const { targetSessionId, candidate } = data;
        const targetSocket = this.connectedPeers.get(targetSessionId);
        
        if (targetSocket) {
          targetSocket.emit('ice-candidate', {
            fromSessionId: socket.sessionId,
            candidate,
          });
        }
      });

      // Rapport de bande passante
      socket.on('bandwidth-report', async (data) => {
        try {
          const { bytesSent, bytesReceived, peersConnected } = data;
          
          // Enregistrer dans la DB
          await db.query(
            `INSERT INTO bandwidth_logs (session_id, user_id, bytes_sent, bytes_received, duration_seconds)
             VALUES ($1, $2, $3, $4, $5)`,
            [socket.sessionId, socket.userId, bytesSent, bytesReceived, 30]
          );
          
          // Mettre à jour la session
          await db.query(
            `UPDATE sessions 
             SET last_ping = CURRENT_TIMESTAMP, peers_connected = $1
             WHERE id = $2`,
            [peersConnected, socket.sessionId]
          );
          
          console.log(`📊 Bandwidth report from user ${socket.userId}: ↑${bytesSent} ↓${bytesReceived}`);
          
        } catch (error) {
          console.error('Error saving bandwidth report:', error);
        }
      });

      // Déconnexion
      socket.on('disconnect', async () => {
        console.log(`❌ Disconnected: ${socket.id}`);
        
        if (socket.sessionId) {
          this.connectedPeers.delete(socket.sessionId);
          
          if (socket.userId && this.userSessions.has(socket.userId)) {
            this.userSessions.get(socket.userId).delete(socket.sessionId);
          }
          
          // Marquer la session comme terminée
          try {
            await db.query(
              `UPDATE sessions 
               SET end_time = CURRENT_TIMESTAMP, is_active = false
               WHERE id = $1`,
              [socket.sessionId]
            );
          } catch (error) {
            console.error('Error updating session on disconnect:', error);
          }
        }
      });
    });
  }

  async sendAvailablePeers(socket) {
    try {
      // Récupérer les sessions actives (pas celle de l'utilisateur actuel)
      const result = await db.query(
        `SELECT s.id, s.user_id, s.peers_connected, s.last_ping
         FROM sessions s
         WHERE s.is_active = true 
         AND s.user_id != $1
         AND s.last_ping > NOW() - INTERVAL '2 minutes'
         LIMIT $2`,
        [socket.userId, config.rewards.maxPeersPerUser * 2]
      );
      
      const availablePeers = result.rows
        .filter(row => this.connectedPeers.has(row.id))
        .map(row => ({
          sessionId: row.id,
          userId: row.user_id,
          peersConnected: row.peers_connected,
        }));
      
      socket.emit('available-peers', { peers: availablePeers });
      
    } catch (error) {
      console.error('Error getting available peers:', error);
    }
  }

  getConnectedPeersCount() {
    return this.connectedPeers.size;
  }

  getUserSessionsCount(userId) {
    return this.userSessions.get(userId)?.size || 0;
  }
}

module.exports = SignalingService;
