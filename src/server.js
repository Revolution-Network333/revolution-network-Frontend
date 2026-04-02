const start = async () => {
  try {
    const rawUrl = String(process.env.DATABASE_URL || '').trim();
    const isPostgresUrl = /^postgres(ql)?:\/\//i.test(rawUrl);
    if (rawUrl && isPostgresUrl) {
      const { Pool } = require('pg');
      const pool = new Pool({
        connectionString: rawUrl,
        ssl: { rejectUnauthorized: false },
      });
      await pool.query(`ALTER TABLE IF EXISTS user_tasks ADD COLUMN IF NOT EXISTS timestamp_started TIMESTAMP`);
      await pool.query(`ALTER TABLE IF EXISTS user_tasks ADD COLUMN IF NOT EXISTS timestamp_approved TIMESTAMP`);
      await pool.query(`ALTER TABLE IF EXISTS user_tasks ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`);
      await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_user_tasks_unique ON user_tasks (user_id, task_id)`);
      // Airdrop columns
      await pool.query(`ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS airdrop_score NUMERIC(20,4) DEFAULT 0`);
      await pool.query(`ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS airdrop_allocation NUMERIC(20,4) DEFAULT 0`);
      await pool.query(`ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS last_airdrop_calculation TIMESTAMP`);
      // Settings table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS settings (
          key VARCHAR(50) PRIMARY KEY,
          value TEXT,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await pool.query(`INSERT INTO settings (key, value) VALUES ('withdrawals_enabled', 'false') ON CONFLICT (key) DO NOTHING`);
      // Admin logs table aligned with backend usage
      await pool.query(`
        CREATE TABLE IF NOT EXISTS admin_logs (
          id SERIAL PRIMARY KEY,
          admin_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          action VARCHAR(50) NOT NULL,
          details TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_admin_logs_admin ON admin_logs(admin_id)`);
      await pool.end();
    }
  } catch (_) {}
  process.env.SRC_PROXY = 'backend';
  require('./backend/src/server.js');
};
start();
