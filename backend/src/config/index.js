require('dotenv').config();
const crypto = require('crypto');

const jwtSecret = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');
const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET || crypto.randomBytes(64).toString('hex');

module.exports = {
  // Server
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  
  // Database
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'revolution_network',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  },
  
  // JWT
  jwt: {
    secret: jwtSecret,
    refreshSecret: jwtRefreshSecret,
    expiresIn: process.env.JWT_EXPIRES_IN || '1h',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },
  
  // WebRTC
  webrtc: {
    stunServer: process.env.STUN_SERVER || 'stun:stun.l.google.com:19302',
    turnServer: process.env.TURN_SERVER,
    turnUsername: process.env.TURN_USERNAME,
    turnPassword: process.env.TURN_PASSWORD,
  },
  
  // Rewards
  rewards: {
    pointsPerMinuteConnected: parseFloat(process.env.POINTS_PER_MINUTE_CONNECTED) || 0.1,
    pointsPer50MBUpload: parseFloat(process.env.POINTS_PER_50MB_UPLOAD) || 0.1,
    pointsPer200MBDownload: parseFloat(process.env.POINTS_PER_200MB_DOWNLOAD) || 0.1,
    maxDailyPoints: parseInt(process.env.MAX_DAILY_POINTS) || 500,
    maxPeersPerUser: parseInt(process.env.MAX_PEERS_PER_USER) || 5,
  },
  
  // Anti-Fraud
  antiFraud: {
    maxSessionsPerIP: parseInt(process.env.MAX_SESSIONS_PER_IP) || 3,
    minimumSessionDurationSec: parseInt(process.env.MINIMUM_SESSION_DURATION_SEC) || 60,
    trustScoreThreshold: parseInt(process.env.TRUST_SCORE_THRESHOLD) || 50,
  },
  
  // Admin
  admin: {
    googleEmail: process.env.ADMIN_GOOGLE_EMAIL || null,
    walletAddress: process.env.ADMIN_WALLET || null,
  },
  
  // Enterprise
  enterprise: {
    apiKey: process.env.ENTERPRISE_API_KEY || 'ma-cle-secrete',
  },
  
  // CORS
  cors: {
    frontendUrl: process.env.FRONTEND_URL || 'https://azurus333.github.io',
    extensionId: process.env.EXTENSION_ID,
  },
};
